import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  extractProseMilestoneClaims,
  inspectEventLogEvidence,
} from "../../../olt/scripts/src/validation/index.ts";
import {
  cleanupVirtualValidationFS,
  scratchRoot,
  setupVirtualValidationFS,
} from "../validation-fixture.ts";

let TEST_DIR: string;

function setupTestEnv(): void {
  TEST_DIR = scratchRoot("prose-assertion-extraction", "extract");
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanupTestEnv(): void {
  // Handled in afterEach
}

describe("Defect Remediation: Prose Milestone Extraction & Event Inspection", () => {
  beforeEach(() => {
    setupVirtualValidationFS();
  });

  afterEach(() => {
    cleanupVirtualValidationFS();
  });
  describe("1. Prose Milestone Extraction", () => {
    it("extracts ignition, invariant, execution, test_pass, and completion claims from markdown", () => {
      const markdown = `
# Executive Ignition Report
- [x] Ignition complete across all subagent workers
- [x] Invariants were enforced and zero boundary leaks detected
- [x] 3 commands executed in pipeline
- [x] All tests passed 100%
- [x] Task is completed successfully
`;
      const claims = extractProseMilestoneClaims(markdown, "report.md");
      expect(claims.length).toBe(5);

      const types = claims.map((c) => c.type);
      expect(types).toContain("ignition");
      expect(types).toContain("invariant");
      expect(types).toContain("execution");
      expect(types).toContain("test_pass");
      expect(types).toContain("completion");

      const execClaim = claims.find((c) => c.type === "execution");
      expect(execClaim?.claimedCommandsCount).toBe(3);
    });

    it("returns empty claims for prose with no milestone assertions", () => {
      const markdown = `
# General Notes
Here is some exploratory discussion without claiming ignition or completion.
We are investigating repository structure.
`;
      const claims = extractProseMilestoneClaims(markdown);
      expect(claims.length).toBe(0);
    });
  });

  describe("2. Event Log Inspection", () => {
    it("returns empty summary when events.jsonl does not exist", () => {
      const summary = inspectEventLogEvidence("/tmp/nonexistent-path/events.jsonl");
      expect(summary.exists).toBe(false);
      expect(summary.totalEvents).toBe(0);
      expect(summary.commandReceiptsCount).toBe(0);
    });

    it("parses valid events.jsonl with sequence and command receipts", () => {
      setupTestEnv();
      const eventsPath = join(TEST_DIR, "events.jsonl");

      const stdoutHash1 = createHash("sha256").update("tests passed").digest("hex");
      const stdoutHash2 = createHash("sha256").update("build ok").digest("hex");

      const line1 = JSON.stringify({
        sequence: 1,
        type: "ignition-started",
        timestamp: "2026-08-30T00:00:00.000Z",
      });
      const line2 = JSON.stringify({
        sequence: 2,
        type: "command-executed",
        payload: {
          task_id: "task-1",
          actor: "worker-1",
          command: "bun test",
          argv: ["bun", "test"],
          exit_code: 0,
          stdout_hash: stdoutHash1,
        },
        timestamp: "2026-08-30T00:01:00.000Z",
      });
      const line3 = JSON.stringify({
        sequence: 3,
        type: "command-executed",
        payload: {
          task_id: "task-2",
          actor: "worker-1",
          command: "bun run build",
          argv: ["bun", "run", "build"],
          exit_code: 0,
          stdout_hash: stdoutHash2,
        },
        timestamp: "2026-08-30T00:02:00.000Z",
      });

      writeFileSync(eventsPath, `${line1}\n${line2}\n${line3}\n`);

      const summary = inspectEventLogEvidence(eventsPath);
      expect(summary.exists).toBe(true);
      expect(summary.totalEvents).toBe(3);
      expect(summary.maxSequence).toBe(3);
      expect(summary.commandReceiptsCount).toBe(2);
      expect(summary.containsIgnitionEvent).toBe(true);
      expect(summary.commandReceipts[0]?.command).toBe("bun test");
      expect(summary.commandReceipts[0]?.stdoutHash).toBe(stdoutHash1);
      expect(summary.commandReceipts[1]?.command).toBe("bun run build");

      cleanupTestEnv();
    });

    it("detects broken cryptographic SHA chain in events log", () => {
      setupTestEnv();
      const eventsPath = join(TEST_DIR, "events.jsonl");

      const line1 = JSON.stringify({
        sequence: 1,
        type: "init",
        sha: "hash-1",
        parent_sha: "root",
      });
      const line2 = JSON.stringify({
        sequence: 2,
        type: "step",
        sha: "hash-2",
        parent_sha: "wrong-parent-hash",
      });

      writeFileSync(eventsPath, `${line1}\n${line2}\n`);

      const summary = inspectEventLogEvidence(eventsPath);
      expect(summary.shaChainValid).toBe(false);

      cleanupTestEnv();
    });
  });
});
