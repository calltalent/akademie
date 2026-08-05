import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createE2eAdminClient, tenantUrl } from "./helpers/test-data";

/**
 * Phase 4, Block 6 — course-generator.spec.ts. Bedingt übersprungen, falls
 * ANTHROPIC_API_KEY/CRON_PROCESS_SECRET fehlen (kostet ca. 0,50–1,00 € pro
 * Lauf).
 *
 * KRITISCH (siehe PHASENSTATUS.md Block 6 / architect-Plan): es gibt KEINEN
 * funktionierenden Cron im lokalen Dev-Setup — dieser Test treibt die
 * Zustandsmaschine selbst an (`POST /api/admin/ki/process` mit
 * `x-cron-secret`), genau wie es der echte Cloudflare-Cron-Trigger täte.
 * Erwartet werden 3 Aufrufe (Gliederung → Lektionsinhalte → Quiz), max. 5
 * als Sicherheitsmarge. Nach jedem Aufruf wird der tatsächliche
 * Job-Status über `GET /api/admin/ki/status?jobId=` geprüft (nicht nur der
 * Rückgabewert von `process`) — robust auch falls der Cron-Endpunkt aus
 * irgendeinem Grund zuerst einen anderen, älteren `course_gen`-Job in der
 * Warteschlange verarbeitet.
 */
test.skip(
  !process.env.ANTHROPIC_API_KEY || !process.env.CRON_PROCESS_SECRET,
  "ANTHROPIC_API_KEY/CRON_PROCESS_SECRET nicht gesetzt — Kurs-Generator-Test übersprungen (kostet echte Anthropic-Kosten, ca. 0,50–1,00 € pro Lauf).",
);

test.use({ storageState: "e2e/.auth/staff.json" });

const LESSON_TEXT = `Digitale Ablage fuer kleine Teams

Viele kleine Teams verlieren Zeit, weil Dateien auf unterschiedlichen
Geraeten, in E-Mail-Postfaechern und in Chat-Verlaeufen verstreut liegen.
Eine einfache, gemeinsame Ablagestruktur mit klaren Ordnernamen und
einer Namenskonvention fuer Dateien reduziert Suchzeiten erheblich.

Drei Grundregeln helfen dabei: Erstens, jede Datei bekommt einen Namen
nach dem Muster Datum-Thema-Version. Zweitens, jedes Projekt bekommt
genau einen Hauptordner, keine Duplikate an mehreren Stellen. Drittens,
abgeschlossene Projekte wandern in ein Archiv, damit die aktive Ablage
uebersichtlich bleibt.

Zusaetzlich lohnt sich ein kurzes woechentliches Aufraeumen: fuenf Minuten
reichen, um neue Dateien in die richtigen Ordner zu verschieben und
Duplikate zu loeschen. Teams, die das konsequent umsetzen, berichten von
spuerbar weniger Sucherei und weniger doppelter Arbeit.`;

