import { describe, expect, it } from "bun:test";
import { resolveCapsulesDir } from "../../../olt/scripts/src/engine/store/capsule/paths.ts";

describe("Capture & Capsule Environment Setup", () => {
  it("resolves capsules directory path accurately", () => {
    const resolved = resolveCapsulesDir("/tmp/test-repo");
    expect(resolved).toContain("capsules");
  });
});
