import { describe, it, expect, beforeEach } from "bun:test";
import {
  executeMindObserve,
  formatMindObserveBrief,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
} from "../../olt/scripts/src/mind/lifecycle/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

describe("mind/mind-observe", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = scratchRoot(import.meta.path, "mind-observe-test");
  });

  it("resolves observations paths", () => {
    const canonical = resolveCanonicalObservationsPath(scratchDir);
    expect(canonical).toContain("telemetry.jsonl");

    const custom = resolveObservationsPath("custom.jsonl");
    expect(custom).toContain("custom.jsonl");
  });

  it("formats mind observe brief", () => {
    const brief = formatMindObserveBrief({
      observationId: "obs-001",
      runRoot: "/path/to/capsule",
      actor: "mind-agent",
      sourceId: "typecheck_failure",
      sourceNumber: 1,
      sourceName: "TypeScript Compiler Diagnostics",
      commandId: "cmd-123",
      count: 2,
      evidenceClass: "static_analysis",
      observedAt: "2026-08-24T10:00:00Z",
    });

    expect(brief).toContain("obs-001");
    expect(brief).toContain("mind-agent");
    expect(brief).toContain("typecheck_failure");
  });

  it("executes mind observe and validates required flags", () => {
    expect(() => executeMindObserve({})).toThrow();
  });
});
