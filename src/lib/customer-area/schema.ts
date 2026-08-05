import { z } from "zod";

/**
 * "Meine Kunden Area" (Plan Abschnitt 1–2,
 * verwende-den-planungs-agenten-sequential-frost.md). Trennung
 * schema.ts/actions.ts wie `src/lib/marketplace/{schema,actions}.ts`: eine
 * `"use server"`-Datei darf laut Next.js nur async Server Actions
 * exportieren — zod-Schemas, Konstanten und reine (synchrone)
 * Hilfsfunktionen leben deshalb hier, damit sie sowohl von
 * `customer-area/actions.ts` als auch verlustfrei von einem Vitest-Test
 * importiert werden können.
 */

export const CUSTOMER_AREA_ITEM_KINDS = ["link", "contact", "announcement"] as const;
export type CustomerAreaItemKind = (typeof CUSTOMER_AREA_ITEM_KINDS)[number];

/**
 * Feste Icon-Auswahl statt Freitext/Upload — kein SVG, keine XSS-Fläche
 * (gleiche Begründung wie `asset-upload-schema.ts`). Deckt sich 1:1 mit dem
 * CHECK `customer_area_items_icon_allowed`
 * (supabase/migrations/20260805090000_customer_area.sql) — bei Änderung
 * IMMER beide Stellen zusammen anpassen (neue Migration für den CHECK).
 */
export const CUSTOMER_AREA_ICONS = [
  "link",
  "folder",
  "video",
  "message-circle",
  "users",
  "calendar",
  "file-text",
  "globe",
  "mail",
  "phone",
] as const;
export type CustomerAreaIcon = (typeof CUSTOMER_AREA_ICONS)[number];

export const CUSTOMER_AREA_VISIBILITIES = ["all", "restricted"] as const;
export type CustomerAreaVisibility = (typeof CUSTOMER_AREA_VISIBILITIES)[number];

/**
 * Spiegelt den DB-CHECK `customer_area_items_kind_shape`: zod liefert die
 * deutsche Fehlermeldung VOR dem Datenbank-Rundlauf, der CHECK sichert jeden
 * Weg an der Server Action vorbei ab (Plan Abschnitt 2). Leere optionale
 * Felder werden vom Aufrufer (Formular-Komponente) als `undefined`
 * übergeben, exakt wie beim bestehenden Muster in `settings/actions.ts`
 * (`role: role.trim() || undefined`) — kein `.preprocess()` nötig.
 */
export const customerAreaItemSchema = z
  .object({
    kind: z.enum(CUSTOMER_AREA_ITEM_KINDS),
    title: z.string().trim().min(1, "Titel erforderlich.").max(150).optional(),
    description: z.string().trim().max(1000).optional(),
    url: z
      .string()
      .trim()
      .max(2000)
      .refine((v) => v.startsWith("/") || /^https?:\/\//i.test(v), "Nur interne Pfade oder http(s)-Links erlaubt.")
      .optional(),
    // Gleicher Scheme-Refine wie `url` (Security-Review 05.08.2026, Konsistenz-
    // Fund): `imageUrl` kommt zwar in der Praxis ausschließlich über
    // `ThumbnailUpload` (Storage-Public-URL, nie ein Freitextfeld) und wird nur
    // als `<img src>` gerendert, nie als `<a href>` — `javascript:` würde dort
    // ohnehin nicht ausgeführt. Trotzdem dieselbe Whitelist wie bei `url`, statt
    // sich auf das Rendering-Detail zu verlassen.
    imageUrl: z
      .string()
      .trim()
      .max(2000)
      .refine((v) => v.startsWith("/") || /^https?:\/\//i.test(v), "Ungültige Bild-URL.")
      .optional(),
    icon: z.enum(CUSTOMER_AREA_ICONS).optional(),
    itemDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datum.")
      .optional(),
    trainerId: z.string().uuid("Ungültiger Ansprechpartner.").optional(),
    visibility: z.enum(CUSTOMER_AREA_VISIBILITIES).default("all"),
    groupIds: z.array(z.string().uuid()).max(50, "Höchstens 50 Gruppen.").default([]),
    userIds: z
      .array(z.string().uuid())
      .max(500, "Höchstens 500 Personen — für größere Kreise bitte eine Gruppe anlegen.")
      .default([]),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "link") {
      if (!data.title) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["title"], message: "Titel erforderlich." });
      if (!data.url) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "URL erforderlich." });
    }
    if (data.kind === "contact" && !data.trainerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["trainerId"], message: "Ansprechpartner erforderlich." });
    }
    if (data.kind === "announcement" && !data.title) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["title"], message: "Titel erforderlich." });
    }
  });

export type CustomerAreaItemInput = z.infer<typeof customerAreaItemSchema>;

export const customerAreaGroupNameSchema = z.string().trim().min(1, "Name erforderlich.").max(100);

/** Wiederverwendet von `setCustomerAreaGroupMembers` (actions.ts). */
export const customerAreaMemberIdsSchema = z.array(z.string().uuid()).max(500, "Höchstens 500 Personen je Gruppe.");

export type CustomerAreaItemRow = {
  id: string;
  kind: CustomerAreaItemKind;
  title: string | null;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  icon: string | null;
  itemDate: string | null;
  trainerId: string | null;
  visibility: CustomerAreaVisibility;
  position: number;
  groupIds: string[];
  userIds: string[];
};

export type CustomerAreaGroupRow = {
  id: string;
  name: string;
  memberUserIds: string[];
};

export type CustomerAreaTenantMember = { userId: string; email: string; fullName: string | null };

/** Spaltenliste für `.select(...)` gegen `customer_area_items` — einmal definiert, in actions.ts UND admin/einstellungen/page.tsx verwendet. */
export const CUSTOMER_AREA_ITEM_COLUMNS =
  "id, kind, title, description, url, image_url, icon, item_date, trainer_id, visibility, position";

type CustomerAreaItemDbRow = {
  id: string;
  kind: string;
  title: string | null;
  description: string | null;
  url: string | null;
  image_url: string | null;
  icon: string | null;
  item_date: string | null;
  trainer_id: string | null;
  visibility: string;
  position: number;
};

/** DB-Zeilenform (snake_case) -> App-Form, wiederverwendet in actions.ts (Einzelzeile) und admin/einstellungen/page.tsx (Bulk-Zuordnung). */
export function toCustomerAreaItemRow(
  row: CustomerAreaItemDbRow,
  audience: { group_id: string | null; user_id: string | null }[],
): CustomerAreaItemRow {
  return {
    id: row.id,
    kind: row.kind as CustomerAreaItemKind,
    title: row.title,
    description: row.description,
    url: row.url,
    imageUrl: row.image_url,
    icon: row.icon,
    itemDate: row.item_date,
    trainerId: row.trainer_id,
    visibility: row.visibility as CustomerAreaVisibility,
    position: row.position,
    groupIds: audience.filter((a) => a.group_id).map((a) => a.group_id as string),
    userIds: audience.filter((a) => a.user_id).map((a) => a.user_id as string),
  };
}
