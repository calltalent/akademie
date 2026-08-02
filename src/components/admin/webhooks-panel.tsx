"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createWebhook, deleteWebhook } from "@/lib/settings/actions";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks/events";
import { WebhookSecretCreatedDialog } from "@/components/admin/webhook-secret-created-dialog";

/** Schlüssel in messages/*.json — Punkte im Ereignisnamen sind dort keine gültigen Pfadtrenner. */
const EVENT_LABEL_KEYS = {
  "user.created": "userCreated",
  "enrollment.created": "enrollmentCreated",
  "lesson.completed": "lessonCompleted",
  "course.completed": "courseCompleted",
  "quiz.passed": "quizPassed",
  "submission.created": "submissionCreated",
  "order.paid": "orderPaid",
} as const satisfies Record<WebhookEvent, string>;

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
};

/**
 * Optik (25.07.2026, Josips Auftrag "Inhalte und Integration vom Stil her
 * an das neue Design anpassen"): gleiche Angleichung wie api-keys-panel.tsx
 * — `bg-white`/`#E7E8F2`-Rahmen/`rounded-[14px]` statt generischem Grau.
 * Reine Optik, keine Logikänderung.
 */
export function WebhooksPanel({ webhooks }: { webhooks: WebhookRow[] }) {
  const t = useTranslations("admin.settings.webhooks");
  const tEvents = useTranslations("admin.settings.webhooks.eventLabels");
  const tSettings = useTranslations("admin.settings");
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<WebhookEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; secret: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleEvent(event: WebhookEvent) {
    setSelectedEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  }

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createWebhook(url, selectedEvents);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({ url: result.url, secret: result.secret });
      setUrl("");
      setSelectedEvents([]);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteWebhook(id);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-[14px] border bg-white px-7 py-6" style={{ borderColor: "#E7E8F2" }}>
      <div>
        <div className="mb-1.5 text-[17px] font-bold">{t("heading")}</div>
        <p className="text-sm" style={{ color: "#66679B" }}>
          {t.rich("description", { code: (chunks) => <code>{chunks}</code> })}
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold" style={{ color: "#3E3F66" }} htmlFor="webhook-url">
          {t("urlLabel")}
          <input
            id="webhook-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("urlPlaceholder")}
            className="rounded-[10px] border px-3.5 py-2.5 text-base font-normal"
            style={{ borderColor: "#D8DAEA" }}
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold" style={{ color: "#3E3F66" }}>
            {t("eventsLegend")}
          </legend>
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-2 text-base" htmlFor={`webhook-event-${event}`}>
              <input
                id={`webhook-event-${event}`}
                type="checkbox"
                checked={selectedEvents.includes(event)}
                onChange={() => toggleEvent(event)}
                style={{ accentColor: "#5663AE" }}
              />
              {tEvents(EVENT_LABEL_KEYS[event])}{" "}
              <code className="text-sm" style={{ color: "#A9AAC4" }}>
                ({event})
              </code>
            </label>
          ))}
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-[10px] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
          style={{ background: "#5663AE" }}
        >
          {pending ? t("addingButton") : t("addButton")}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm font-semibold" style={{ color: "#B14A4A" }}>
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {webhooks.map((hook) => (
          <li
            key={hook.id}
            className="flex items-center justify-between gap-4 rounded-[10px] border px-4 py-3 text-base"
            style={{ borderColor: "#E7E8F2" }}
          >
            <div className="flex flex-col">
              <span className="break-all font-semibold">{hook.url}</span>
              <span className="text-sm" style={{ color: "#66679B" }}>
                {hook.events
                  .map((e) => {
                    const key = EVENT_LABEL_KEYS[e as WebhookEvent];
                    return key ? tEvents(key) : e;
                  })
                  .join(", ")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(hook.id)}
              disabled={pending}
              className="shrink-0 rounded-[10px] border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: "#E7E8F2", color: "#3E3F66" }}
            >
              {tSettings("deleteButton")}
            </button>
          </li>
        ))}
        {webhooks.length === 0 && (
          <p className="text-base" style={{ color: "#A9AAC4" }}>
            {t("empty")}
          </p>
        )}
      </ul>

      {created && (
        <WebhookSecretCreatedDialog url={created.url} secret={created.secret} onClose={() => setCreated(null)} />
      )}
    </section>
  );
}
