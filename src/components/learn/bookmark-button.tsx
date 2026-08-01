"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Bookmark } from "lucide-react";
import { toggleBookmark } from "@/lib/bookmarks/actions";

export function BookmarkButton({
  lessonId,
  courseSlug,
  initiallyBookmarked,
}: {
  lessonId: string;
  courseSlug: string;
  initiallyBookmarked: boolean;
}) {
  const t = useTranslations("learn.bookmarkButton");
  const [bookmarked, setBookmarked] = useState(initiallyBookmarked);
  const [pending, startTransition] = useTransition();
  const label = bookmarked ? t("remove") : t("add");

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={bookmarked}
      aria-label={label}
      title={label}
      onClick={() =>
        startTransition(async () => {
          const result = await toggleBookmark(lessonId, courseSlug);
          if (!result.error && result.bookmarked !== undefined) setBookmarked(result.bookmarked);
        })
      }
      className="inline-flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border disabled:opacity-50"
      style={{
        borderColor: bookmarked ? "var(--color-primary)" : "#D8DAEA",
        background: bookmarked ? "var(--color-primary)" : "#fff",
        color: bookmarked ? "#fff" : "#3E3F66",
      }}
    >
      <Bookmark aria-hidden="true" size={18} fill={bookmarked ? "currentColor" : "none"} />
    </button>
  );
}
