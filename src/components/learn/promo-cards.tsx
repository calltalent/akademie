import { createClient } from "@/lib/supabase/server";
import { getVideoThumbnailUrl } from "@/lib/bunny/client";

const NAVY = "#3E3F66";

type PromoCardData = {
  id: string;
  title: string;
  description: string | null;
  media_kind: string;
  image_url: string | null;
  bunny_video_id: string | null;
  link_url: string | null;
};

/**
 * Admin-verwaltete Kärtchen in der rechten Spalte der Kurs-/Lektionsansicht
 * (Josips Auftrag, 24.07.2026) — ersetzt die bisher fest verdrahteten
 * "Kostenloses Erstgespräch buchen"/"Nutze die Calltalent-App"-Kärtchen in
 * `kurs/[slug]/page.tsx` und `kurs/[slug]/m/[moduleId]/page.tsx`. Verwaltung
 * unter `/admin/einstellungen` (`promo-cards-panel.tsx`).
 *
 * Async Server Component, gleiches Selbst-Fetch-Muster wie
 * `CertificateBadge` — jede Seite, die die rechte Spalte zeigt, bindet nur
 * `<PromoCards tenantId={tenant.id} />` ein, ohne selbst eine zusätzliche
 * Abfrage zu bauen. Keine Positionen angelegt → `null` (ehrlicher
 * Leerzustand, DESIGN-MASTERPROMPT.md §8.1 — keine erfundenen Kärtchen).
 *
 * Video-Positionen zeigen nur ein Standbild (`getVideoThumbnailUrl`, Bunny
 * Stream) statt eines Inline-Players — die Spalte ist dafür zu schmal,
 * gleiche Vereinfachung wie die bisherigen statischen Platzhalter.
 */
export async function PromoCards({ tenantId }: { tenantId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("promo_cards")
    .select("id, title, description, media_kind, image_url, bunny_video_id, link_url")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  const cards = (data ?? []) as PromoCardData[];
  if (cards.length === 0) return null;

  return (
    <>
      {cards.map((card) => (
        <PromoCard key={card.id} card={card} />
      ))}
    </>
  );
}

function PromoCard({ card }: { card: PromoCardData }) {
  const thumbnailUrl =
    card.media_kind === "video" && card.bunny_video_id
      ? getVideoThumbnailUrl(card.bunny_video_id)
      : card.image_url;

  const body = (
    <>
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Storage-/Bunny-URL, kein next/image-Loader konfiguriert
        <img src={thumbnailUrl} alt="" className="h-[130px] w-full object-cover object-center" />
      ) : (
        <div
          className="h-[130px]"
          style={{
            backgroundColor: "#DFE2F4",
            backgroundImage: "repeating-linear-gradient(45deg,#DFE2F4 0 12px, rgba(255,255,255,.55) 12px 24px)",
          }}
          aria-hidden="true"
        />
      )}
      <div className="p-[16px_18px]">
        <div className="text-base font-extrabold" style={{ color: NAVY }}>
          {card.title}
        </div>
        {card.description && (
          <div className="mt-1 text-[13px]" style={{ color: "#66679B" }}>
            {card.description}
          </div>
        )}
      </div>
    </>
  );

  const className = "block overflow-hidden rounded-[16px] border no-underline";
  const style = { background: "#EDEEF7", borderColor: "#E0E2EF" };

  if (card.link_url) {
    return (
      <a href={card.link_url} className={className} style={style}>
        {body}
      </a>
    );
  }
  return (
    <div className={className} style={style}>
      {body}
    </div>
  );
}
