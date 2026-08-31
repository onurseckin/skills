import { describe, expect, it } from "bun:test";
import { realpathSync } from "node:fs";
import { loadRunProjection } from "../../../olt/scripts/src/engine/store/capsule/load.ts";
import { initCapsuleRun } from "../../../olt/scripts/src/engine/store/capsule/init.ts";
import { scratchRoot } from "../fixtures/bootstrap-fixture.ts";

describe("Bootstrap State Validation", () => {
  it("loads run projection for an initialized capsule run", () => {
    const root = scratchRoot(import.meta.path, "load-run-proj");
    const { runRoot } = initCapsuleRun("boot-proj-001", { repo: root, prompt: "Boot prompt" });
    const loaded = loadRunProjection(runRoot);
    expect(realpathSync(loaded.runRoot)).toBe(realpathSync(runRoot));
    expect(loaded.manifest.run_id).toBe("boot-proj-001");
  });
});
