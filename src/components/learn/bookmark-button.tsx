"use client";

import { useState, useTransition } from "react";
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
  const [bookmarked, setBookmarked] = useState(initiallyBookmarked);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={bookmarked}
      onClick={() =>
        startTransition(async () => {
          const result = await toggleBookmark(lessonId, courseSlug);
          if (!result.error && result.bookmarked !== undefined) setBookmarked(result.bookmarked);
        })
      }
      className="inline-flex items-center gap-2 rounded-[11px] border px-4 py-[11px] text-sm font-semibold disabled:opacity-50"
      style={{
        borderColor: bookmarked ? "var(--color-primary)" : "#D8DAEA",
        background: bookmarked ? "var(--color-primary)" : "#fff",
        color: bookmarked ? "#fff" : "#3E3F66",
      }}
    >
      <Bookmark aria-hidden="true" size={15} fill={bookmarked ? "currentColor" : "none"} />
      {bookmarked ? "Gemerkt" : "Lesezeichen"}
    </button>
  );
}
