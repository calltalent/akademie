import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Link as LinkIcon,
  Folder,
  Video,
  MessageCircle,
  Users,
  Calendar,
  FileText,
  Globe,
  Mail,
  Phone,
  User as UserIcon,
  Megaphone,
  type LucideIcon,
} from "lucide-react";

/** Icon-Schlüssel (kebab-case, DB-Wert, CUSTOMER_AREA_ICONS) -> lucide-Komponente. */
const ICON_MAP: Record<string, LucideIcon> = {
  link: LinkIcon,
  folder: Folder,
  video: Video,
  "message-circle": MessageCircle,
  users: Users,
  calendar: Calendar,
  "file-text": FileText,
  globe: Globe,
  mail: Mail,
  phone: Phone,
};

export type CustomerAreaViewItem = {
  id: string;
  kind: "link" | "contact" | "announcement";
  title: string | null;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  icon: string | null;
  itemDate: string | null;
  trainer: { name: string; role: string | null; imageUrl: string | null; phone: string | null; email: string | null } | null;
};

/**
 * "Meine Kunden Area" — Lernansicht (Plan Abschnitt 4,
 * verwende-den-planungs-agenten-sequential-frost.md). Reine
 * Darstellungskomponente, Server Component ohne `"use client"`: die
 * Gruppenfilterung steckt vollständig in der SELECT-Policy von
 * `customer_area_items` (Migration 20260805090000_customer_area.sql) — diese
 * Komponente kennt weder Gruppen noch Zuordnungen, bekommt nur die bereits
 * sichtbaren Zeilen.
 *
 * Eigenständiges Design nach `DESIGN-MASTERPROMPT.md` (Marken-Tokens
 * #5663AE/#3E3F66/#1A1A2E/#F7EED4/#66679B/#A9AAC4/#E7E8F2, Radius 14px) —
 * keine Übernahme des im Plan erwähnten Baulig-Vorbilds (CLAUDE.md §3.1).
 * Leere Abschnitte entfallen komplett samt Überschrift; sind alle drei leer,
 * ein ehrlicher Leerzustand statt einer leeren Seite.
 */
