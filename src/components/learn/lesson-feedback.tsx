"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Star, X } from "lucide-react";
import { submitContactForm } from "@/lib/contact/actions";
import { initialContactActionState } from "@/lib/contact/state";
import { CONTACT_SUBJECTS } from "@/lib/contact/schema";

const ACCENT = "#5663AE";
const NAVY = "#3E3F66";

/**
 * Lektions-Feedback (Josips Auftrag, 26.07.2026: "Feedback-Button unter den
 * Lektionen soll einen Block unter dem Kurs-Block aufklappen und dort die
 * Eingabefelder aus dem Kontaktformular zeigen, so dass der Besucher die
 * Kursseite nicht verlassen muss — beim Versenden klappt der Block wieder
 * ein"). Nutzt denselben Server Action/Schema wie /kontakt
 * (submitContactForm, contactFormSchema) — kein Parallel-Formular, nur eine
 * andere Einbettung.
 *
 * Die Lektions-Karte (BlockRenderer etc.) bleibt eine async Server-
 * Komponente in `l/[lessonId]/page.tsx` und kann deshalb nicht einfach in
 * dieses Client Component hineingezogen werden. Stattdessen rendert dieser
 * Toggle den Stern-Button an seiner Stelle im Footer normal, das Panel
 * selbst aber per Portal in ein Ziel-Element (`#lesson-feedback-panel-
 * target`), das die Server-Komponente direkt UNTER der Lektions-Karte
 * platziert — so bleibt der geteilte Auf-/Zu-Zustand in einer einzigen
 * Komponente, ohne die Karte umbauen zu müssen.
 */
export function LessonFeedbackToggle({
  courseTitle,
  lessonTitle,
  userFirstName,
  userLastName,
  userEmail,
}: {
  courseTitle: string;
  lessonTitle: string;
  userFirstName: string;
  userLastName: string;
  userEmail: string;
}) {
  const t = useTranslations("learn.feedback");
  const [open, setOpen] = useState(false);
  // Lazy-initialisiert statt per Effect gesetzt: das Ziel-Element ist Teil
  // des server-gerenderten HTML (siehe `#lesson-feedback-panel-target` in
  // l/[lessonId]/page.tsx) und existiert daher bereits, wenn diese
  // Komponente zum ersten Mal rendert.
  const [portalTarget] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.getElementById("lesson-feedback-panel-target"),
  );
  const [state, action, pending] = useActionState(submitContactForm, initialContactActionState);
  const wasSuccessRef = useRef(false);

  useEffect(() => {
    if (state.success && !wasSuccessRef.current) {
      wasSuccessRef.current = true;
      setOpen(false);
    }
    if (!state.success) wasSuccessRef.current = false;
  }, [state.success]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("toggleButton")}
        title={t("toggleButton")}
        className="inline-flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border"
        style={{
          borderColor: open ? ACCENT : "#D8DAEA",
          background: open ? "#EEF0F7" : "#fff",
        }}
      >
        <Star size={18} color={ACCENT} fill={open ? ACCENT : "none"} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && portalTarget
        ? createPortal(
            <div className="mt-5 overflow-hidden rounded-[16px] border bg-white" style={{ borderColor: "#E7E8F2" }}>
              <div
                className="flex items-center justify-between gap-3 border-b p-[18px_22px]"
                style={{ borderColor: "#EEF0F7" }}
              >
                <div className="min-w-0">
                  <div className="text-base font-extrabold" style={{ color: "#1A1A2E" }}>
                    {t("panelHeading")}
                  </div>
                  <div className="mt-0.5 truncate text-sm" style={{ color: "#66679B" }}>
                    {courseTitle} · {lessonTitle}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("closeButton")}
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px]"
                  style={{ background: "#F0F1F8", color: NAVY }}
                >
                  <X size={16} />
                </button>
              </div>

              <form action={action} className="flex flex-col gap-4 p-[22px]">
                <div className="flex gap-4">
                  <label className="flex flex-1 flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                    {t("firstNameLabel")}
                    <input
                      name="firstName"
                      type="text"
                      required
                      defaultValue={userFirstName}
                      className="rounded-xl border px-[15px] py-[13px] text-base font-normal"
                      style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                    {t("lastNameLabel")}
                    <input
                      name="lastName"
                      type="text"
                      required
                      defaultValue={userLastName}
                      className="rounded-xl border px-[15px] py-[13px] text-base font-normal"
                      style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                  {t("emailLabel")}
                  <input
                    name="email"
                    type="email"
                    required
                    defaultValue={userEmail}
                    className="rounded-xl border px-[15px] py-[13px] text-base font-normal"
                    style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
                  />
                </label>

                <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                  {t("subjectLabel")}
                  <select
                    name="subject"
                    required
                    defaultValue="Feedback zu einer Lektion"
                    className="rounded-xl border bg-white px-[15px] py-[13px] text-base font-normal"
                    style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
                  >
                    {CONTACT_SUBJECTS.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-[7px] text-sm font-semibold" style={{ color: "#3E3F66" }}>
                  {t("messageLabel")}
                  <textarea
                    name="message"
                    rows={4}
                    required
                    defaultValue={t("messagePrefix", { courseTitle, lessonTitle })}
                    className="resize-y rounded-xl border px-[15px] py-[13px] text-base font-normal"
                    style={{ borderColor: "#D8DAEA", color: "#1A1A2E" }}
                  />
                </label>

                {state.error && (
                  <p role="alert" className="text-sm" style={{ color: "#B24343" }}>
                    {state.error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={pending}
                  className="self-start rounded-xl px-6 py-[13px] text-base font-bold text-white disabled:opacity-50"
                  style={{ background: ACCENT }}
                >
                  {pending ? t("sendingState") : t("submitButton")}
                </button>
              </form>
            </div>,
            portalTarget,
          )
        : null}
    </>
  );
}
