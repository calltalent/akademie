import { describe, expect, it } from "vitest";

// Hinweis: publicEnv wird beim Import von env.ts sofort validiert.
// Test läuft nur sinnvoll, wenn NEXT_PUBLIC_SUPABASE_URL/-ANON_KEY gesetzt sind
// (lokal via .env.test oder vitest --env-file). Platzhaltertest für Block 1.
describe("env", () => {
  it("ist vorhanden und ladbar", async () => {
    const mod = await import("./env");
    expect(typeof mod.getServerEnv).toBe("function");
  });
});