export function CustomerAreaView({ items, userName }: { items: CustomerAreaViewItem[]; userName: string }) {
  const t = useTranslations("learn.customerArea");

  const links = items.filter((i) => i.kind === "link");
  const contacts = items.filter((i) => i.kind === "contact" && i.trainer);
  const announcements = items.filter((i) => i.kind === "announcement");
  const hasAnyContent = links.length > 0 || contacts.length > 0 || announcements.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl px-7 py-6" style={{ background: "#3E3F66" }}>
        <p className="text-[13px] font-semibold uppercase" style={{ color: "#B9BBDA", letterSpacing: "0.08em" }}>
          {t("bannerEyebrow")}
        </p>
        <p className="mt-1 text-[20px] font-bold text-white">{t("bannerGreeting", { name: userName })}</p>
        <p className="mt-1 text-[15px]" style={{ color: "#D6D7EC" }}>
          {t("bannerBody")}
        </p>
      </section>

      {!hasAnyContent && (
        <div
          className="rounded-2xl border bg-white px-6 py-10 text-center text-sm"
          style={{ borderColor: "#E7E8F2", color: "#A9AAC4" }}
        >
          {t("emptyAll")}
        </div>
      )}

      {links.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-bold" style={{ color: "#1A1A2E" }}>
            {t("linksHeading")}
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((item) => {
              const Icon = (item.icon && ICON_MAP[item.icon]) || LinkIcon;
              const isExternal = !item.url?.startsWith("/");
              const cardClassName =
                "flex h-full items-start gap-3 rounded-2xl border bg-white px-5 py-4 no-underline transition-colors hover:bg-[rgba(86,99,174,0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";
              const cardStyle = { borderColor: "#E7E8F2" };
              const inner = (
                <>
                  <span
                    className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px]"
                    style={{ background: "#EEF0F7", color: "#5663AE" }}
                    aria-hidden="true"
                  >
                    <Icon size={18} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold" style={{ color: "#1A1A2E" }}>
                      {item.title}
                    </span>
                    {item.description && (
                      <span className="mt-0.5 text-sm" style={{ color: "#66679B" }}>
                        {item.description}
                      </span>
                    )}
                  </span>
                </>
              );
              return (
                <li key={item.id}>
                  {isExternal ? (
                    <a href={item.url ?? "#"} target="_blank" rel="noopener noreferrer" className={cardClassName} style={cardStyle}>
                      {inner}
                    </a>
                  ) : (
                    <Link href={item.url ?? "#"} prefetch={false} className={cardClassName} style={cardStyle}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {contacts.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-bold" style={{ color: "#1A1A2E" }}>
            {t("contactsHeading")}
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contacts.map((item) => {
              const trainer = item.trainer!;
              return (
                <li key={item.id} className="rounded-2xl border bg-white px-5 py-4" style={{ borderColor: "#E7E8F2" }}>
                  <div className="flex items-center gap-3">
                    {trainer.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                      <img src={trainer.imageUrl} alt="" className="h-12 w-12 flex-none rounded-full object-cover" />
                    ) : (
                      <span
                        className="flex h-12 w-12 flex-none items-center justify-center rounded-full"
                        style={{ background: "#EEF0F7", color: "#A9AAC4" }}
                      >
                        <UserIcon size={20} aria-hidden="true" />
                      </span>
                    )}
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold" style={{ color: "#1A1A2E" }}>
                        {trainer.name}
                      </span>
                      {trainer.role && (
                        <span className="truncate text-sm" style={{ color: "#66679B" }}>
                          {trainer.role}
                        </span>
                      )}
                    </div>
                  </div>
                  {(trainer.phone || trainer.email) && (
                    <div className="mt-3 flex flex-col gap-1.5 text-sm">
                      {trainer.phone && (
                        <a
                          href={`tel:${trainer.phone}`}
                          aria-label={t("contactPhoneAria", { name: trainer.name, phone: trainer.phone })}
                          className="flex items-center gap-2 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                          style={{ color: "#5663AE" }}
                        >
                          <Phone size={15} aria-hidden="true" />
                          {trainer.phone}
                        </a>
                      )}
                      {trainer.email && (
                        <a
                          href={`mailto:${trainer.email}`}
                          aria-label={t("contactEmailAria", { name: trainer.name, email: trainer.email })}
                          className="flex items-center gap-2 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                          style={{ color: "#5663AE" }}
                        >
                          <Mail size={15} aria-hidden="true" />
                          {trainer.email}
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {announcements.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-bold" style={{ color: "#1A1A2E" }}>
            {t("announcementsHeading")}
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {announcements.map((item) => (
              <li
                key={item.id}
                className="flex h-full flex-col overflow-hidden rounded-2xl border bg-white"
                style={{ borderColor: "#E7E8F2" }}
              >
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage-URL, kein next/image-Loader konfiguriert
                  <img src={item.imageUrl} alt="" className="aspect-video w-full object-cover object-center" />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center" style={{ background: "#EEF0F7" }} aria-hidden="true">
                    <Megaphone size={26} style={{ color: "#A9AAC4" }} />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-5">
                  {item.itemDate && (
                    <span className="mb-1.5 text-xs font-semibold uppercase" style={{ color: "#A9AAC4", letterSpacing: "0.03em" }}>
                      {new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(
                        new Date(`${item.itemDate}T00:00:00`),
                      )}
                    </span>
                  )}
                  <span className="font-bold" style={{ color: "#1A1A2E" }}>
                    {item.title}
                  </span>
                  {item.description && (
                    <span className="mt-1.5 text-sm" style={{ color: "#66679B" }}>
                      {item.description}
                    </span>
                  )}
                  {item.url && (
                    <a
                      href={item.url}
                      target={item.url.startsWith("/") ? undefined : "_blank"}
                      rel={item.url.startsWith("/") ? undefined : "noopener noreferrer"}
                      className="mt-auto inline-flex w-fit items-center gap-1.5 pt-3 text-sm font-semibold no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                      style={{ color: "#5663AE" }}
                    >
                      {t("announcementCtaLabel")}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12h14"></path>
                        <path d="m13 6 6 6-6 6"></path>
                      </svg>
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
