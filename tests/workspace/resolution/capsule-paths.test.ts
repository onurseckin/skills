import { describe, expect, it } from "bun:test";
import { isInsideCapsule, stripCapsulePath } from "../../../olt/scripts/src/core/shared/paths.ts";

describe("Workspace Resolution: Capsule Paths & Containment", () => {
  it("detects paths inside .olt/capsules/", () => {
    expect(isInsideCapsule("/repos/project/.olt/capsules/run-123")).toBe(true);
    expect(isInsideCapsule("/repos/project/.olt/capsules/run-123/manifest.json")).toBe(true);
    expect(isInsideCapsule("/repos/project/.olt/capsules")).toBe(true);
  });

  it("detects paths inside .capsules/", () => {
    expect(isInsideCapsule("/repos/project/.capsules/run-456")).toBe(true);
    expect(isInsideCapsule("/repos/project/.capsules/run-456/events.jsonl")).toBe(true);
  });

  it("returns false for regular repository paths", () => {
    expect(isInsideCapsule("/repos/project/src/index.ts")).toBe(false);
    expect(isInsideCapsule("/repos/project/docs/readme.md")).toBe(false);
    expect(isInsideCapsule("/repos/project/.olt/config.json")).toBe(false);
  });

  it("strips capsule segments to recover sovereign repo root", () => {
    const stripped1 = stripCapsulePath("/repos/my-app/.olt/capsules/run-999/manifest.json");
    expect(stripped1).toBe("/repos/my-app");

    const stripped2 = stripCapsulePath("/repos/my-app/.capsules/run-888");
    expect(stripped2).toBe("/repos/my-app");

    const regular = stripCapsulePath("/repos/my-app/src/index.ts");
    expect(regular).toBeUndefined();
  });
});
