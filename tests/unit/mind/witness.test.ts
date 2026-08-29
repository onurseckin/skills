import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import {
  mindCandidateCommand,
  type MindCandidate,
} from "../../../olt/scripts/src/cli/commands/mind-candidate.ts";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  readCommandOutput,
  resolveWitnessCommand,
  verifyDefectWitness,
} from "../../../olt/scripts/src/mind/witness.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  roots.length = 0;
});

interface MindFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupMindCapsule(
  name: string,
  overrides: {
    readonly charterContent?: string;
    readonly budget?: Record<string, unknown>;
    readonly registerMindAgent?: boolean;
    readonly initialCandidates?: Record<string, unknown>[];
  } = {},
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-witness-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    overrides.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test application for discovery and witness rule"\n  goals:\n    - id: "G1"\n      statement: "Enforce zero type errors"\n    - id: "G2"\n      statement: "Maintain test suite passing"\n  non_goals:\n    - "Modifying production credentials"\n  repo_roots:\n    - "src/"\n    - "tests/"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "olt/agents/mind.yaml",
      pinned_sha256: charterSha,
      goals: ["G1", "G2"],
      repo_roots: ["src/", "tests/"],
    },
    (draft) => {
      const working = draft as Record<string, unknown>;
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "olt/agents/mind.yaml",
          pinned_sha256: charterSha,
          goals: ["G1", "G2"],
          repo_roots: ["src/", "tests/"],
          evidence_class: "harness_observed",
        },
      };

      working.budget = {
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
        base_interval_ms: 900_000,
        max_interval_ms: 14_400_000,
        max_pause_interval_ms: 1_800_000,
        pulse_deadline_ms: 1_200_000,
        max_open_proposals: 3,
        quiet_hours: null,
        day_key: "2026-08-21",
        pulses_today: 0,
        wall_clock_ms_today: 0,
        ...overrides.budget,
      };

      working.candidates = overrides.initialCandidates ?? [];
      working.observations = [];
      working.escalations = [];
      working.audit = {
        last_started_at: new Date().toISOString(),
        last_verdict: "approved",
        open_findings: [],
      };
    },
  );

  if (overrides.registerMindAgent !== false) {
    agentRegisterCommand({
      run,
      agent: "mind-1",
      role: "mind",
      host: "antigravity",
    });
  }

  return { repo, run, charterPath, charterSha };
}

function recordMockCommand(
  capsuleRoot: string,
  commandId: string,
  options: {
    readonly exitCode?: number;
    readonly status?: "failed" | "succeeded" | "running" | "timed_out";
    readonly stdout?: string;
    readonly stderr?: string;
    readonly argv?: string[];
  } = {},
): CommandRecord {
  const cmdDir = join(capsuleRoot, "commands", commandId);
  mkdirSync(cmdDir, { recursive: true });

  const record: CommandRecord = {
    id: commandId,
    argv: options.argv ?? ["bun", "test"],
    cwd: capsuleRoot,
    cwd_relative: ".",
    repository_root: capsuleRoot,
    status: options.status ?? (options.exitCode === 0 ? "succeeded" : "failed"),
    task_id: null,
    gate_id: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    exit_code: options.exitCode ?? 1,
    signal: null,
    fingerprint: "test-fingerprint",
    attempt_signing_public_key: "test-key",
    record_path: join("commands", commandId, "record.json"),
    actor: "tester",
  };

  writeFileSync(join(cmdDir, "record.json"), JSON.stringify(record, null, 2), "utf-8");

  if (options.stdout !== undefined) {
    writeFileSync(join(cmdDir, "stdout.log"), options.stdout, "utf-8");
  }
  if (options.stderr !== undefined) {
    writeFileSync(join(cmdDir, "stderr.log"), options.stderr, "utf-8");
  }

  return record;
}