/** Kurze, rein textbasierte In-Memory-Test-PDF (kein Binär-Fixture nötig, pdf-lib ist bereits Dependency). */
async function buildTestPdfBuffer(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([595, 842]);
  const fontSize = 11;
  const maxWidth = 480;

  const lines: string[] = [];
  for (const paragraph of LESSON_TEXT.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let currentLine = "";
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  let y = 800;
  for (const line of lines) {
    if (y < 40) break; // Testinhalt bleibt bewusst auf einer Seite (kurz genug für die Modul-/Lektions-Caps).
    if (line) page.drawText(line, { x: 60, y, size: fontSize, font });
    y -= fontSize + 6;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

test("Kurs-Generator erzeugt Entwurf aus PDF und übernimmt ihn als Kurs", async ({ page }) => {
  const cronSecret = process.env.CRON_PROCESS_SECRET!;
  const admin: SupabaseClient = createE2eAdminClient();
  let createdCourseId: string | null = null;
  let createdJobId: string | null = null;

  try {
    const pdfBuffer = await buildTestPdfBuffer();

    // FIX (05.08.2026): "Neuer Entwurf"-Formular wurde am 19.07.2026
    // umgebaut (ki-upload-form.tsx) — kein "Arbeitstitel"-Feld mehr (Claude
    // leitet den Titel bewusst aus dem Dokument ab, siehe Kopfkommentar
    // dort), Button heißt "Entwurf generieren" statt "Kursentwurf
    // generieren". Der Datei-Input bleibt über denselben Locator erreichbar
    // (aria-label "PDF-Dokument auswählen" enthält "PDF-Dokument" als
    // Teilstring, `sr-only`-Sichtbarkeit ist für setInputFiles() unerheblich).
    await page.goto(tenantUrl("/admin/ki"));
    await page.getByLabel("PDF-Dokument").setInputFiles({
      name: "e2e-kursgenerator-test.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    const generateResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/admin/ki/generate") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Entwurf generieren" }).click();
    const generateResponse = await generateResponsePromise;
    expect(generateResponse.ok()).toBe(true);
    const generateBody = (await generateResponse.json()) as { jobId: string };
    createdJobId = generateBody.jobId;
    expect(createdJobId).toBeTruthy();

    // FIX (05.08.2026): Erfolgreicher Upload leitet seit dem 19.07.2026-Umbau
    // client-seitig zur neuen Review-Seite /admin/ki/[jobId] weiter (statt
    // eines Inline-Panels auf /admin/ki) — explizite Navigation statt auf das
    // Timing des App-eigenen `router.push()` zu vertrauen.
    await page.goto(tenantUrl(`/admin/ki/${createdJobId}`));

    let finalStatus = "queued";
    for (let attempt = 1; attempt <= 5 && finalStatus !== "done" && finalStatus !== "error"; attempt++) {
      // FIX (Josips Testlauf, 12.07.2026): page.request (Playwright
      // APIRequestContext) läuft im Node-Treiberprozess, NICHT im Browser —
      // anders als Chromium selbst löst Node/Windows `*.localhost`-
      // Subdomains nicht automatisch auf 127.0.0.1 auf
      // ("apiRequestContext.post: getaddrinfo ENOTFOUND demo-blau.localhost").
      // Fix: echten In-Browser-`fetch()` über page.evaluate() nutzen — läuft
      // im selben Origin wie die bereits offene Seite, Chromiums eigene
      // .localhost-Auflösung greift, Session-Cookies werden automatisch
      // (same-origin) mitgeschickt.
      await page.evaluate(
        async ({ url, secret }) => {
          await fetch(url, { method: "POST", headers: { "x-cron-secret": secret } });
        },
        { url: tenantUrl("/api/admin/ki/process"), secret: cronSecret },
      );
      const statusBody = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return (await res.json()) as { status: string; error?: string | null };
      }, tenantUrl(`/api/admin/ki/status?jobId=${createdJobId}`));
      finalStatus = statusBody.status;
      if (finalStatus === "error") {
        throw new Error(`Kurs-Generator-Job fehlgeschlagen: ${statusBody.error ?? "unbekannter Fehler"}`);
      }
    }
    expect(finalStatus).toBe("done");

    // Die Admin-UI (KiGeneratorPanel) pollt selbst alle 4s über
    // /api/admin/ki/status — hier nur abwarten, bis die
    // Übernehmen-Schaltfläche im bereits offenen Browser-Tab erscheint.
    const applyButton = page.getByRole("button", { name: "Als Kurs übernehmen" });
    await expect(applyButton).toBeVisible({ timeout: 30000 });
    await applyButton.click();

    const editorLink = page.getByRole("link", { name: "Zum Kurs-Editor →" });
    await expect(editorLink).toBeVisible({ timeout: 15000 });
    const href = await editorLink.getAttribute("href");
    expect(href).toBeTruthy();
    const match = href!.match(/\/admin\/kurse\/([a-f0-9-]+)/);
    expect(match).toBeTruthy();
    createdCourseId = match![1];

    // Kurs existiert, ist aber NICHT veröffentlicht — applyDraftAsCourse()
    // legt Kurse immer als Entwurf an (Redakteur-Kontrolle vor
    // Live-Schaltung, siehe src/lib/generator/apply.ts).
    // FIX (05.08.2026): Die Kursliste (/admin/kurse) hat seit dem 4-Schritte-
    // Assistenten-Umbau (25.07.2026) KEINEN "Veröffentlichen"-Button mehr pro
    // Zeile (nur noch Bearbeiten/Verschieben/Löschen) — der Status wird
    // ausschließlich im Editor selbst (Schritt 4) über ein <select> gesetzt,
    // siehe course-completion.spec.ts. Direkte DB-Prüfung ist hier robuster
    // als ein UI-Text, der an keiner Stelle mehr existiert.
    const { data: createdCourse } = await admin
      .from("courses")
      .select("status")
      .eq("id", createdCourseId)
      .single();
    expect(createdCourse?.status).toBe("draft");
  } finally {
    // Selbst-Aufräumen (dokumentierte Ergänzung zum architect-Plan, siehe
    // PHASENSTATUS.md Block 6): der generierte Kurs-Slug hängt vom
    // KI-generierten Titel ab und trägt deshalb NICHT zuverlässig das
    // "e2e-"-Präfix, an dem global-teardown.ts sonst aufräumt — der Test
    // löscht seine eigenen Zeilen deshalb direkt per courseId/jobId.
    if (createdCourseId) {
      await admin.from("courses").delete().eq("id", createdCourseId);
    }
    if (createdJobId) {
      await admin.from("ai_jobs").delete().eq("id", createdJobId);
    }
  }
});
