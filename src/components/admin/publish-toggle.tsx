"use client";

import { useTransition } from "react";
import { updateCourseStatus, updateLessonStatus } from "@/lib/courses/actions";

export function CoursePublishToggle({
  courseId,
  status,
}: {
  courseId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const isPublished = status === "published";

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        startTransition(() =>
          updateCourseStatus(courseId, isPublished ? "draft" : "published"),
        );
      }}
      className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
    >
      {isPublished ? "Auf Entwurf setzen" : "Veröffentlichen"}
    </button>
  );
}

export function LessonPublishToggle({
  lessonId,
  courseId,
  status,
}: {
  lessonId: string;
  courseId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const isPublished = status === "published";

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(() =>
          updateLessonStatus(lessonId, courseId, isPublished ? "draft" : "published"),
        )
      }
      className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
    >
      {isPublished ? "Auf Entwurf setzen" : "Veröffentlichen"}
    </button>
  );
}