describe("mind/witness helper", () => {
  test("resolves command record across capsule directory", () => {
    const { run } = setupMindCapsule("resolve-cmd");
    recordMockCommand(run, "cmd-test-1", {
      exitCode: 1,
      stdout: "Error: expected 1 to be 2",
      stderr: "TypeError at line 42",
    });

    const resolution = resolveWitnessCommand("cmd-test-1", run);
    expect(resolution.commandId).toBe("cmd-test-1");
    expect(resolution.capsuleRoot).toBe(run);
    expect(resolution.commandRecord.id).toBe("cmd-test-1");
  });

  test("refuses non-existent command ID", () => {
    const { run } = setupMindCapsule("nonexistent-cmd");
    expect(() => resolveWitnessCommand("cmd-missing", run)).toThrow(HarnessError);
    try {
      resolveWitnessCommand("cmd-missing", run);
    } catch (err) {
      const hErr = err as HarnessError;
      expect(hErr.code).toBe("INVALID_ARGUMENT");
      expect(hErr.message).toContain("command 'cmd-missing' does not exist in any capsule");
    }
  });

  test("refuses empty or blank command ID", () => {
    const { run } = setupMindCapsule("empty-cmd");
    expect(() => resolveWitnessCommand("", run)).toThrow(HarnessError);
    expect(() => resolveWitnessCommand("   ", run)).toThrow(HarnessError);
  });

  test("reads stdout and stderr logs cleanly", () => {
    const { run } = setupMindCapsule("read-output");
    recordMockCommand(run, "cmd-logs-1", {
      exitCode: 2,
      stdout: "Standard Output Info\n",
      stderr: "Standard Error Warning\n",
    });

    const resolution = resolveWitnessCommand("cmd-logs-1", run);
    const output = readCommandOutput(resolution);
    expect(output.stdout).toContain("Standard Output Info");
    expect(output.stderr).toContain("Standard Error Warning");
    expect(output.output).toContain("Standard Output Info");
    expect(output.output).toContain("Standard Error Warning");
  });

  test("verifyDefectWitness refuses exit code 0 witness", () => {
    const { run } = setupMindCapsule("exit-0-refusal");
    recordMockCommand(run, "cmd-success-1", {
      exitCode: 0,
      status: "succeeded",
      stdout: "All tests passed (0 failures)",
    });

    expect(() => verifyDefectWitness("cmd-success-1", run)).toThrow(HarnessError);
    try {
      verifyDefectWitness("cmd-success-1", run);
    } catch (err) {
      const hErr = err as HarnessError;
      expect(hErr.code).toBe("INVALID_ARGUMENT");
      expect(hErr.message).toContain("witness command 'cmd-success-1' exited with code 0");
    }
  });

  test("verifyDefectWitness accepts non-zero exit and returns harness_observed verification", () => {
    const { run } = setupMindCapsule("failing-cmd-accept");
    recordMockCommand(run, "cmd-failing-1", {
      exitCode: 1,
      status: "failed",
      stdout: "Tests failed with 3 errors",
    });

    const verification = verifyDefectWitness("cmd-failing-1", run);
    expect(verification.commandId).toBe("cmd-failing-1");
    expect(verification.exitCode).toBe(1);
    expect(verification.status).toBe("failed");
    expect(verification.evidenceClass).toBe("harness_observed");
    expect(verification.stdout).toContain("Tests failed with 3 errors");
  });

  test("verifyDefectWitness checks defect substring in output", () => {
    const { run } = setupMindCapsule("defect-substring");
    recordMockCommand(run, "cmd-defect-sub-1", {
      exitCode: 1,
      status: "failed",
      stdout: "ReferenceError: foo is not defined in worker.ts:12",
    });

    const verification = verifyDefectWitness(
      "cmd-defect-sub-1",
      run,
      "ReferenceError: foo is not defined",
    );
    expect(verification.output).toContain("ReferenceError");

    expect(() =>
      verifyDefectWitness("cmd-defect-sub-1", run, "SyntaxError: Unexpected token"),
    ).toThrow(HarnessError);
  });
});

