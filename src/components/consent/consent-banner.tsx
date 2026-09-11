"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setTrackingConsent } from "@/lib/consent/actions";
import type { ConsentDecision } from "@/lib/consent/schema";

/**
 * Affiliate-Modul, Block B2 (PLAN_Affiliate-System.md Abschnitt 10/B2,
 * 10.09.2026): der Einwilligungsdialog für die eine Cookie-Kategorie
 * „Partner-Empfehlung" (`ct_aff`, § 25 Abs. 1 TDDDG).
 *
 * Natives `<dialog>` + `showModal()` statt eines selbst gebauten Overlays —
 * Projektkonvention (api-key-created-dialog.tsx:8-13,
 * invite-user-dialog.tsx:19-26) und zugleich die Variante mit dem wenigsten
 * eigenen Code: Fokusfalle, Tastaturbedienung und `::backdrop` kommen vom
 * Browser. `role="dialog"` und `aria-modal="true"` stehen trotzdem
 * ausdrücklich im Markup: beide sind für ein modales `<dialog>` zwar
 * implizit, aber ältere Screenreader-/Browser-Kombinationen lesen die
 * impliziten Werte nicht zuverlässig, und der Auftraggeber ist auf den
 * Screenreader angewiesen (CLAUDE.md §3.4).
 *
 * Performance (Plan 10/B2 nennt diesen Baustein als EINZIGES Risiko für das
 * Budget LCP < 1 s, CLAUDE.md §3.3):
 *   - Die Entscheidung, ob der Dialog überhaupt existiert, fällt auf dem
 *     Server (src/app/layout.tsx). Wer bereits entschieden hat, bekommt diese
 *     Komponente gar nicht erst ausgeliefert — kein zusätzliches Bündel, kein
 *     zusätzliches Markup.
 *   - Ein `<dialog>` ohne `open` ist vom Browser `display: none`. Der erste
 *     Farbauftrag enthält den Dialog also nicht und wird von ihm auch nicht
 *     verzögert; geöffnet wird er erst nach der Hydration im Effekt unten.
 *   - Bewusst keine Animation und kein Übergang. Damit gibt es keine
 *     Bewegung, auf die `prefers-reduced-motion` Rücksicht nehmen müsste —
 *     die einfachste Form der Rücksicht (CLAUDE.md §3.2).
 *
 * Ohne JavaScript öffnet sich der Dialog nicht, es wird also nie eine
 * Einwilligung erteilt und folglich nie ein Attributions-Cookie gesetzt. Das
 * ist die richtige Richtung des Ausfalls: fehlende Technik darf nie in eine
 * Zustimmung umschlagen.
 */

const TITLE_ID = "consent-dialog-title";
const BODY_ID = "consent-dialog-body";
const NOTE_ID = "consent-dialog-note";

/**
 * Beide Knöpfe tragen exakt dieselbe Klasse und denselben Stil — gleiche
 * Größe, gleiche Schriftstärke, gleicher Rahmen, gleiche Farbe. Das ist
 * keine Designschwäche, sondern die Anforderung: „Ablehnen" muss optisch
 * gleichwertig zu „Annehmen" sein. Ein gefüllter Mandantenfarbe-Knopf für
 * „Annehmen" neben einem blassen Textlink „Ablehnen" wäre genau die
 * Lenkung, die eine Einwilligung unwirksam macht (Art. 4 Nr. 11 DSGVO).
 *
 * `flex-1 basis-[190px]`: beide Knöpfe sind immer gleich breit und brechen
 * bei schmalen Fenstern gemeinsam um. `min-h-[48px]` erfüllt die
 * Mindestgröße von 40 x 40 px für Klickziele (Plan 8.5) mit Reserve.
 *
 * Fokusring: `ring-accent` ist die markenfixe Periwinkle-Farbe aus
 * globals.css (#5663AE, rund 5,5:1 gegen Weiß) — bewusst NICHT
 * `--color-primary`, das jeder Mandant per Branding überschreiben darf und
 * damit auf einen unsichtbaren Fokusring gestellt werden könnte.
 */
const BUTTON_CLASS =
  "min-h-[48px] flex-1 basis-[190px] rounded-[11px] border-2 bg-white px-5 py-3 " +
  "text-[17px] font-bold focus:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-accent focus-visible:ring-offset-2";

const BUTTON_STYLE = { borderColor: "#3E3F66", color: "#1A1A2E" } as const;

