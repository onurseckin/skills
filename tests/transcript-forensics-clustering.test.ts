import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  clusterForensicFindings,
  recordClusteredDefects,
  scanTranscriptForensics,
} from "../olt/scripts/src/reporting/transcript-forensics/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "./cli/commands/fixtures/full-lifecycle-fixture.ts";

const cmdStep = (step_index: number, CommandLine: string) => ({
  step_index,
  created_at: "2026-09-05T10:00:00.000Z",
  tool_calls: [{ name: "run_command", args: { CommandLine } }],
});

const outStep = (step_index: number, content: string) => ({
  step_index,
  created_at: "2026-09-05T10:00:02.000Z",
  content,
});

describe("Transcript Forensics Defect Clustering & Aggregation", () => {
  const testRoot = "/virtual/forensics/clustering-test-root";
  const defectsFile = join(testRoot, "defects.jsonl");

  beforeAll(() => {
    setupVirtualCliFS();
    const vfs = getVirtualCliFS();
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterAll(() => {
    cleanupVirtualCliFS();
  });

  describe("Defect Clustering & Aggregation", () => {
    it("clusters findings by signature and computes occurrences across conversations", () => {
      const f1 = {
        category: "unknown_cli_option" as const,
        rootCauseHeuristic: "err",
        signature: "unknown_cli_option:--role",
        errorSnippet: "err",
        offendingCommand: "cmd1",
        timestamp: "2026-09-05T11:00:00.000Z",
        conversationId: "conv-1",
        stepIndex: 12,
      };
      const f2 = {
        ...f1,
        offendingCommand: "cmd2",
        conversationId: "conv-2",
        timestamp: "2026-09-05T11:05:00.000Z",
      };
      const f3 = {
        category: "source_reverse_engineering" as const,
        rootCauseHeuristic: "err",
        signature: "source_reverse_engineering",
        errorSnippet: "err",
        offendingCommand: "cmd3",
        timestamp: "2026-09-05T11:02:00.000Z",
        conversationId: "conv-1",
        stepIndex: 13,
      };

      const clusters = clusterForensicFindings([f1, f2, f3]);
      expect(clusters).toHaveLength(2);
      const flagCluster = clusters.find((c) => c.signature === "unknown_cli_option:--role");
      expect(flagCluster).toBeDefined();
      expect(flagCluster?.count).toBe(2);
      expect(flagCluster?.conversationIds).toEqual(["conv-1", "conv-2"]);
    });
  });

  describe("Defect Recording via recordKeyedDefect", () => {
    it("records clustered forensic defects into .olt/defects.jsonl", () => {
      const occ = {
        conversationId: "conv-a",
        timestamp: "2026-09-05T12:00:00.000Z",
        errorSnippet: "snippet",
      };
      const clusters = [
        {
          category: "cognitive_validator_lockout" as const,
          rootCauseHeuristic: "cognitive_validator_lockout",
          signature: "cognitive_validator_lockout",
          errorSnippet: "role validator may not invoke",
          offendingCommand: "bun harness.ts task:exec",
          count: 3,
          occurrences: [occ],
          firstSeen: "2026-09-05T12:00:00.000Z",
          lastSeen: "2026-09-05T12:10:00.000Z",
          conversationIds: ["conv-a"],
        },
      ];
      expect(recordClusteredDefects(clusters, { defectsPath: defectsFile })).toBe(1);
      const vfs = getVirtualCliFS();
      expect(vfs.existsSync(defectsFile)).toBe(true);
      expect(vfs.readFileSync(defectsFile, "utf-8")).toContain("cognitive_validator_lockout");
    });
  });

  describe("End-to-End Forensics Scanner Execution", () => {
    it("runs complete scan over synthetic directory and generates structured summary", () => {
      const vfs = getVirtualCliFS();
      const scanDir = join(testRoot, "full-scan-test");
      const c1 = join(scanDir, "conv-101", ".system_generated", "logs");
      const c2 = join(scanDir, "conv-102", ".system_generated", "logs");
      vfs.mkdirSync(c1, { recursive: true });
      vfs.mkdirSync(c2, { recursive: true });

      const l1 = JSON.stringify({ step_index: 0, content: "user request" });
      const l2 = JSON.stringify(cmdStep(1, "cat skills/olt/scripts/src/scanner.ts"));
      const l3 = JSON.stringify(
        outStep(2, "Output:\n**Error (INVALID_ARGUMENT)**: unknown option: --verbose"),
      );
      vfs.writeFileSync(join(c1, "transcript.jsonl"), `${l1}\n${l2}\n${l3}\n`);

      const l4 = JSON.stringify(
        outStep(0, "role validator may not invoke shell: cognitive validators restricted"),
      );
      vfs.writeFileSync(join(c2, "transcript.jsonl"), `${l4}\n`);

      const summary = scanTranscriptForensics({
        transcriptPath: scanDir,
        recordDefects: true,
        defectsPath: defectsFile,
      });
      expect(summary.totalTranscriptsScanned).toBe(2);
      expect(summary.totalStepsScanned).toBe(4);
      expect(summary.totalFindings).toBeGreaterThanOrEqual(3);
      expect(summary.categories.source_reverse_engineering).toBeGreaterThanOrEqual(1);
      expect(summary.categories.unknown_cli_option).toBeGreaterThanOrEqual(1);
      expect(summary.categories.cognitive_validator_lockout).toBeGreaterThanOrEqual(1);
      expect(summary.clusters.length).toBeGreaterThanOrEqual(3);
      expect(summary.recordedDefectCount).toBeGreaterThanOrEqual(3);
    });

    it("handles completely empty directories gracefully returning zero counts", () => {
      const vfs = getVirtualCliFS();
      const emptyDir = join(testRoot, "empty-scan-dir");
      vfs.mkdirSync(emptyDir, { recursive: true });

      const summary = scanTranscriptForensics({
        transcriptPath: emptyDir,
        recordDefects: true,
        defectsPath: defectsFile,
      });
      expect(summary.totalTranscriptsScanned).toBe(0);
      expect(summary.totalStepsScanned).toBe(0);
      expect(summary.totalFindings).toBe(0);
      expect(summary.clusters).toHaveLength(0);
      expect(summary.recordedDefectCount).toBe(0);
    });
  });
});
