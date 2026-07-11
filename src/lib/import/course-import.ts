import "server-only";
import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import type { PublicTenant } from "@/lib/tenant/types";
import {
  courseSchema,
  moduleSchema,
  lessonSchema,
  blocksSchema,
  textBlockSchema,
  imageBlockSchema,
  audioBlockSchema,
  fileBlockSchema,
  quizBlockSchema,
  submissionBlockSchema,
  calloutBlockSchema,
  embedBlockSchema,
  type Block,
} from "@/lib/courses/schema";
import { saveLessonBlocks } from "@/lib/courses/actions";
import { reuploadVideoFromUrl } from "@/lib/import/video-reupload";
import { deleteBunnyVideo } from "@/lib/bunny/client";

/**
 * Migrations-Importer (Phase 4, Block 4): Kursstruktur-Import aus JSON.
 *
 * Kernentscheidung (PHASENSTATUS.md Block-4-Plan, 12.07.2026): maximale
 * Wiederverwendung statt neuer Logik. Validiert gegen die BEREITS
 * EXISTIERENDEN Schemas aus src/lib/courses/schema.ts (Phase 1 Block 3) —
 * kein neues Datenformat. Einzige Erweiterung: Block-`id` ist optional
 * (wird bei Fehlen per crypto.randomUUID() erzeugt) und Video-Blöcke dürfen
 * statt einer `bunnyVideoId` ein `sourceUrl` tragen, das VOR der finalen
 * Validierung gegen das normale blockSchema in eine echte bunnyVideoId
 * aufgelöst wird.
 */

const MAX_MODULES = 50;
const MAX_LESSONS_PER_MODULE = 100;

// --- Import-Block-Schema: wie die bestehenden Block-Schemas, aber `id` optional ---

const importTextBlockSchema = textBlockSchema.partial({ id: true });
const importImageBlockSchema = imageBlockSchema.partial({ id: true });
const importAudioBlockSchema = audioBlockSchema.partial({ id: true });
const importFileBlockSchema = fileBlockSchema.partial({ id: true });
const importQuizBlockSchema = quizBlockSchema.partial({ id: true });
const importSubmissionBlockSchema = submissionBlockSchema.partial({ id: true });
const importCalloutBlockSchema = calloutBlockSchema.partial({ id: true });
const importEmbedBlockSchema = embedBlockSchema.partial({ id: true });

/**
 * Video-Block-Sonderfall: `bunnyVideoId` XOR `sourceUrl`. Bewusst OHNE
 * `.refine()` an dieser Stelle — z.discriminatedUnion (zod v3) verlangt
 * reine ZodObject-Mitglieder, ein `.refine()` würde daraus ein ZodEffects
 * machen und die Union brechen. Die XOR-Prüfung läuft deshalb als
 * eigenständiger, pfadbewusster Durchgang in `collectVideoBlockErrors()`.
 */
const importVideoBlockSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.literal("video"),
  bunnyVideoId: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
});

const importBlockSchema = z.discriminatedUnion("type", [
  importTextBlockSchema,
  importImageBlockSchema,
  importVideoBlockSchema,
  importAudioBlockSchema,
  importFileBlockSchema,
  importQuizBlockSchema,
  importSubmissionBlockSchema,
  importCalloutBlockSchema,
  importEmbedBlockSchema,
]);

type ImportBlock = z.infer<typeof importBlockSchema>;

const importLessonSchema = lessonSchema.extend({
  blocks: z.array(importBlockSchema).max(200).default([]),
});

const importModuleSchema = moduleSchema.extend({
  lessons: z.array(importLessonSchema).min(1).max(MAX_LESSONS_PER_MODULE),
});

export const courseImportSchema = courseSchema.extend({
  modules: z.array(importModuleSchema).min(1).max(MAX_MODULES),
});

export type CourseImportPayload = z.infer<typeof courseImportSchema>;

export type CourseImportResult =
  | {
      ok: true;
      courseId: string;
      moduleCount: number;
      lessonCount: number;
      videoIds: string[];
    }
  | { ok: false; errors: string[] };

type ImportSupabaseClient = Awaited<ReturnType<typeof createClient>>;
type ImportTenant = Pick<PublicTenant, "id">;

