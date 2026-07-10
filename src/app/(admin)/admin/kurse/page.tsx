import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/context";
import { CreateCourseForm } from "@/components/admin/create-course-form";
import { CoursePublishToggle } from "@/components/admin/publish-toggle";

export default async function AdminKursePage() {
  const tenant = await getTenant();
  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, slug, status, updated_at")
    .eq("tenant_id", tenant!.id)
    .order("position", { ascending: true });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Kurse</h1>

      <CreateCourseForm />

      <ul className="flex flex-col gap-2">
        {(courses ?? []).map((course) => (
          <li
            key={course.id}
            className="flex items-center justify-between rounded-md border px-4 py-3 text-base"
            style={{ borderRadius: "var(--radius)" }}
          >
            <a href={`/admin/kurse/${course.id}`} className="flex-1 hover:underline">
              {course.title}
            </a>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{course.status}</span>
              <CoursePublishToggle courseId={course.id} status={course.status} />
            </div>
          </li>
        ))}
        {(!courses || courses.length === 0) && (
          <p className="text-base text-gray-500">Noch keine Kurse angelegt.</p>
        )}
      </ul>
    </div>
  );
}
