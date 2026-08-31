import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CommandAttemptRecord,
  CommandRecord,
  RepositoryBinding,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import { recoverGateAttempt } from "../../../olt/scripts/src/integration/recover-gate-attempt.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("recover-gate-attempt", () => {
  function makeBinding(sha: string = "b-1"): RepositoryBinding {
    return {
      schema: "harness.repository-binding",
      version: 1,
      inspection_sha256: `insp-${sha}`,
      git_identity_sha256: `git-${sha}`,
      content_sha256: `content-${sha}`,
      total_bytes: 100,
      file_count: 5,
    };
  }

  function makeIntent(gateId: string | null = "gate-1"): CommandRecord {
    return {
      id: "cmd-gate-1",
      schema: "harness.command",
      version: 1,
      fingerprint: "fp-1",
      argv: ["echo", "test"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      started_at: "2026-08-31T00:00:00.000Z",
      finished_at: null,
      task_id: "task-1",
      gate_id: gateId,
      record_path: "commands/cmd-gate-1/record.json",
      actor: "implementer",
      assurance: "gate",
      status: "running",
      exit_code: null,
      signal: null,
      signals_sent: [],
      timeout_kind: null,
      failure_class: null,
      attempts: [],
      retry_exhausted: false,
      retry_pending: false,
      policy: {
        timeout_seconds: 60,
        max_output_bytes: 1024,
        max_retries: 0,
      },
      path_bindings: [],
      environment: {},
      attempt_signing_public_key: "key-1",
      repository_before: makeBinding("before"),
      repository_after: null,
    };
  }

  function makeAttempt(): CommandAttemptRecord {
    return {
      id: "cmd-gate-1",
      attempt: 1,
      status: "succeeded",
      started_at: "2026-08-31T00:00:00.000Z",
      finished_at: "2026-08-31T00:00:01.000Z",
      exit_code: 0,
      signal: null,
      signals_sent: [],
      timeout_kind: null,
      failure_class: null,
      activity_path: "activity.json",
      activity: { path: "activity.json", bytes: 10, sha256: "a1" },
      logs: {
        stdout: { path: "stdout.log", bytes: 5, sha256: "s1" },
        stderr: { path: "stderr.log", bytes: 0, sha256: "s0" },
      },
      evidence_issues: [],
    };
  }

  test("returns original attempt unchanged when intent.gate_id is null", () => {
    const intent = makeIntent(null);
    const candidate = makeAttempt();
    const result = recoverGateAttempt(
      intent,
      candidate,
      "/fake/path.json",
      () => makeBinding(),
      () => new Date(),
    );
    expect(result.attempt).toBe(candidate);
    expect(result.integrityFailed).toBe(false);
  });

  test("recovers unfinalized gate attempt and marks it POST_INTERRUPTED", () => {
    const root = scratchRoot(import.meta.path, "gate-unfinalized");
    const recordPath = join(root, "record.json");
    mkdirSync(root, { recursive: true });

    const intent = makeIntent("gate-1");
    const candidate = makeAttempt(); // lacks gate_finalized_at and repository_after

    const result = recoverGateAttempt(
      intent,
      candidate,
      recordPath,
      () => makeBinding("recovered-after"),
      () => new Date("2026-08-31T00:00:05.000Z"),
    );

    expect(result.integrityFailed).toBe(true);
    expect(result.attempt.status).toBe("failed");
    expect(result.attempt.integrity_failure).toBe(
      "gate post-observation interrupted before integrity finalization",
    );
    expect(result.attempt.gate_finalized_at).toBe("2026-08-31T00:00:05.000Z");
    expect(result.attempt.repository_after?.content_sha256).toBe("content-recovered-after");
    expect(existsSync(recordPath)).toBe(true);
  });

  test("detects repository drift between repository_before and repository_after", () => {
    const root = scratchRoot(import.meta.path, "gate-drift");
    const recordPath = join(root, "record.json");
    mkdirSync(root, { recursive: true });

    const intent = makeIntent("gate-1"); // before has "before"
    const candidate: CommandAttemptRecord = {
      ...makeAttempt(),
      gate_finalized_at: "2026-08-31T00:00:02.000Z",
      repository_after: makeBinding("drifted"), // different sha from "before"
    };

    const result = recoverGateAttempt(
      intent,
      candidate,
      recordPath,
      () => makeBinding("dummy"),
      () => new Date(),
    );

    expect(result.integrityFailed).toBe(true);
    expect(result.attempt.status).toBe("failed");
    expect(result.attempt.integrity_failure).toBe(
      "gate repository changed before durable integrity finalization",
    );
    expect(existsSync(recordPath)).toBe(true);
  });

  test("leaves cleanly matching gate attempt unchanged and does not rewrite file", () => {
    const root = scratchRoot(import.meta.path, "gate-clean");
    const recordPath = join(root, "record.json");
    mkdirSync(root, { recursive: true });

    const intent = makeIntent("gate-1");
    const candidate: CommandAttemptRecord = {
      ...makeAttempt(),
      gate_finalized_at: "2026-08-31T00:00:02.000Z",
      repository_after: makeBinding("before"), // matching "before"
    };

    const result = recoverGateAttempt(
      intent,
      candidate,
      recordPath,
      () => makeBinding("dummy"),
      () => new Date(),
    );

    expect(result.integrityFailed).toBe(false);
    expect(result.attempt).toBe(candidate);
    expect(existsSync(recordPath)).toBe(false);
  });
});
