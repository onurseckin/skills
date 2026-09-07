import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  clusterForensicFindings,
  extractConversationId,
  locateTranscripts,
  parseTranscriptFile,
  recordClusteredDefects,
  scanTranscriptForensics,
  scanTranscriptSteps,
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
const scanOne = (cmd: string, out: string, conv = "conv-test", path?: string) =>
  scanTranscriptSteps([cmdStep(1, cmd), outStep(2, out)], conv, path)[0];

describe("Transcript Forensics Scanner & Defect Cluster Engine", () => {
  const testRoot = "/virtual/forensics/test-root";
  const brainDir = join(testRoot, "brain");
  const defectsFile = join(testRoot, "defects.jsonl");

  beforeAll(() => {
    setupVirtualCliFS();
    const vfs = getVirtualCliFS();
    vfs.mkdirSync(brainDir, { recursive: true });
  });

  afterAll(() => {
    cleanupVirtualCliFS();
  });

  describe("Transcript Locator & Path Resolution", () => {
    it("locates direct file transcript paths", () => {
      const vfs = getVirtualCliFS();
      const file = join(testRoot, "single-transcript.jsonl");
      vfs.writeFileSync(file, '{"step_index":0,"content":"hello"}\n');
      expect(locateTranscripts({ transcriptPath: file })).toEqual([file]);
    });

    it("locates transcript.jsonl inside a directory", () => {
      const vfs = getVirtualCliFS();
      const dir = join(testRoot, "conv-direct");
      vfs.mkdirSync(dir, { recursive: true });
      const file = join(dir, "transcript.jsonl");
      vfs.writeFileSync(file, '{"step_index":0,"content":"hello"}\n');
      expect(locateTranscripts({ transcriptPath: dir })).toEqual([file]);
    });

    it("locates .system_generated/logs/transcript.jsonl inside a conversation directory", () => {
      const vfs = getVirtualCliFS();
      const conv = join(brainDir, "conv-sys-1");
      const logsDir = join(conv, ".system_generated", "logs");
      vfs.mkdirSync(logsDir, { recursive: true });
      const file = join(logsDir, "transcript.jsonl");
      vfs.writeFileSync(file, '{"step_index":0,"content":"init"}\n');
      expect(locateTranscripts({ transcriptPath: conv })).toEqual([file]);
    });

    it("discovers all transcripts under a brain directory and respects limit", () => {
      const vfs = getVirtualCliFS();
      for (let i = 1; i <= 4; i++) {
        const cDir = join(brainDir, `auto-conv-${i}`, ".system_generated", "logs");
        vfs.mkdirSync(cDir, { recursive: true });
        vfs.writeFileSync(
          join(cDir, "transcript.jsonl"),
          `{"step_index":0,"content":"step ${i}"}\n`,
        );
      }
      expect(locateTranscripts({ brainDirectory: brainDir }).length).toBeGreaterThanOrEqual(4);
      expect(locateTranscripts({ brainDirectory: brainDir, limit: 2 })).toHaveLength(2);
    });

    it("returns empty array for nonexistent paths gracefully", () => {
      expect(locateTranscripts({ transcriptPath: join(testRoot, "nonexistent") })).toEqual([]);
      expect(locateTranscripts({ brainDirectory: join(testRoot, "nonexistent-brain") })).toEqual(
        [],
      );
    });

    it("extracts conversation ID from standard brain paths and arbitrary fallbacks", () => {
      const p1 =
        "/Users/test/.gemini/antigravity-cli/brain/c40b82fa-1122-3344-5566-778899aabbcc/.system_generated/logs/transcript.jsonl";
      expect(extractConversationId(p1)).toBe("c40b82fa-1122-3344-5566-778899aabbcc");
      expect(extractConversationId("/repos/project/.olt/capsules/wave-42/transcript.jsonl")).toBe(
        "wave-42",
      );
      expect(extractConversationId("/custom/dir/conv-99/transcript.jsonl")).toBe("conv-99");
    });
  });

  describe("Pattern Scanning & Offending Command Extraction", () => {
    it("scans and extracts source code reverse engineering attempts (skills/olt/scripts/src)", () => {
      const f = scanOne(
        "sed -n '150,225p' /skills/olt/scripts/src/cli/commands/task-claim.ts",
        "The command exited with code 0.\nOutput:\nexport function claimTask() {}",
        "conv-rev-eng",
        "/path/to/transcript.jsonl",
      );
      expect(f?.category).toBe("source_reverse_engineering");
      expect(f?.signature).toBe("source_reverse_engineering");
      expect(f?.offendingCommand).toContain("task-claim.ts");
      expect(f?.conversationId).toBe("conv-rev-eng");
    });

    it("scans and extracts cognitive validator lockout violations", () => {
      const f = scanOne(
        "bun harness.ts task:exec --task task-1",
        "The command exited with code 3.\nOutput:\n**Error**: role validator may not invoke task:exec",
        "conv-val-lockout",
      );
      expect(f?.category).toBe("cognitive_validator_lockout");
      expect(f?.signature).toBe("cognitive_validator_lockout");
      expect(f?.offendingCommand).toBe("bun harness.ts task:exec --task task-1");
      expect(f?.errorSnippet).toContain("role validator may not invoke");
    });

    it("scans and extracts completeness critic authentication token failures", () => {
      const f = scanOne(
        "bun harness.ts task:review --token invalid-tok",
        "Error (INVALID_STATE): completeness critic authentication is invalid",
        "conv-critic-fail",
      );
      expect(f?.category).toBe("critic_authentication_failure");
      expect(f?.signature).toBe("critic_authentication_failure");
      expect(f?.offendingCommand).toBe("bun harness.ts task:review --token invalid-tok");
    });

    it("scans and extracts command ownership failures (cannot determine checks for)", () => {
      const f = scanOne(
        "bun harness.ts task:submit --run .olt/capsules/c1 --task task-1 --agent worker-1",
        "Error (INVALID_STATE): cannot determine checks for task-1: the agent has no recorded command",
        "conv-ownership-fail",
      );
      expect(f?.category).toBe("command_ownership_failure");
      expect(f?.signature).toBe("command_ownership_failure");
      expect(f?.offendingCommand).toContain("task:submit");
      expect(f?.errorSnippet).toContain("cannot determine checks for task-1");
    });

    it("scans and extracts unknown CLI flag errors (unknown option:)", () => {
      const f = scanOne(
        "bun harness.ts task:heartbeat --role implementer",
        "The command exited with code 3.\nOutput:\n**Error (INVALID_ARGUMENT)**: unknown option: --role\n",
        "conv-flag-err",
      );
      expect(f?.category).toBe("unknown_cli_option");
      expect(f?.signature).toBe("unknown_cli_option:--role");
      expect(f?.offendingCommand).toBe("bun harness.ts task:heartbeat --role implementer");
      expect(f?.errorSnippet).toContain("unknown option: --role");
    });

    it("scans and extracts general harness execution contract errors", () => {
      for (const code of [
        "INVALID_STATE",
        "INVALID_ARGUMENT",
        "AUTHENTICATION_FAILURE",
        "LOCK_TIMEOUT",
        "PERMISSION_DENIED",
      ]) {
        const steps = [
          outStep(
            60,
            `The command failed.\nOutput:\nError (${code}): Precondition contract check violated for resource\n`,
          ),
        ];
        const findings = scanTranscriptSteps(steps, "conv-harness-err");
        expect(findings).toHaveLength(1);
        expect(findings[0]?.category).toBe("harness_error");
        expect(findings[0]?.signature).toBe(`harness_error:${code}`);
        expect(findings[0]?.rootCauseHeuristic).toContain(code);
      }
    });

    it("ignores clean steps and handles malformed JSON without crashing", () => {
      const cleanSteps = [
        outStep(1, "All tests passed with 0 errors."),
        outStep(2, "Task review approved successfully."),
      ];
      expect(scanTranscriptSteps(cleanSteps, "clean-conv")).toHaveLength(0);
      const vfs = getVirtualCliFS();
      const malformedFile = join(testRoot, "malformed.jsonl");
      vfs.writeFileSync(malformedFile, 'not-json\n{"step_index":0,"content":"normal"}\n{invalid\n');
      expect(parseTranscriptFile(malformedFile)).toHaveLength(1);
    });
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
      const flagCluster = clusters.find((c) => c.signature === "unknown_cli_option:--role")!;
      expect(flagCluster).toBeDefined();
      expect(flagCluster.count).toBe(2);
      expect(flagCluster.conversationIds).toEqual(["conv-1", "conv-2"]);
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
