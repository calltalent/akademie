import { describe, expect, it } from "vitest";
import {
  computeCourseProgress,
  computeLessonBoundary,
  findAdjacentLessonIds,
  findNextModule,
  findNextSection,
  flattenLessonIds,
  type LessonPos,
  type ModulePos,
  type ModuleSummary,
  type SectionPos,
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

describe("computeLessonBoundary", () => {
  // Modul m1: Sektion s1 (l1, l2), Sektion s2 (l3) — l3 ist letzte der Sektion UND des Moduls.
  // Modul m2: lose Lektion l4 (kein section_id) — letzte des Moduls, ohne je Sektion zu sein.
  const lessons: LessonPos[] = [
    { id: "l1", moduleId: "m1", sectionId: "s1", position: 0 },
    { id: "l2", moduleId: "m1", sectionId: "s1", position: 1 },
    { id: "l3", moduleId: "m1", sectionId: "s2", position: 2 },
    { id: "l4", moduleId: "m2", sectionId: null, position: 0 },
  ];

  it("erkennt keine Grenze bei einer mittleren Lektion", () => {
    expect(computeLessonBoundary(lessons, "l1")).toEqual({ kind: "none" });
  });

  it("erkennt eine Sektionsgrenze, wenn die Sektion endet, das Modul aber weitergeht", () => {
    expect(computeLessonBoundary(lessons, "l2")).toEqual({ kind: "section", sectionId: "s1", moduleId: "m1" });
  });

  it("Modul-Grenze gewinnt, wenn eine Lektion zugleich letzte ihrer Sektion und ihres Moduls ist", () => {
    expect(computeLessonBoundary(lessons, "l3")).toEqual({ kind: "module", moduleId: "m1" });
  });

  it("lose Lektion ohne Sektion kann eine Modul-Grenze auslösen", () => {
    expect(computeLessonBoundary(lessons, "l4")).toEqual({ kind: "module", moduleId: "m2" });
  });

  it("unbekannte Lektion → keine Grenze", () => {
    expect(computeLessonBoundary(lessons, "unbekannt")).toEqual({ kind: "none" });
  });
});

describe("findNextSection / findNextModule", () => {
  const modulePositions: ModulePos[] = [
    { id: "m1", position: 0 },
    { id: "m2", position: 1 },
  ];
  const sectionPositions: SectionPos[] = [
    { id: "s1", moduleId: "m1", position: 0 },
    { id: "s2", moduleId: "m1", position: 1 },
    { id: "s3", moduleId: "m2", position: 0 },
  ];

  it("findet die nächste Sektion im selben Modul", () => {
    expect(findNextSection(sectionPositions, modulePositions, "s1", "m1")).toEqual({
      sectionId: "s2",
      moduleId: "m1",
    });
  });

  it("springt zur ersten Sektion des nächsten Moduls, wenn die aktuelle Sektion die letzte ihres Moduls ist", () => {
    expect(findNextSection(sectionPositions, modulePositions, "s2", "m1")).toEqual({
      sectionId: "s3",
      moduleId: "m2",
    });
  });

  it("liefert null, wenn weder im selben noch im nächsten Modul eine weitere Sektion existiert", () => {
    expect(findNextSection(sectionPositions, modulePositions, "s3", "m2")).toBeNull();
  });

  it("liefert null, wenn das nächste Modul keine Sektionen hat", () => {
    const sectionsWithoutM2: SectionPos[] = [
      { id: "s1", moduleId: "m1", position: 0 },
      { id: "s2", moduleId: "m1", position: 1 },
    ];
    expect(findNextSection(sectionsWithoutM2, modulePositions, "s2", "m1")).toBeNull();
  });

  it("findNextModule findet das nächste Modul nach Position, sonst null", () => {
    expect(findNextModule(modulePositions, "m1")).toEqual({ moduleId: "m2" });
    expect(findNextModule(modulePositions, "m2")).toBeNull();
  });
});
