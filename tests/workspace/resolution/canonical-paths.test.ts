import { describe, expect, it } from "bun:test";
import {
  OLT_DIR_NAME,
  OLT_FILES,
  resolveCapsulesDir,
  resolveOltDir,
  resolveScratchDir,
} from "../../../olt/scripts/src/core/shared/paths.ts";

describe("Workspace Resolution: Canonical OLT Paths & Directories", () => {
  it("resolves canonical .olt directory path", () => {
    const oltDir = resolveOltDir();
    expect(oltDir.endsWith(OLT_DIR_NAME)).toBe(true);
  });

  it("resolves canonical .olt/capsules directory path", () => {
    const capsulesDir = resolveCapsulesDir();
    expect(capsulesDir.endsWith("capsules") || capsulesDir.includes("capsules")).toBe(true);
  });

  it("resolves scratch directory with pid suffix", () => {
    const scratch = resolveScratchDir();
    expect(scratch.includes("olt-scratch")).toBe(true);
  });

  it("defines standard OLT file constants", () => {
    expect(OLT_FILES.POLICY).toBe("policy.json");
    expect(OLT_FILES.BACKLOG).toBe("backlog.jsonl");
    expect(OLT_FILES.COMPLETED_TASKS).toBe("completed-tasks.jsonl");
    expect(OLT_FILES.DEFECTS).toBe("defects.jsonl");
    expect(OLT_FILES.TELEMETRY).toBe("telemetry.jsonl");
  });
});
