import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  extractConversationId,
  locateTranscripts,
  parseTranscriptFile,
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
});