export function ConsentBanner() {
  const t = useTranslations("consent");
  const tCommon = useTranslations("common");

  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstControlRef = useRef<HTMLButtonElement>(null);
  /**
   * Sperre gegen Doppelauslösung. Bewusst ein Ref und kein `disabled` auf den
   * Knöpfen: ein Knopf, der während des Speicherns deaktiviert wird, verliert
   * in allen gängigen Browsern den Tastaturfokus — ein Screenreader-Nutzer
   * stünde danach am Dokumentanfang statt an seiner Entscheidung.
   */
  const busyRef = useRef(false);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // `showModal()` setzt den Fokus selbst auf das erste bedienbare Element.
    // Der ausdrückliche Aufruf hält das unabhängig von Browser-Unterschieden
    // fest: der Fokus liegt beim Öffnen auf „Ablehnen".
    firstControlRef.current?.focus();
  }, []);

  /**
   * „Annehmen" und „Ablehnen" laufen über denselben Weg mit genau einem
   * Aufruf — Ablehnen kostet keinen Klick mehr als Annehmen (Plan B2,
   * Art. 7 Abs. 3 DSGVO).
   *
   * Der Dialog schließt erst, NACHDEM die Entscheidung gespeichert ist.
   * Andernfalls verschwände er auch dann, wenn das Speichern scheitert, und
   * der Nutzer hielte eine Entscheidung für getroffen, die es nicht ist.
   */
  function decide(decision: Exclude<ConsentDecision, "withdrawn">) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError("");

    startTransition(async () => {
      const result = await setTrackingConsent(decision);
      busyRef.current = false;

      if (!result.ok) {
        // Bewusst der übersetzte Text aus `consent.error` statt
        // `result.error`: die Meldungen der Server Action sind fest deutsch,
        // diese Oberfläche läuft aber auch auf en/bs. Der genaue Grund steht
        // im Server-Log (actions.ts), nicht im Dialog — dort hilft er
        // niemandem.
        setError(t("error"));
        return;
      }

      setSaved(decision === "granted" ? t("savedGranted") : t("savedDenied"));
      dialogRef.current?.close();
    });
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        /* Beschreibung aus BEIDEN Absätzen: Zweck und Rechtsgrundlage samt
           Widerrufshinweis gehören zusammen, sonst entscheidet jemand, der
           dem Screenreader folgt, ohne den Teil, der die Entscheidung
           umkehrbar macht (Art. 7 Abs. 3 DSGVO). */
        aria-describedby={`${BODY_ID} ${NOTE_ID}`}
        aria-busy={pending}
        /**
         * Escape ist eine Ablehnung, kein Wegklicken: `preventDefault()`
         * verhindert das sofortige Schließen, `decide("denied")` speichert
         * die Ablehnung und schließt danach selbst. Ohne das Speichern wäre
         * der Dialog beim nächsten Seitenaufruf wieder da — wer Escape
         * drückt, hat aber bereits geantwortet.
         */
        onCancel={(event) => {
          event.preventDefault();
          decide("denied");
        }}
        className="border-2 backdrop:bg-black/50"
        style={{
          // Tailwind-Preflight setzt `margin: 0` auf alle Elemente und hebt
          // damit die Zentrierung auf, die der Browser einem modalen
          // <dialog> sonst über `margin: auto` gibt (dieselbe Falle wie in
          // invite-user-dialog.tsx:19-26). Deshalb hier ausdrücklich:
          // waagerecht zentriert, unten angesetzt.
          margin: "auto auto 16px",
          width: "min(560px, calc(100vw - 32px))",
          borderColor: "#3E3F66",
          borderRadius: "var(--radius-lg)",
          background: "#FFFFFF",
          color: "#1A1A2E",
        }}
      >
        <div className="flex flex-col gap-4 p-6">
          <h2 id={TITLE_ID} className="text-[20px] font-extrabold" style={{ color: "#1A1A2E" }}>
            {t("title")}
          </h2>

          {/* 18 px Fließtext auf öffentlichen Seiten, Zeilenhöhe 1,6
              (Plan 8.5). Ink auf Weiß liegt bei rund 16:1. */}
          <p id={BODY_ID} className="text-[18px] leading-[1.6]" style={{ color: "#1A1A2E" }}>
            {t("body")}
          </p>

          {/* Navy auf Weiß, rund 10:1 — auch der Rechtshinweis bleibt
              deutlich über den geforderten 4,5:1, statt als graue Fußnote
              zu verschwinden. */}
          <p id={NOTE_ID} className="text-[16px] leading-[1.6]" style={{ color: "#3E3F66" }}>
            {t("legalNote")}
          </p>

          {/* Eigene Zeile mit Innenabstand statt eines eingebetteten
              Textlinks: so ist auch dieses Ziel groß genug zum Treffen. */}
          <a
            href="/privacy"
            className="self-start rounded-sm py-1 text-[16px] font-semibold underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            style={{ color: "#3E3F66" }}
          >
            {t("privacyLink")}
          </a>

          <div role="group" aria-label={t("dialogLabel")} className="flex flex-wrap gap-3">
            <button
              ref={firstControlRef}
              type="button"
              onClick={() => decide("denied")}
              className={BUTTON_CLASS}
              style={BUTTON_STYLE}
            >
              {t("deny")}
            </button>
            <button
              type="button"
              onClick={() => decide("granted")}
              className={BUTTON_CLASS}
              style={BUTTON_STYLE}
            >
              {t("accept")}
            </button>
          </div>

          {/* Zwei getrennte, immer vorhandene Bereiche: eine Live-Region, die
              erst beim Einfügen des Textes entsteht, wird von Screenreadern
              nicht zuverlässig vorgelesen. */}
          <p
            role="status"
            aria-live="polite"
            className="min-h-[1.5em] text-[16px]"
            style={{ color: "#3E3F66" }}
          >
            {pending ? tCommon("loading") : ""}
          </p>
          <p role="alert" className="text-[16px] font-semibold" style={{ color: "#B24343" }}>
            {error}
          </p>
        </div>
      </dialog>

      {/*
       * Bestätigung NACH dem Schließen. Sie steht außerhalb des Dialogs, weil
       * der Inhalt eines modalen Dialogs beim Schließen mit ihm verschwindet
       * und eine Ansage dann nie ankäme. Nur für Screenreader: sehende Nutzer
       * sehen die Bestätigung daran, dass der Dialog weg ist, und ein
       * Hinweisstreifen, der danach stehen bliebe, wäre genau das Rauschen,
       * das ein Einwilligungsdialog nicht hinterlassen soll.
       *
       * Den Tastaturfokus setzt hier bewusst niemand um: das native
       * `<dialog>` gibt ihn beim Schließen an die Stelle zurück, an der er
       * vor dem Öffnen stand (bei einem frisch geladenen Seitenaufruf der
       * Dokumentanfang). Ein erzwungener Sprung ans Seitenende wäre für
       * Tastaturnutzer die schlechtere Position.
       */}
      <p role="status" aria-live="polite" className="sr-only">
        {saved}
      </p>
    </>
  );
}
