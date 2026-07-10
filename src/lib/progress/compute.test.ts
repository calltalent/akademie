import { describe, expect, it } from "vitest";
import {
  computeCourseProgress,
  flattenLessonIds,
  findAdjacentLessonIds,
  type ModuleSummary,
} from "./compute";

const modules: ModuleSummary[] = [
  {
    id: "m1",
    lessons: [
      { id: "l1", completed: true },
      { id: "l2", completed: false },
    ],
  },
  {
    id: "m2",
    lessons: [{ id: "l3", completed: true }],
  },
];

describe("computeCourseProgress", () => {
  it("zählt Lektionen und berechnet Prozent korrekt", () => {
    const result = computeCourseProgress(modules);
    expect(result).toEqual({ total: 3, completed: 2, percent: 67, isComplete: false });
  });

  it("isComplete nur wenn alle Lektionen fertig UND mindestens eine existiert", () => {
    expect(computeCourseProgress([]).isComplete).toBe(false);
    expect(
      computeCourseProgress([{ id: "m1", lessons: [{ id: "l1", completed: true }] }])
        .isComplete,
    ).toBe(true);
  });
});

describe("flattenLessonIds / findAdjacentLessonIds", () => {
  it("liefert Lektionen modulübergreifend in Reihenfolge", () => {
    expect(flattenLessonIds(modules)).toEqual(["l1", "l2", "l3"]);
  });

  it("findet Vorgänger/Nachfolger korrekt, auch an den Rändern", () => {
    const flat = flattenLessonIds(modules);
    expect(findAdjacentLessonIds(flat, "l2")).toEqual({ prevId: "l1", nextId: "l3" });
    expect(findAdjacentLessonIds(flat, "l1")).toEqual({ prevId: null, nextId: "l2" });
    expect(findAdjacentLessonIds(flat, "l3")).toEqual({ prevId: "l2", nextId: null });
  });
});
