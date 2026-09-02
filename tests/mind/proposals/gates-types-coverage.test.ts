import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findCommandRecord,
  readCandidateCommandOutput,
  outputContainsDefect,
  type CandidateRecord,
  type AdmissionGateVerdict,
  type AdmissionEvaluationResult,
  type GateEvaluationContext,
  type CommandRecordCandidate,
} from "../../../olt/scripts/src/mind/proposals/gates/types.ts";

describe("Mind Proposals Gates Types & Helpers Module", () => {
  describe("findCommandRecord", () => {
    it("returns null for empty or non-string commandId", () => {
      expect(findCommandRecord("/path", "")).toBeNull();
      expect(findCommandRecord("/path", null as unknown as string)).toBeNull();
      expect(findCommandRecord("/path", undefined as unknown as string)).toBeNull();
      expect(findCommandRecord("/path", 123 as unknown as string)).toBeNull();
    });

    it("retrieves command record from state.commands dictionary", () => {
      const record: CommandRecordCandidate = {
        id: "cmd-state-1",
        exit_code: 0,
        status: "completed",
      };
      const state = { commands: { "cmd-state-1": record } };
      expect(findCommandRecord("/path", "cmd-state-1", state)).toBe(record);

      const stateNonObject = { commands: "not-an-object" as unknown as Record<string, unknown> };
      expect(findCommandRecord("/nonexistent/path", "cmd-missing", stateNonObject)).toBeNull();
    });

    it("reads direct record.json from runRoot/commands/<commandId>", () => {
      const tmp = mkdtempSync(join(tmpdir(), "cmd-direct-"));
      try {
        const cmdDir = join(tmp, "commands", "cmd-dir-1");
        mkdirSync(cmdDir, { recursive: true });
        const recordData: CommandRecordCandidate = {
          id: "cmd-dir-1",
          exit_code: 1,
          output: "direct output",
        };
        writeFileSync(join(cmdDir, "record.json"), JSON.stringify(recordData));

        const found = findCommandRecord(tmp, "cmd-dir-1");
        expect(found).toEqual(recordData);

        // Corrupted JSON in direct path should be ignored and proceed
        const corruptDir = join(tmp, "commands", "cmd-corrupt");
        mkdirSync(corruptDir, { recursive: true });
        writeFileSync(join(corruptDir, "record.json"), "invalid json content {{{");
        expect(findCommandRecord(tmp, "cmd-corrupt")).toBeNull();
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("finds command record in sibling runs under capsules directory", () => {
      const capsulesDir = mkdtempSync(join(tmpdir(), "capsules-sibling-"));
      try {
        const run1 = join(capsulesDir, "run-current");
        mkdirSync(run1, { recursive: true });
        const run2 = join(capsulesDir, "run-sibling");
        const siblingCmd = join(run2, "commands", "cmd-sibling-1");
        mkdirSync(siblingCmd, { recursive: true });
        const siblingRecord: CommandRecordCandidate = { id: "cmd-sibling-1", exit_code: 0 };
        writeFileSync(join(siblingCmd, "record.json"), JSON.stringify(siblingRecord));

        // Non-directory file in capsules directory
        writeFileSync(join(capsulesDir, "stray-file.txt"), "hello");

        // Corrupted record in another sibling
        const run3 = join(capsulesDir, "run-corrupt-sibling");
        const corruptCmd = join(run3, "commands", "cmd-corrupt-sibling");
        mkdirSync(corruptCmd, { recursive: true });
        writeFileSync(join(corruptCmd, "record.json"), "corrupted { json");

        expect(findCommandRecord(run1, "cmd-sibling-1")).toEqual(siblingRecord);
        expect(findCommandRecord(run1, "cmd-corrupt-sibling")).toBeNull();
        expect(findCommandRecord(run1, "cmd-completely-missing")).toBeNull();
      } finally {
        rmSync(capsulesDir, { recursive: true, force: true });
      }
    });

    it("returns null when runRoot directory structure does not exist", () => {
      expect(findCommandRecord("/nonexistent/virtual/dir/deep/runRoot", "cmd-x")).toBeNull();
    });
  });

  describe("readCandidateCommandOutput", () => {
    it("returns output property immediately when present on record", () => {
      const record: CommandRecordCandidate = { id: "cmd-1", output: "Direct execution result" };
      expect(readCandidateCommandOutput(record, "/virtual/root")).toBe("Direct execution result");
    });

    it("reads stdout and stderr from record.logs using relative and absolute paths", () => {
      const tmp = mkdtempSync(join(tmpdir(), "cmd-output-logs-"));
      try {
        const stdoutRelPath = "stdout.log";
        const stderrAbsPath = join(tmp, "stderr.log");
        writeFileSync(join(tmp, stdoutRelPath), "Standard output line");
        writeFileSync(stderrAbsPath, "Standard error line");

        const record: CommandRecordCandidate = {
          id: "cmd-logs",
          logs: {
            stdout: { path: stdoutRelPath, bytes: 20 },
            stderr: { path: stderrAbsPath, bytes: 19 },
          },
        };
        const output = readCandidateCommandOutput(record, tmp);
        expect(output).toBe("Standard output line\nStandard error line");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("handles readFileSync errors when stdout or stderr path points to a directory", () => {
      const tmp = mkdtempSync(join(tmpdir(), "cmd-output-dir-err-"));
      try {
        const subDir = join(tmp, "dir-not-file");
        mkdirSync(subDir, { recursive: true });
        const record: CommandRecordCandidate = {
          id: "cmd-err",
          logs: {
            stdout: { path: subDir },
            stderr: { path: subDir },
          },
        };
        expect(readCandidateCommandOutput(record, tmp)).toBe("");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("falls back to last attempt logs when record.logs is missing or empty", () => {
      const tmp = mkdtempSync(join(tmpdir(), "cmd-output-attempts-"));
      try {
        const attemptStderr = join(tmp, "attempt2.err");
        writeFileSync(attemptStderr, "Error in attempt 2");

        const record: CommandRecordCandidate = {
          id: "cmd-attempts",
          attempts: [
            { exit_code: 1, logs: { stdout: { path: "missing.log" } } },
            { exit_code: 2, logs: { stderr: { path: attemptStderr } } },
          ],
        };
        const output = readCandidateCommandOutput(record, tmp);
        expect(output).toBe("Error in attempt 2");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("returns empty string when logs paths are missing, unreadable, or attempts array is empty", () => {
      const record1: CommandRecordCandidate = {
        id: "cmd-empty-paths",
        logs: {
          stdout: { path: "/nonexistent/path/out.log" },
          stderr: { path: "/nonexistent/path/err.log" },
        },
      };
      expect(readCandidateCommandOutput(record1, "/virtual/root")).toBe("");

      const record2: CommandRecordCandidate = { id: "cmd-no-logs", attempts: [] };
      expect(readCandidateCommandOutput(record2, "/virtual/root")).toBe("");
    });
  });

  describe("outputContainsDefect", () => {
    it("returns false for empty or whitespace-only output", () => {
      expect(outputContainsDefect("", "statement")).toBe(false);
      expect(outputContainsDefect("   ", "statement")).toBe(false);
      expect(outputContainsDefect(null as unknown as string, "statement")).toBe(false);
    });

    it("returns true for empty or whitespace-only statement when output exists", () => {
      expect(outputContainsDefect("Some error occurred", "")).toBe(true);
      expect(outputContainsDefect("Some error occurred", "   ")).toBe(true);
      expect(outputContainsDefect("Some error occurred", null as unknown as string)).toBe(true);
    });

    it("detects defect via direct substring match (case-insensitive)", () => {
      const output = "FATAL: Database connection timeout in pool";
      expect(outputContainsDefect(output, "database connection timeout")).toBe(true);
      expect(outputContainsDefect(output, "CONNECTION TIMEOUT")).toBe(true);
    });

    it("returns true when statement consists only of stop words or short tokens", () => {
      expect(
        outputContainsDefect("Any non-empty error output", "the in on at to a an and or is"),
      ).toBe(true);
      expect(outputContainsDefect("Any error", "it is as")).toBe(true);
    });

    it("matches meaningful tokens extracted from statement with special delimiters", () => {
      const output = "Execution failure: NullPointerException at Router.dispatch (router.ts:45)";
      expect(
        outputContainsDefect(
          output,
          "Router::dispatch[action=execute] failed with NullPointerException",
        ),
      ).toBe(true);
      expect(outputContainsDefect(output, "Fix issue where router crashes")).toBe(true);
      expect(
        outputContainsDefect(output, "Completely unrelated database lock conflict in user service"),
      ).toBe(false);
    });
  });

  describe("Interface Type Definitions & Structures", () => {
    it("constructs valid CandidateRecord and GateEvaluationContext instances", () => {
      const candidate: CandidateRecord = {
        id: "cand-t1",
        kind: "defect",
        statement: "Fix parser bug",
        write_scope: ["src/parser.ts"],
        status: "opened",
        witness_command_id: "cmd-wit-1",
        charter_goal_ids: ["G1"],
        charter_goals: ["G1"],
        falsifier_argv: ["bun", "test"],
        falsifier: "bun test",
        falsifier_exit: 1,
        decided_at: "2026-09-01T12:00:00.000Z",
        decline_reason: null,
        gate_failed: null,
        objective_run_id: "obj-1",
        rationale: "Fix needed",
      };
      expect(candidate.id).toBe("cand-t1");
      expect(candidate.kind).toBe("defect");

      const verdict: AdmissionGateVerdict = {
        gateId: "gate-1-witness",
        gateNumber: 1,
        name: "Witness Recorded",
        passed: true,
        reason: "Valid witness",
        repairArgv: "--witness cmd-1",
        metadata: { witnessId: "cmd-1" },
      };
      expect(verdict.passed).toBe(true);

      const evalResult: AdmissionEvaluationResult = {
        admitted: true,
        candidateId: candidate.id,
        verdicts: [verdict],
        falsifierExitObserved: 1,
      };
      expect(evalResult.admitted).toBe(true);
      expect(evalResult.verdicts).toHaveLength(1);

      const ctx: GateEvaluationContext = {
        runRoot: "/virtual/run",
        repoRoot: "/virtual/repo",
        actor: "evaluator",
        state: {},
        charterGoals: new Set(["G1"]),
        charterNonGoals: ["deprecated"],
        repoRoots: ["src"],
        falsifierTimeoutMs: 5000,
      };
      expect(ctx.actor).toBe("evaluator");
      expect(ctx.falsifierTimeoutMs).toBe(5000);
    });
  });
});