/** Übersetzt einen zod-Issue-Pfad in eine lesbare deutsche Ortsangabe, z. B. "Modul 2, Lektion 3". */
function formatIssuePath(path: (string | number)[]): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const next = path[i + 1];
    if (seg === "modules" && typeof next === "number") {
      parts.push(`Modul ${next + 1}`);
      i++;
    } else if (seg === "lessons" && typeof next === "number") {
      parts.push(`Lektion ${next + 1}`);
      i++;
    } else if (seg === "blocks" && typeof next === "number") {
      parts.push(`Block ${next + 1}`);
      i++;
    } else if (typeof seg === "string") {
      parts.push(seg);
    }
  }
  return parts.length > 0 ? parts.join(", ") : "Kurs";
}

function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
}

/** XOR-Prüfung für Video-Blöcke — siehe Kommentar bei importVideoBlockSchema. */
function collectVideoBlockErrors(payload: CourseImportPayload): string[] {
  const errors: string[] = [];
  payload.modules.forEach((mod, m) => {
    mod.lessons.forEach((lesson, l) => {
      lesson.blocks.forEach((block, b) => {
        if (block.type !== "video") return;
        const hasBunnyId = typeof block.bunnyVideoId === "string" && block.bunnyVideoId.length > 0;
        const hasSourceUrl = typeof block.sourceUrl === "string" && block.sourceUrl.length > 0;
        if (hasBunnyId === hasSourceUrl) {
          errors.push(
            `Modul ${m + 1}, Lektion ${l + 1}, Block ${b + 1}: Video-Block benötigt genau eines von „bunnyVideoId" oder „sourceUrl".`,
          );
        }
      });
    });
  });
  return errors;
}

/**
 * Löst alle Video-Blöcke EINER Lektion auf (sourceUrl -> echte bunnyVideoId,
 * inkl. bunny_videos-Zeile) und generiert fehlende Block-IDs. Wirft nie —
 * gibt bei Fehlern eine pfadbewusste Fehlermeldung zurück, damit der Aufrufer
 * ohne Teil-Schreibvorgang abbrechen kann.
 */
async function resolveLessonBlocks(
  supabase: ImportSupabaseClient,
  tenant: ImportTenant,
  userId: string,
  blocks: ImportBlock[],
  moduleIndex: number,
  lessonIndex: number,
  videoTitlePrefix: string,
): Promise<{ ok: true; blocks: Block[]; videoIds: string[] } | { ok: false; error: string }> {
  const resolved: Block[] = [];
  const videoIds: string[] = [];

  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    const id = block.id ?? crypto.randomUUID();

    if (block.type !== "video") {
      resolved.push({ ...block, id } as Block);
      continue;
    }

    let bunnyVideoId: string;
    if (block.sourceUrl) {
      try {
        const uploaded = await reuploadVideoFromUrl(
          block.sourceUrl,
          `${videoTitlePrefix} — Block ${b + 1}`,
        );
        bunnyVideoId = uploaded.guid;
      } catch (e) {
        return {
          ok: false,
          error: `Modul ${moduleIndex + 1}, Lektion ${lessonIndex + 1}, Block ${b + 1}: Video-Reupload fehlgeschlagen — ${
            e instanceof Error ? e.message : "unbekannter Fehler"
          }`,
        };
      }

      // Mandantenbindung (Sicherheitsfix aus Phase 1 Block 7, hier
      // wiederverwendet): MUSS vor saveLessonBlocks() geschehen, sonst weist
      // dessen Tenant-Ownership-Check die frisch angelegte Video-ID zurück.
      const { error: bindError } = await supabase.from("bunny_videos").insert({
        tenant_id: tenant.id,
        video_id: bunnyVideoId,
        created_by: userId,
      });
      if (bindError) {
        await deleteBunnyVideo(bunnyVideoId).catch(() => {});
        return {
          ok: false,
          error: `Modul ${moduleIndex + 1}, Lektion ${lessonIndex + 1}, Block ${b + 1}: Video konnte nicht zugeordnet werden — ${bindError.message}`,
        };
      }
      videoIds.push(bunnyVideoId);
    } else {
      // Direkt angegebene bunnyVideoId — muss bereits über bunny_videos an
      // diesen Mandanten gebunden sein, sonst weist saveLessonBlocks() sie
      // zurück (bewusst kein automatisches Registrieren fremder IDs hier).
      bunnyVideoId = block.bunnyVideoId as string;
    }

    resolved.push({ id, type: "video", bunnyVideoId });
  }

  return { ok: true, blocks: resolved, videoIds };
}

