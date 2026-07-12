"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createWebhook, deleteWebhook } from "@/lib/settings/actions";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks/events";
import { WebhookSecretCreatedDialog } from "@/components/admin/webhook-secret-created-dialog";

const EVENT_LABELS: Record<WebhookEvent, string> = {
  "user.created": "Nutzer angelegt",
  "enrollment.created": "Einschreibung erstellt",
  "lesson.completed": "Lektion abgeschlossen",
  "course.completed": "Kurs abgeschlossen",
  "quiz.passed": "Quiz bestanden",
  "submission.created": "Abgabe eingereicht",
  "order.paid": "Zahlung erhalten",
};

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
};

export function WebhooksPanel({ webhooks }: { webhooks: WebhookRow[] }) {
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
    <section className="flex flex-col gap-4 rounded-md border p-4" style={{ borderRadius: "var(--radius)" }}>
      <div>
        <h2 className="text-lg font-medium">Webhooks</h2>
        <p className="text-sm text-gray-500">
          Ausgehende Benachrichtigungen an eine eigene URL bei den unten gewählten Ereignissen — signiert
          per HMAC-SHA256 (Header <code>X-Calltalent-Signature</code>).
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor="webhook-url">
          Ziel-URL
          <input
            id="webhook-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.example.com/calltalent"
            className="rounded-md border px-3 py-2 text-base"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Ereignisse</legend>
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-2 text-base" htmlFor={`webhook-event-${event}`}>
              <input
                id={`webhook-event-${event}`}
                type="checkbox"
                checked={selectedEvents.includes(event)}
                onChange={() => toggleEvent(event)}
              />
              {EVENT_LABELS[event]} <code className="text-sm text-gray-500">({event})</code>
            </label>
          ))}
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          {pending ? "Wird angelegt …" : "Webhook anlegen"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {webhooks.map((hook) => (
          <li
            key={hook.id}
            className="flex items-center justify-between gap-4 rounded-md border px-4 py-3 text-base"
            style={{ borderRadius: "var(--radius)" }}
          >
            <div className="flex flex-col">
              <span className="break-all">{hook.url}</span>
              <span className="text-sm text-gray-500">
                {hook.events.map((e) => EVENT_LABELS[e as WebhookEvent] ?? e).join(", ")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(hook.id)}
              disabled={pending}
              className="shrink-0 rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >
              Löschen
            </button>
          </li>
        ))}
        {webhooks.length === 0 && <p className="text-base text-gray-500">Noch keine Webhooks angelegt.</p>}
      </ul>

      {created && (
        <WebhookSecretCreatedDialog url={created.url} secret={created.secret} onClose={() => setCreated(null)} />
      )}
    </section>
  );
}
