// Calltalent-Akademie — minimaler Service Worker (Phase 4, Block 5).
// Statische Datei, KEIN Build-Schritt. Zwei Aufgaben:
//   1. App-Shell-Caching (Installierbarkeit) — NUR eine kleine, feste Liste
//      öffentlicher, mandanten-neutraler Assets. Network-first mit
//      Cache-Fallback NUR für Navigations-Requests. Alle anderen Requests
//      (API-Routen, /admin/*, /portal/*, personalisierte Seiten) werden
//      UNVERÄNDERT durchgereicht, NIE gecacht — ein Service-Worker-Cache ist
//      ungeschützt vor RLS und würde sonst mandanten-/nutzerspezifische
//      Daten geräteweit zwischenspeichern (siehe PHASENSTATUS.md Block 5).
//      Bunny-Kursvideos bleiben bewusst online-only, kein Offline-Caching.
//   2. Web-Push-Anzeige — reiner Empfänger, zeigt an, was der Server über
//      sendPushNotification() (src/lib/push/send.ts) schickt.

const CACHE_NAME = "akademie-shell-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        // Fehler beim Vorab-Caching darf die Installation nicht blockieren.
      }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .catch(() => {}),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Nur GET-Navigations-Requests behandeln — alles andere (API, POST,
  // personalisierte/Admin-/Portal-Routen) unangetastet durchreichen.
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseCopy = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, responseCopy))
          .catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
  );
});

// Web-Push-Anzeige (Phase 4, Block 5) — ohne diesen Handler würde eine vom
// Server gesendete Push-Nachricht nie als Benachrichtigung sichtbar, das
// Fundament wäre unvollständig nachweisbar ("Push funktioniert").
self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: "Calltalent-Akademie", body: event.data.text() };
    }
  }

  const title = payload.title || "Calltalent-Akademie";
  const options = {
    body: payload.body || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});
