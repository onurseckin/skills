import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActivityRecord } from "../../../olt/scripts/src/engine/runner/activity-record.ts";
import {
  embeddedCommandIssues as commandShapeIssues,
  sameCommandJson,
} from "../../../olt/scripts/src/engine/runner/command-shape.ts";
import { captureGateEnvironment } from "../../../olt/scripts/src/engine/runner/gate-environment.ts";
import { canonicalCommandFingerprint } from "../../../olt/scripts/src/engine/runner/command-id.ts";
import { DescendantTracker } from "../../../olt/scripts/src/engine/runner/descendant-tracker.ts";
import {
  MIN_POLL_DELAY_MS,
  MAX_POLL_DELAY_MS,
  nextPollDelayMs,
} from "../../../olt/scripts/src/engine/runner/descendant-poll-policy.ts";
import {
  inside,
  portableRelative,
  resolvePathExecutable,
} from "../../../olt/scripts/src/engine/runner/gate-path-binding-verify.ts";
import {
  configOperand,
  pathOperand,
} from "../../../olt/scripts/src/engine/runner/gate-path-operands.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type {
  ProcessIdentity,
  ProcessTopology,
} from "../../../olt/scripts/src/engine/runner/process-identity.ts";

describe("ActivityRecord", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `test-activity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("constructor creates activity.json with running status and started_at", () => {
    const started = "2026-08-24T10:00:00.000Z";
    new ActivityRecord(testDir, "C-12345", 1, started, 1000);

    const activityPath = join(testDir, "activity.json");
    expect(existsSync(activityPath)).toBe(true);

    const content = JSON.parse(readFileSync(activityPath, "utf8")) as Record<string, unknown>;
    expect(content.schema).toBe("harness.command-activity");
    expect(content.command_id).toBe("C-12345");
    expect(content.attempt).toBe(1);
    expect(content.status).toBe("running");
    expect(content.started_at).toBe(started);
  });

  test("output tracks stdout and stderr bytes and lastOutputAt", () => {
    const started = "2026-08-24T10:00:00.000Z";
    const record = new ActivityRecord(testDir, "C-12345", 1, started, 0); // 0ms interval persists immediately

    const outputTime = new Date("2026-08-24T10:01:00.000Z");
    record.output("stdout", 128, outputTime);
    record.output("stderr", 64, outputTime);

    const content = JSON.parse(readFileSync(join(testDir, "activity.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(content.stdout_bytes).toBe(128);
    expect(content.stderr_bytes).toBe(64);
    expect(content.last_output_at).toBe("2026-08-24T10:01:00.000Z");
  });

  test("complete updates status to completed or failed with finished_at", () => {
    const started = "2026-08-24T10:00:00.000Z";
    const record = new ActivityRecord(testDir, "C-12345", 1, started, 1000);

    const completeTime = new Date("2026-08-24T10:02:00.000Z");
    record.complete("completed", completeTime);

    const content = JSON.parse(readFileSync(join(testDir, "activity.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(content.status).toBe("completed");
    expect(content.finished_at).toBe("2026-08-24T10:02:00.000Z");
  });
});

describe("Command Shape", () => {
  let tempRepo: string;
  let samplePublicKey: string;
  let sampleEnvironment: Record<string, string>;

  beforeEach(() => {
    tempRepo = realpathSync(tmpdir());
    const keyPair = generateKeyPairSync("ed25519");
    const der = keyPair.publicKey.export({ format: "der", type: "spki" });
    samplePublicKey = Buffer.from(der).toString("base64");
    sampleEnvironment = captureGateEnvironment(
      { PATH: "/usr/bin:/bin", TMPDIR: tempRepo },
      "12345678-1234-4234-a234-123456789abc",
    );
  });

  function createSampleCommand(overrides: Partial<CommandRecord> = {}): CommandRecord {
    const id = "C-test-1";
    const repo = tempRepo;
    const argv = ["bun", "test"];
    const fingerprint = canonicalCommandFingerprint(repo, argv);
    return {
      schema: "harness.command-record",
      version: 1,
      id,
      actor: "implementer",
      task_id: "task-1",
      gate_id: null,
      fingerprint,
      status: "running",
      argv,
      cwd: repo,
      cwd_relative: ".",
      repository_root: repo,
      record_path: join(repo, "commands", id, "record.json"),
      started_at: "2026-08-24T10:00:00.000Z",
      finished_at: null,
      duration_ms: 1000,
      attempts: [],
      environment: sampleEnvironment,
      attempt_signing_public_key: samplePublicKey,
      policy: {
        wall_timeout_ms: 60_000,
        idle_timeout_ms: 30_000,
        grace_ms: 1_000,
        drain_timeout_ms: 5_000,
        heartbeat_interval_ms: 1_000,
        max_output_bytes: 64 * 1024 * 1024,
        max_retries: 0,
        idempotent: false,
      },
      ...overrides,
    };
  }

  test("commandShapeIssues returns 0 issues for standard non-gate command", () => {
    const cmd = createSampleCommand();
    const issues = commandShapeIssues(cmd);
    expect(issues).toEqual([]);
  });

  test("commandShapeIssues validates command ID format, actor, and argv", () => {
    const badId = createSampleCommand({ id: "invalid_id_format" });
    expect(commandShapeIssues(badId)).toContain("command id is invalid");

    const blankActor = createSampleCommand({ actor: "   " });
    expect(commandShapeIssues(blankActor)).toContain("command actor is invalid");

    const emptyArgv = createSampleCommand({ argv: [] });
    expect(commandShapeIssues(emptyArgv)).toContain("command argv is invalid");
  });

  test("sameCommandJson compares structural equality of command records", () => {
    const cmdA = createSampleCommand();
    const cmdB = structuredClone(cmdA);
    expect(sameCommandJson(cmdA, cmdB)).toBe(true);

    const cmdDifferent = createSampleCommand({ actor: "other-agent" });
    expect(sameCommandJson(cmdA, cmdDifferent)).toBe(false);
  });
});

describe("Descendant Tracker and Poll Policy", () => {
  test("poll policy increments backoff between MIN_POLL_DELAY_MS and MAX_POLL_DELAY_MS", () => {
    expect(MIN_POLL_DELAY_MS).toBeGreaterThan(0);
    expect(MAX_POLL_DELAY_MS).toBeGreaterThan(MIN_POLL_DELAY_MS);

    const next1 = nextPollDelayMs(MIN_POLL_DELAY_MS);
    expect(next1).toBeGreaterThanOrEqual(MIN_POLL_DELAY_MS);
    expect(next1).toBeLessThanOrEqual(MAX_POLL_DELAY_MS);

    const capped = nextPollDelayMs(MAX_POLL_DELAY_MS);
    expect(capped).toBe(MAX_POLL_DELAY_MS);
  });

  test("DescendantTracker starts and stops with mocked process dependencies", async () => {
    const rootPid = 1234;
    const runnerPid = process.pid;
    const mockIdentity: ProcessIdentity = {
      pid: rootPid,
      parent: runnerPid,
      group: rootPid,
      birth: "2026-08-24T10:00:00.000Z",
    };
    const mockProcesses = new Map<number, ProcessTopology>([
      [rootPid, { pid: rootPid, parent: runnerPid, group: rootPid }],
    ]);

    const tracker = new DescendantTracker(rootPid, new Set(), "mock-token", {
      runnerPid,
      identify: (pid) => (pid === rootPid ? mockIdentity : undefined),
      snapshot: async () => mockProcesses,
      kill: () => {},
      pipeOwners: () => new Set(),
      tokenOwners: () => new Set(),
    });

    const root = await tracker.start();
    expect(root).toBeDefined();
    expect(root?.pid).toBe(rootPid);

    await tracker.stop();
  });
});

describe("Gate Path Validation and Operands", () => {
  const repo = "/workspace/project";

  test("inside determines filesystem path containment", () => {
    expect(inside(repo, "/workspace/project/src/index.ts")).toBe(true);
    expect(inside(repo, "/workspace/project/tests/unit/test.ts")).toBe(true);
    expect(inside(repo, "/workspace/other/file.ts")).toBe(false);
    expect(inside(repo, "/etc/passwd")).toBe(false);
    expect(inside(repo, "/workspace/project/../project/src")).toBe(true);
  });

  test("portableRelative converts path to relative with forward slashes and throws if outside", () => {
    const rel = portableRelative(repo, "/workspace/project/src/core/runner.ts");
    expect(rel).toBe("src/core/runner.ts");

    expect(() => portableRelative(repo, "/outside/file.ts")).toThrow(HarnessError);
  });

  test("resolvePathExecutable finds binaries in PATH or throws on missing binary", () => {
    const pathEnv = process.env.PATH ?? "/usr/bin:/bin";
    const lsPath = resolvePathExecutable("ls", pathEnv);
    expect(lsPath).toBeDefined();
    expect(existsSync(lsPath)).toBe(true);

    expect(() => resolvePathExecutable("non_existent_binary_xyz_123", pathEnv)).toThrow(
      HarnessError,
    );
  });

  test("pathOperand and configOperand extract CLI file operands", () => {
    expect(pathOperand("src/index.ts", "/tmp", false)).toBe("src/index.ts");
    expect(pathOperand("./src/runner.ts", "/tmp", false)).toBe("./src/runner.ts");
    expect(pathOperand("--flag", "/tmp", false)).toBeUndefined();
    expect(pathOperand("--file=src/index.ts", "/tmp", false)).toBe("src/index.ts");

    expect(configOperand(["bun", "test", "--config", "vitest.config.ts"], 3)).toBe(true);
    expect(configOperand(["bun", "test", "src/index.ts"], 2)).toBe(false);
  });
});
