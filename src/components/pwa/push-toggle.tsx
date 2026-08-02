"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push/actions";

type Props = { vapidPublicKey: string | null };

/**
 * „Benachrichtigungen aktivieren"-Button (Phase 4, Block 5), Einbindung auf
 * /profil (naheliegendster Ort, „meine Einstellungen"-Seite aus Block 3).
 * Server Component (`profil/page.tsx`) übergibt den ÖFFENTLICHEN VAPID-Key
 * als Prop (aus `publicEnv`, kein Secret) — diese Client-Komponente macht
 * den Rest (`Notification.requestPermission()`, `pushManager.subscribe()`).
 * Gleiches Server-/Client-Trennungsmuster wie `DeletionRequestForm`
 * gegenüber `profil/page.tsx`.
 *
 * Falls `NEXT_PUBLIC_VAPID_PUBLIC_KEY` nicht gesetzt ist: Hinweistext statt
 * Button (kein Absturz) — siehe PHASENSTATUS.md Block-5-Plan Punkt 7.
 */
export function PushToggle({ vapidPublicKey }: Props) {
  const t = useTranslations("portal.settings.push");
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return;
    }
    // Korrektur (Josips Lint-Lauf, 12.07.2026): setSupported(true) lief
    // vorher synchron im Effect-Body (react-hooks/set-state-in-effect).
    // Über queueMicrotask in einen eigenen Callback verschoben, Verhalten
    // unverändert (Ausführung noch vor dem nächsten Paint).
    queueMicrotask(() => setSupported(true));

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  if (!vapidPublicKey) {
    return (
      <p className="text-sm text-gray-500">
        {t("notConfigured")}
      </p>
    );
  }

  if (!supported) {
    return <p className="text-sm text-gray-500">{t("unsupported")}</p>;
  }

  function handleSubscribe() {
    startTransition(async () => {
      setMessage(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setMessage(t("permissionDenied"));
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
        });

        const result = await subscribeToPush(subscription.toJSON());
        if (result.error) {
          setMessage(result.error);
          return;
        }

        setSubscribed(true);
        setMessage(t("enabled"));
      } catch {
        setMessage(t("enableFailed"));
      }
    });
  }

  function handleUnsubscribe() {
    startTransition(async () => {
      setMessage(null);
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await unsubscribeFromPush(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setSubscribed(false);
        setMessage(t("disabled"));
      } catch {
        setMessage(t("disableFailed"));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={subscribed ? handleUnsubscribe : handleSubscribe}
        disabled={pending}
        aria-pressed={subscribed}
        className="w-fit rounded-md px-4 py-2 text-base font-medium text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2"
        style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
      >
        {pending
          ? t("activating")
          : subscribed
            ? t("disable")
            : t("enable")}
      </button>
      {message && (
        <p role="status" aria-live="polite" className="text-sm text-gray-600">
          {message}
        </p>
      )}
    </div>
  );
}

/** Standard-Konvertierung für `PushManager.subscribe({ applicationServerKey })" — der Browser erwartet ein Uint8Array, VAPID-Keys liegen als URL-safe Base64 vor. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
