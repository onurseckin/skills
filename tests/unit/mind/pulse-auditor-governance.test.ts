import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MindAuditorEngine } from "../../../olt/scripts/src/mind/auditing/cognitive/index.ts";

describe("Mind Auditor Repository Governance & Liveness Checks", () => {
  it("detects missing policy.json and records governance issue", () => {
    const testDir = join(
      tmpdir(),
      `test-mind-gov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(testDir, { recursive: true });

    try {
      const audit = MindAuditorEngine.auditRepositoryGovernance(testDir);
      expect(audit.policyValid).toBe(false);
      expect(audit.issues.length).toBeGreaterThan(0);
      expect(audit.issues.some((i) => i.toLowerCase().includes("policy"))).toBe(true);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("detects ungrounded simulated execution when pulse claims ignition but events sequence is <= 1", async () => {
    const testDir = join(
      tmpdir(),
      `test-sim-exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    const capsuleDir = join(testDir, ".olt", "capsules", "run-1");
    mkdirSync(capsuleDir, { recursive: true });

    await Bun.write(
      join(testDir, "last_pulse.json"),
      JSON.stringify({ at: new Date().toISOString() }),
    );

    await Bun.write(
      join(capsuleDir, "events.jsonl"),
      JSON.stringify({ sequence: 1, kind: "mind-initialized" }) + "\n",
    );

    try {
      const audit = MindAuditorEngine.auditRepositoryGovernance(testDir, capsuleDir);
      expect(audit.simulatedExecutionDetected).toBe(true);
      expect(audit.eventsProgressionValid).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
