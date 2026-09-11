"use client";

import { useEffect, useRef } from "react";

/**
 * Affiliate-System, Block B6-B — Fokusführung nach einer Server Action
 * (PLAN_Affiliate-System.md 8.5, vorletzter Punkt).
 *
 * Das Problem, das dieser Hook löst, sieht ein sehender Nutzer nie:
 * `revalidatePath()` rendert die Seite neu, und der Fokus liegt danach je
 * nach Fall am Dokumentanfang oder an einem Element, das es nicht mehr gibt
 * (eine freigegebene Bewerbung verschwindet aus dem Reiter „Bewerbungen").
 * Ein sehbehinderter Betreiber verliert damit nach JEDER Aktion seine
 * Position in einer langen Liste und muss sich neu durchtabben.
 *
 * Deshalb bekommt jede Aktion eine `role="status"`-Meldung mit
 * `tabIndex={-1}`, und der Fokus springt dorthin, sobald die Meldung
 * erscheint: die Rückmeldung wird vorgelesen UND die Position ist definiert —
 * direkt neben dem Bedienelement, das die Aktion ausgelöst hat.
 *
 * `active` ist der Erfolgs- bzw. Fehlerzustand der Action. Der Hook fokussiert
 * nur beim Wechsel von `false` auf `true`; ein erneutes Rendern derselben
 * Meldung reißt den Fokus nicht wieder an sich.
 */
export function useStatusFocus<T extends HTMLElement = HTMLParagraphElement>(
  active: boolean,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const wasActive = useRef(false);

  useEffect(() => {
    if (active && !wasActive.current) {
      ref.current?.focus();
    }
    wasActive.current = active;
  }, [active]);

  return ref;
}
