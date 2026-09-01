import { describe, expect, it } from "bun:test";
import { CAPSULE_LAYOUT } from "../../../olt/scripts/src/engine/store/layout/layout.ts";

describe("Workspace Layout: Capsule Layout Definition", () => {
  it("defines standard capsule layout entries", () => {
    expect(CAPSULE_LAYOUT.length).toBeGreaterThan(10);
    const names = CAPSULE_LAYOUT.map((e) => e.name);

    expect(names).toContain("manifest.json");
    expect(names).toContain("prompt.md");
    expect(names).toContain("events.jsonl");
    expect(names).toContain("state.json");
    expect(names).toContain("index.json");
    expect(names).toContain("commands/");
    expect(names).toContain("blobs/");
    expect(names).toContain("reports/");
  });

  it("assigns appropriate layout roles to entries", () => {
    const manifestEntry = CAPSULE_LAYOUT.find((e) => e.name === "manifest.json");
    expect(manifestEntry?.role).toBe("anchor");
    expect(manifestEntry?.createdAtInit).toBe(true);

    const promptEntry = CAPSULE_LAYOUT.find((e) => e.name === "prompt.md");
    expect(promptEntry?.role).toBe("primary");

    const stateEntry = CAPSULE_LAYOUT.find((e) => e.name === "state.json");
    expect(stateEntry?.role).toBe("derived");
  });
});
