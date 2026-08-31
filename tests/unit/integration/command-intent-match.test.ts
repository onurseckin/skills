import { describe, expect, test } from "bun:test";
import type { CommandRecord, RepositoryBinding } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  sameIntent,
  sameOptionalJson,
  sameRepositoryTransition,
} from "../../../olt/scripts/src/integration/command-intent-match.ts";

function createDummyBinding(): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: "inspection-1",
    git_identity_sha256: "git-1",
    content_sha256: "content-1",
    total_bytes: 100,
    file_count: 5,
  };
}

function createDummyCommand(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id: "cmd-1",
    schema: "harness.command",
    version: 1,
    fingerprint: "fp-1",
    argv: ["echo", "hi"],
    cwd: "/repo",
    cwd_relative: ".",
    repository_root: "/repo",
    started_at: "2026-08-31T00:00:00.000Z",
    finished_at: "2026-08-31T00:00:01.000Z",
    task_id: "task-1",
    gate_id: null,
    record_path: "commands/cmd-1/record.json",
    actor: "implementer",
    assurance: "untrusted",
    status: "succeeded",
    exit_code: 0,
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
    attempt_signing_public_key: "pubkey-1",
    repository_before: createDummyBinding(),
    repository_after: createDummyBinding(),
    ...overrides,
  };
}

describe("command-intent-match", () => {
  describe("sameOptionalJson", () => {
    test("handles null and undefined comparisons", () => {
      expect(sameOptionalJson(null, null)).toBe(true);
      expect(sameOptionalJson(undefined, undefined)).toBe(true);
      expect(sameOptionalJson(null, undefined)).toBe(true);
      expect(sameOptionalJson(undefined, null)).toBe(true);
      expect(sameOptionalJson(undefined, { a: 1 })).toBe(false);
      expect(sameOptionalJson({ a: 1 }, undefined)).toBe(false);
    });

    test("compares json objects properly", () => {
      expect(sameOptionalJson({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 })).toBe(true);
      expect(sameOptionalJson({ a: 1 }, { a: 2 })).toBe(false);
    });
  });

  describe("sameRepositoryTransition", () => {
    test("when gate_id is null, compares repository_after with sameOptionalJson", () => {
      const b1 = createDummyBinding();
      const b2 = createDummyBinding();
      const cmd1 = createDummyCommand({ gate_id: null, repository_after: b1 });
      const cmd2 = createDummyCommand({ gate_id: null, repository_after: b2 });
      expect(sameRepositoryTransition(cmd1, cmd2)).toBe(true);

      const cmd3 = createDummyCommand({
        gate_id: null,
        repository_after: { ...b1, content_sha256: "other" },
      });
      expect(sameRepositoryTransition(cmd1, cmd3)).toBe(false);
    });

    test("when gate_id is present, checks intent has null repository_after and terminal has binding or preflight_failure", () => {
      const b = createDummyBinding();
      const intent = createDummyCommand({ gate_id: "gate-1", repository_after: null });
      const termWithBinding = createDummyCommand({ gate_id: "gate-1", repository_after: b });
      const termWithPreflight = createDummyCommand({
        gate_id: "gate-1",
        repository_after: null,
        preflight_failure: "preflight failed",
      });
      const termNeither = createDummyCommand({ gate_id: "gate-1", repository_after: null });

      expect(sameRepositoryTransition(intent, termWithBinding)).toBe(true);
      expect(sameRepositoryTransition(intent, termWithPreflight)).toBe(true);
      expect(sameRepositoryTransition(intent, termNeither)).toBe(false);

      const intentWithBinding = createDummyCommand({ gate_id: "gate-1", repository_after: b });
      expect(sameRepositoryTransition(intentWithBinding, termWithBinding)).toBe(false);
    });
  });

  describe("sameIntent", () => {
    test("returns true for identical command intents", () => {
      const c1 = createDummyCommand();
      const c2 = createDummyCommand();
      expect(sameIntent(c1, c2)).toBe(true);
    });

    test("handles optional undefined path_bindings and environment", () => {
      const c1 = createDummyCommand({ path_bindings: undefined, environment: undefined });
      const c2 = createDummyCommand({ path_bindings: [], environment: {} });
      expect(sameIntent(c1, c2)).toBe(true);
    });

    test("returns false when any individual field differs", () => {
      const base = createDummyCommand();
      const fields: Array<Partial<CommandRecord>> = [
        { id: "diff-id" },
        { fingerprint: "diff-fp" },
        { attempt_signing_public_key: "diff-key" },
        { cwd: "/diff-cwd" },
        { cwd_relative: "diff" },
        { repository_root: "/diff-repo" },
        { started_at: "2026-08-31T01:00:00.000Z" },
        { task_id: "diff-task" },
        { gate_id: "diff-gate" },
        { record_path: "diff/path.json" },
        { actor: "diff-actor" },
        { assurance: "isolated" },
        { repository_before: null },
        { repository_after: null },
        { policy: { timeout_seconds: 999, max_output_bytes: 1, max_retries: 0 } },
        { path_bindings: [{ host_path: "/a", sandbox_path: "/b", access: "ro" }] },
        { environment: { FOO: "bar" } },
      ];

      for (const override of fields) {
        const mutated = createDummyCommand(override);
        expect(sameIntent(base, mutated)).toBe(false);
      }
    });
  });
});