describe("mind:candidate CLI command", () => {
  test("refuses defect without --witness", () => {
    const { run } = setupMindCapsule("defect-no-witness");
    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "defect",
        statement: "Type check fails on worker",
        "charter-goal": "G1",
        "write-scope": "src/",
      }),
    ).toThrow(HarnessError);

    try {
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "defect",
        statement: "Type check fails on worker",
        "charter-goal": "G1",
        "write-scope": "src/",
      });
    } catch (err) {
      const hErr = err as HarnessError;
      expect(hErr.code).toBe("INVALID_ARGUMENT");
      expect(hErr.message).toContain("defect candidate requires --witness <command-id>");
    }
  });

  test("refuses defect with non-existent witness command ID", () => {
    const { run } = setupMindCapsule("defect-ghost-witness");
    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "defect",
        statement: "Drift detected",
        witness: "cmd-non-existent-99",
        "charter-goal": "G1",
        "write-scope": "src/",
      }),
    ).toThrow(HarnessError);
  });

  test("refuses defect with exit 0 witness", () => {
    const { run } = setupMindCapsule("defect-exit-0");
    recordMockCommand(run, "cmd-clean-pass", {
      exitCode: 0,
      status: "succeeded",
      stdout: "Clean pass",
    });

    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "defect",
        statement: "Pretended defect",
        witness: "cmd-clean-pass",
        "charter-goal": "G1",
        "write-scope": "src/",
      }),
    ).toThrow(HarnessError);
  });

  test("successfully records defect candidate with failing witness into state and events", () => {
    const { run } = setupMindCapsule("defect-valid");
    recordMockCommand(run, "cmd-real-fail", {
      exitCode: 1,
      status: "failed",
      stdout: "TypeError: null is not an object",
      argv: ["bun", "test", "tests/unit/app.test.ts"],
    });

    const res = mindCandidateCommand({
      run,
      actor: "mind-1",
      kind: "defect",
      statement: "Null pointer in worker initialization",
      witness: "cmd-real-fail",
      "charter-goal": "G1",
      falsifier: "bun test tests/unit/app.test.ts",
      "write-scope": ["src/worker.ts", "tests/unit/app.test.ts"],
    });

    expect(res.candidate_id).toBe("cand-1");
    const candidate = res.candidate as MindCandidate;
    expect(candidate.id).toBe("cand-1");
    expect(candidate.kind).toBe("defect");
    expect(candidate.status).toBe("open");
    expect(candidate.witness_command_id).toBe("cmd-real-fail");
    expect(candidate.falsifier_argv).toEqual(["bun", "test", "tests/unit/app.test.ts"]);
    expect(candidate.falsifier_exit).toBe(1);
    expect(candidate.charter_goal_ids).toEqual(["G1"]);
    expect(candidate.write_scope).toEqual(["src/worker.ts", "tests/unit/app.test.ts"]);

    // Verify projection
    const loaded = loadRun(run, false);
    const candidates = loaded.state.candidates as MindCandidate[];
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe("cand-1");
    expect(candidates[0].witness_command_id).toBe("cmd-real-fail");

    // Verify events
    const events = readFileSync(join(run, "events.jsonl"), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const openedEvent = events.find((e) => e.kind === "mind-candidate-opened");
    expect(openedEvent).toBeDefined();
    expect(openedEvent.payload.candidate_id).toBe("cand-1");
    expect(openedEvent.payload.witness_command_id).toBe("cmd-real-fail");
  });

  test("accepts proposal without witness", () => {
    const { run } = setupMindCapsule("proposal-valid");
    const res = mindCandidateCommand({
      run,
      actor: "mind-1",
      kind: "proposal",
      statement: "Add caching layer for remote charter fetches",
      "charter-goal": "G2",
      "write-scope": "src/cache/",
      rationale: "Reduces network latency by caching parsed ASTs",
    });

    expect(res.candidate_id).toBe("cand-1");
    const candidate = res.candidate as MindCandidate;
    expect(candidate.kind).toBe("proposal");
    expect(candidate.witness_command_id).toBeNull();
    expect(candidate.falsifier_argv).toBeNull();
    expect(candidate.rationale).toBe("Reduces network latency by caching parsed ASTs");

    const loaded = loadRun(run, false);
    const candidates = loaded.state.candidates as MindCandidate[];
    expect(candidates.length).toBe(1);
    expect(candidates[0].kind).toBe("proposal");
  });

  test("refuses proposal that supplies --witness", () => {
    const { run } = setupMindCapsule("proposal-with-witness");
    recordMockCommand(run, "cmd-p-witness", { exitCode: 1 });

    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "proposal",
        statement: "Feature proposal with illegal witness",
        witness: "cmd-p-witness",
        "charter-goal": "G1",
        "write-scope": "src/",
      }),
    ).toThrow(HarnessError);

    try {
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "proposal",
        statement: "Feature proposal with illegal witness",
        witness: "cmd-p-witness",
        "charter-goal": "G1",
        "write-scope": "src/",
      });
    } catch (err) {
      const hErr = err as HarnessError;
      expect(hErr.code).toBe("INVALID_ARGUMENT");
      expect(hErr.message).toContain("proposal candidates must not provide a --witness flag");
    }
  });

  test("refuses proposal past open proposals budget cap", () => {
    const { run } = setupMindCapsule("proposal-cap", {
      budget: { max_open_proposals: 2 },
      initialCandidates: [
        {
          id: "cand-p1",
          kind: "proposal",
          status: "open",
          statement: "P1",
          charter_goal_ids: ["G1"],
          write_scope: ["src/"],
        },
        {
          id: "cand-p2",
          kind: "proposal",
          status: "open",
          statement: "P2",
          charter_goal_ids: ["G1"],
          write_scope: ["src/"],
        },
      ],
    });

    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "proposal",
        statement: "P3 over cap",
        "charter-goal": "G1",
        "write-scope": "src/",
      }),
    ).toThrow(HarnessError);

    try {
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "proposal",
        statement: "P3 over cap",
        "charter-goal": "G1",
        "write-scope": "src/",
      });
    } catch (err) {
      const hErr = err as HarnessError;
      expect(hErr.code).toBe("INVALID_STATE");
      expect(hErr.message).toContain("open proposals cap reached (2/2)");
    }
  });

  test("refuses candidate citing charter goal not in pinned charter", () => {
    const { run } = setupMindCapsule("unpinned-goal");
    recordMockCommand(run, "cmd-failing", { exitCode: 1 });

    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "defect",
        statement: "Goal mismatch defect",
        witness: "cmd-failing",
        "charter-goal": "G99",
        "write-scope": "src/",
      }),
    ).toThrow(HarnessError);

    try {
      mindCandidateCommand({
        run,
        actor: "mind-1",
        kind: "defect",
        statement: "Goal mismatch defect",
        witness: "cmd-failing",
        "charter-goal": "G99",
        "write-scope": "src/",
      });
    } catch (err) {
      const hErr = err as HarnessError;
      expect(hErr.code).toBe("INVALID_ARGUMENT");
      expect(hErr.message).toContain("charter goal 'G99' does not exist in pinned charter goals");
    }
  });

  test("refuses unregistered acting agent", () => {
    const { run } = setupMindCapsule("unregistered-agent", {
      registerMindAgent: false,
    });
    recordMockCommand(run, "cmd-failing", { exitCode: 1 });

    expect(() =>
      mindCandidateCommand({
        run,
        actor: "unregistered-agent",
        kind: "defect",
        statement: "Statement",
        witness: "cmd-failing",
        "charter-goal": "G1",
        "write-scope": "src/",
      }),
    ).toThrow(HarnessError);
  });

  test("resolves witness from flat record path commands/{id}.json", () => {
    const { run } = setupMindCapsule("flat-record");
    const cmdDir = join(run, "commands");
    mkdirSync(cmdDir, { recursive: true });
    const flatPath = join(cmdDir, "cmd-flat.json");
    writeFileSync(
      flatPath,
      JSON.stringify({
        id: "cmd-flat",
        actor: "mind-1",
        tool: "test_runner",
        argv: ["bun", "test"],
        status: "failed",
        exit_code: 1,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
      }),
      "utf-8",
    );

    const resolution = resolveWitnessCommand("cmd-flat", run);
    expect(resolution.commandId).toBe("cmd-flat");
    expect(resolution.recordPath).toBe(flatPath);

    const verified = verifyDefectWitness("cmd-flat", run);
    expect(verified.exitCode).toBe(1);
  });

  test("resolves witness from state.json commands object", () => {
    const { run } = setupMindCapsule("state-record");
    const statePath = join(run, "state.json");
    const stateObj = JSON.parse(readFileSync(statePath, "utf-8"));
    stateObj.commands = {
      "cmd-in-state": {
        id: "cmd-in-state",
        actor: "mind-1",
        tool: "test_runner",
        argv: ["bun", "test"],
        status: "failed",
        exit_code: 2,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
      },
    };
    writeFileSync(statePath, JSON.stringify(stateObj), "utf-8");

    const resolution = resolveWitnessCommand("cmd-in-state", run);
    expect(resolution.commandId).toBe("cmd-in-state");
    expect(resolution.commandRecord.exit_code).toBe(2);

    const verified = verifyDefectWitness("cmd-in-state", run);
    expect(verified.exitCode).toBe(2);
  });

  test("reads custom logs from commandRecord.logs and attempts", () => {
    const { run } = setupMindCapsule("custom-logs");
    const cmdDir = join(run, "commands", "cmd-logs");
    mkdirSync(cmdDir, { recursive: true });

    const stdoutFile = join(run, "custom-out.log");
    const stderrFile = join(run, "custom-err.log");
    writeFileSync(stdoutFile, "Custom stdout line with specific_defect_marker", "utf-8");
    writeFileSync(stderrFile, "Custom stderr line with error", "utf-8");

    const recordPath = join(cmdDir, "record.json");
    writeFileSync(
      recordPath,
      JSON.stringify({
        id: "cmd-logs",
        actor: "mind-1",
        tool: "test_runner",
        argv: ["bun", "test"],
        status: "failed",
        exit_code: 1,
        logs: {
          stdout: { path: "custom-out.log" },
          stderr: { path: "custom-err.log" },
        },
      }),
      "utf-8",
    );

    const verified = verifyDefectWitness("cmd-logs", run, "specific_defect_marker");
    expect(verified.stdout).toContain("specific_defect_marker");
    expect(verified.stderr).toContain("Custom stderr line");
    expect(verified.output).toContain("specific_defect_marker");

    // Throws if expected substring is not in output
    expect(() => verifyDefectWitness("cmd-logs", run, "non_existent_substring")).toThrow(
      HarnessError,
    );
  });

  test("reads logs and exit code from attempts fallback", () => {
    const { run } = setupMindCapsule("attempts-fallback");
    const cmdDir = join(run, "commands", "cmd-att");
    mkdirSync(cmdDir, { recursive: true });

    const attOut = join(run, "att-out.log");
    const attErr = join(run, "att-err.log");
    writeFileSync(attOut, "Attempt stdout output", "utf-8");
    writeFileSync(attErr, "Attempt stderr error", "utf-8");

    const recordPath = join(cmdDir, "record.json");
    writeFileSync(
      recordPath,
      JSON.stringify({
        id: "cmd-att",
        actor: "mind-1",
        tool: "test_runner",
        argv: ["bun", "test"],
        status: "failed",
        attempts: [
          {
            attempt: 1,
            exit_code: 42,
            logs: {
              stdout: { path: "att-out.log" },
              stderr: { path: "att-err.log" },
            },
          },
        ],
      }),
      "utf-8",
    );

    const verified = verifyDefectWitness("cmd-att", run);
    expect(verified.exitCode).toBe(42);
    expect(verified.output).toContain("Attempt stdout");
  });

  test("scans .capsules sibling directory and handles directory edge cases", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "capsules-parent-"));
    roots.push(parentDir);

    const capsulesDir = join(parentDir, ".capsules");
    mkdirSync(capsulesDir, { recursive: true });

    const capA = join(capsulesDir, "cap-a");
    const capB = join(capsulesDir, "cap-b");
    mkdirSync(join(capA, "commands", "cmd-a"), { recursive: true });
    mkdirSync(join(capB, "commands", "cmd-b"), { recursive: true });
    writeFileSync(join(capA, "state.json"), JSON.stringify({}), "utf-8");
    writeFileSync(join(capB, "state.json"), JSON.stringify({}), "utf-8");

    writeFileSync(
      join(capB, "commands", "cmd-b", "record.json"),
      JSON.stringify({
        id: "cmd-b",
        actor: "mind-1",
        tool: "tool",
        status: "failed",
        exit_code: 5,
      }),
      "utf-8",
    );

    // Resolving from sibling capA finds cmd-b in sibling capB
    const res = resolveWitnessCommand("cmd-b", capA);
    expect(res.commandId).toBe("cmd-b");

    // Resolving from parentDir which contains .capsules directory
    const resParent = resolveWitnessCommand("cmd-b", parentDir);
    expect(resParent.commandId).toBe("cmd-b");

    // Resolving from capsulesDir directly
    const resCaps = resolveWitnessCommand("cmd-b", capsulesDir);
    expect(resCaps.commandId).toBe("cmd-b");

    // Resolving with non-existent or regular file path
    const fakeFile = join(parentDir, "regular.txt");
    writeFileSync(fakeFile, "some text", "utf-8");
    expect(() => resolveWitnessCommand("non-existent-cmd", fakeFile)).toThrow(HarnessError);
    expect(() => resolveWitnessCommand("non-existent-cmd", "/non/existent/path/xyz")).toThrow(
      HarnessError,
    );

    // Invalid command ID throws HarnessError
    expect(() => resolveWitnessCommand("", capA)).toThrow(HarnessError);
    expect(() => resolveWitnessCommand(null as unknown as string, capA)).toThrow(HarnessError);
  });
});