/**
 * Hauptfunktion des Migrations-Importers. `supabase` ist der Session-Client
 * des aufrufenden Staff-Mitglieds (RLS greift, gleicher Client wie bei
 * saveLessonBlocks()). `tenant`/`userId` müssen vom Aufrufer bereits über
 * requireStaffTenant() geprüft worden sein — diese Funktion prüft selbst
 * keine Berechtigung (analog src/lib/gdpr/export.ts).
 *
 * Validiert das GESAMTE Payload zuerst vollständig, bevor irgendetwas
 * geschrieben wird. Insert-Reihenfolge (zwingend, siehe PHASENSTATUS.md):
 * courses -> modules -> je Lektion: Video-Blöcke auflösen + bunny_videos
 * befüllen -> lessons (leere Blocks) -> saveLessonBlocks() je Lektion.
 */
export async function importCourseData(
  supabase: ImportSupabaseClient,
  tenant: ImportTenant,
  userId: string,
  data: unknown,
): Promise<CourseImportResult> {
  const parsed = courseImportSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, errors: formatZodErrors(parsed.error) };
  }
  const payload = parsed.data;

  const videoErrors = collectVideoBlockErrors(payload);
  if (videoErrors.length > 0) {
    return { ok: false, errors: videoErrors };
  }

  const { data: courseRow, error: courseError } = await supabase
    .from("courses")
    .insert({
      tenant_id: tenant.id,
      title: payload.title,
      slug: payload.slug,
      description: payload.description ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (courseError || !courseRow) {
    const message =
      courseError?.code === "23505"
        ? "Slug bereits vergeben."
        : `Kurs-Anlage fehlgeschlagen: ${courseError?.message ?? "unbekannter Fehler"}`;
    return { ok: false, errors: [message] };
  }
  const courseId = courseRow.id as string;

  let lessonCount = 0;
  const allVideoIds: string[] = [];

  for (let m = 0; m < payload.modules.length; m++) {
    const mod = payload.modules[m];

    const { data: moduleRow, error: moduleError } = await supabase
      .from("modules")
      .insert({
        tenant_id: tenant.id,
        course_id: courseId,
        title: mod.title,
        position: m,
      })
      .select("id")
      .single();
    if (moduleError || !moduleRow) {
      return {
        ok: false,
        errors: [`Modul ${m + 1}: Anlage fehlgeschlagen — ${moduleError?.message ?? "unbekannter Fehler"}`],
      };
    }
    const moduleId = moduleRow.id as string;

    for (let l = 0; l < mod.lessons.length; l++) {
      const lesson = mod.lessons[l];

      const resolution = await resolveLessonBlocks(
        supabase,
        tenant,
        userId,
        lesson.blocks,
        m,
        l,
        `${payload.title} — ${lesson.title}`,
      );
      if (!resolution.ok) {
        return { ok: false, errors: [resolution.error] };
      }

      // Endgültige Validierung gegen das bestehende, sicherheitsgeprüfte
      // blockSchema — reine Absicherung, saveLessonBlocks() validiert
      // ohnehin noch einmal (u. a. HTML-Sanitizing).
      const finalBlocksParsed = blocksSchema.safeParse(resolution.blocks);
      if (!finalBlocksParsed.success) {
        return {
          ok: false,
          errors: [
            `Modul ${m + 1}, Lektion ${l + 1}: ${finalBlocksParsed.error.issues[0]?.message ?? "Ungültige Blöcke."}`,
          ],
        };
      }

      const { data: lessonRow, error: lessonError } = await supabase
        .from("lessons")
        .insert({
          tenant_id: tenant.id,
          module_id: moduleId,
          title: lesson.title,
          position: l,
          blocks: [],
        })
        .select("id")
        .single();
      if (lessonError || !lessonRow) {
        return {
          ok: false,
          errors: [
            `Modul ${m + 1}, Lektion ${l + 1}: Anlage fehlgeschlagen — ${lessonError?.message ?? "unbekannter Fehler"}`,
          ],
        };
      }
      const lessonId = lessonRow.id as string;

      // Wiederverwendung des bestehenden, sicherheitsgeprüften Schreibpfads
      // (Sanitizing + bunny_videos-Tenant-Check) statt eigener Insert-Logik.
      const saveResult = await saveLessonBlocks(lessonId, courseId, finalBlocksParsed.data);
      if (saveResult.error) {
        return {
          ok: false,
          errors: [
            `Modul ${m + 1}, Lektion ${l + 1}: Blöcke konnten nicht gespeichert werden — ${saveResult.error}`,
          ],
        };
      }

      allVideoIds.push(...resolution.videoIds);
      lessonCount++;
    }
  }

  return {
    ok: true,
    courseId,
    moduleCount: payload.modules.length,
    lessonCount,
    videoIds: allVideoIds,
  };
}
