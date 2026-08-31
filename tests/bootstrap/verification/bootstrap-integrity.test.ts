import { describe, expect, it } from "bun:test";
import { verifyCapsuleLayout } from "../../../olt/scripts/src/engine/store/integrity/layout-integrity.ts";
import { scratchRoot } from "../fixtures/bootstrap-fixture.ts";

describe("Bootstrap Layout & Integrity Verification", () => {
  it("verifies clean empty run root has no integrity issues", () => {
    const root = scratchRoot(import.meta.path, "verify-empty-layout");
    const issues = verifyCapsuleLayout(root);
    expect(issues.length).toBe(0);
  });
});
