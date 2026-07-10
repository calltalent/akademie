"use client";

import { useActionState } from "react";
import { createCourse } from "@/lib/courses/actions";
import { initialCourseActionState } from "@/lib/courses/state";

export function CreateCourseForm() {
  const [state, action, pending] = useActionState(
    createCourse,
    initialCourseActionState,
  );

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-md border p-4"
      style={{ borderRadius: "var(--radius)" }}
    >
      <h2 className="text-lg font-medium">Neuer Kurs</h2>
      <label className="flex flex-col gap-1 text-sm">
        Titel
        <input
          name="title"
          type="text"
          required
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Slug (URL, z. B. „einfuehrung-produkt")
        <input
          name="slug"
          type="text"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          className="rounded-md border px-3 py-2 text-base"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md px-4 py-2 text-base text-white disabled:opacity-50"
        style={{ background: "var(--color-primary)" }}
      >
        Kurs anlegen
      </button>
    </form>
  );
}
