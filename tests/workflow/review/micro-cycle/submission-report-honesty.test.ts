import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildSubmissionReport } from "../../../../olt/scripts/src/workflow/submission/build-report.ts";
import { observeChangedFiles } from "../../../../olt/scripts/src/workflow/submission/observe-changes.ts";
import type { RepositoryGitCommand } from "../../../../olt/scripts/src/packets/repository-git-command.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { commandRecord, workflowState } from "../../shared/test-port.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

let vfsCleanup: (() => void) | undefined;
const VIRTUAL_REPO = "/virtual/repo/honesty";

beforeEach(() => {
  const setup = setupWorkflowVirtualFs();
  vfsCleanup = setup.cleanup;
  setup.vfs.mkdirSync(VIRTUAL_REPO, { recursive: true });
  setup.vfs.mkdirSync(join(VIRTUAL_REPO, ".git"), { recursive: true });
});

afterEach(() => {
  vfsCleanup?.();
  vfsCleanup = undefined;
});

function task(): TaskRecord {
  return workflowState().tasks["T-1"]!;
}

function gitStub(records: readonly string[]): RepositoryGitCommand {
  return (_repo, argv) => {
    if (argv[0] === "rev-parse") return { status: 0, bytes: Buffer.from("true\n") };
    const payload = records.length === 0 ? "" : `${records.join("\0")}\0`;
    return { status: 0, bytes: Buffer.from(payload, "utf8") };
  };
}

describe("submission report construction", () => {
  test("uses the agent's declared paths and labels them agent_reported", () => {
    const report = buildSubmissionReport({
      task: task(),
      agentId: "agent-1",
      summary: "implemented",
      declaredFiles: ["src/owned/auth.ts"],
      observedFiles: null,
      commands: { "C-1": commandRecord("C-1", { actor: "agent-1" }) },
    });

    expect(report.files_changed).toEqual(["src/owned/auth.ts"]);
    expect(report.files_changed_evidence_class).toBe("agent_reported");
    expect(report.checks).toEqual([{ command_id: "C-1" }]);
    expect(report.checks_evidence_class).toBe("harness_observed");
  });

  test("falls back to every matching observed command, sorted by id", () => {
    const report = buildSubmissionReport({
      task: task(),
      agentId: "agent-1",
      summary: "implemented",
      declaredFiles: ["src/owned/auth.ts"],
      observedFiles: null,
      commands: {
        "C-2": commandRecord("C-2", { actor: "agent-1" }),
        "C-1": commandRecord("C-1", { actor: "agent-1" }),
      },
    });

    expect(report.checks).toEqual([{ command_id: "C-1" }, { command_id: "C-2" }]);
    expect(report.checks_evidence_class).toBe("harness_observed");
  });

  test("falls back to the Git observation narrowed to the write scope", () => {
    const report = buildSubmissionReport({
      task: task(),
      agentId: "agent-1",
      summary: "implemented",
      observedFiles: ["src/owned/auth.ts", "docs/elsewhere.md"],
      commands: { "C-1": commandRecord("C-1", { actor: "agent-1" }) },
    });

    expect(report.files_changed).toEqual(["src/owned/auth.ts"]);
    expect(report.files_changed_evidence_class).toBe("harness_observed");
  });

  test("fails instead of inventing a changed file", () => {
    expect(() =>
      buildSubmissionReport({
        task: task(),
        agentId: "agent-1",
        summary: "implemented",
        observedFiles: [],
        commands: { "C-1": commandRecord("C-1", { actor: "agent-1" }) },
      }),
    ).toThrow("cannot determine files_changed for T-1");
  });

  test("fails instead of inventing a check command id", () => {
    expect(() =>
      buildSubmissionReport({
        task: task(),
        agentId: "agent-1",
        summary: "implemented",
        declaredFiles: ["src/owned/auth.ts"],
        observedFiles: null,
        commands: {},
      }),
    ).toThrow("cannot determine checks for T-1");
  });

  test("refuses declared evidence that names no recorded command", () => {
    expect(() =>
      buildSubmissionReport({
        task: task(),
        agentId: "agent-1",
        summary: "implemented",
        declaredFiles: ["src/owned/auth.ts"],
        declaredCommandIds: ["cmd-T-1-gate"],
        observedFiles: null,
        commands: { "C-1": commandRecord("C-1", { actor: "agent-1" }) },
      }),
    ).toThrow("submission evidence names no recorded command: cmd-T-1-gate");
  });

  test("refuses declared evidence recorded against a different task", () => {
    expect(() =>
      buildSubmissionReport({
        task: task(),
        agentId: "agent-1",
        summary: "implemented",
        declaredFiles: ["src/owned/auth.ts"],
        declaredCommandIds: ["C-9"],
        observedFiles: null,
        commands: { "C-9": commandRecord("C-9", { actor: "agent-1", task_id: "T-2" }) },
      }),
    ).toThrow("belongs to task T-2");
  });

  test("accepts declared command ids that belong to this task and labels them agent_reported", () => {
    const report = buildSubmissionReport({
      task: task(),
      agentId: "agent-1",
      summary: "implemented",
      declaredFiles: ["src/owned/auth.ts"],
      declaredCommandIds: ["C-1"],
      observedFiles: null,
      commands: { "C-1": commandRecord("C-1", { actor: "agent-1" }) },
    });

    expect(report.checks).toEqual([{ command_id: "C-1" }]);
    expect(report.checks_evidence_class).toBe("agent_reported");
  });

  test("accepts a declared command id shared across tasks when its task_id is null", () => {
    const report = buildSubmissionReport({
      task: task(),
      agentId: "agent-1",
      summary: "implemented",
      declaredFiles: ["src/owned/auth.ts"],
      declaredCommandIds: ["C-RUN"],
      observedFiles: null,
      commands: { "C-RUN": commandRecord("C-RUN", { actor: "coordinator", task_id: null }) },
    });

    expect(report.checks).toEqual([{ command_id: "C-RUN" }]);
    expect(report.checks_evidence_class).toBe("agent_reported");
  });

  test("evidence points at the durable record path of each check command", () => {
    const command = commandRecord("C-1", { actor: "agent-1" });
    const report = buildSubmissionReport({
      task: task(),
      agentId: "agent-1",
      summary: "implemented",
      declaredFiles: ["src/owned/auth.ts"],
      observedFiles: null,
      commands: { "C-1": command },
    });

    expect(report.evidence).toEqual([
      { kind: "command_record", command_id: "C-1", path: command.record_path },
    ]);
  });

  test("does not invent placeholder changed files when allowEmptyFiles is false", () => {
    expect(() =>
      buildSubmissionReport({
        task: task(),
        agentId: "agent-1",
        summary: "implemented",
        observedFiles: null,
        commands: { "C-1": commandRecord("C-1", { actor: "agent-1" }) },
      }),
    ).toThrow(/cannot determine files_changed for T-1/);
  });
});

describe("working-tree change observation", () => {
  test("reports every status path once, sorted", () => {
    expect(observeChangedFiles(VIRTUAL_REPO, gitStub(["M  src/a.ts", "?? src/b.ts"]))).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("keeps both halves of a rename record", () => {
    expect(observeChangedFiles(VIRTUAL_REPO, gitStub(["R  src/new.ts", "src/old.ts"]))).toEqual([
      "src/new.ts",
      "src/old.ts",
    ]);
  });

  test("an unchanged tree observes nothing rather than failing", () => {
    expect(observeChangedFiles(VIRTUAL_REPO, gitStub([]))).toEqual([]);
  });

  test("a directory with no Git metadata yields no observation at all", () => {
    const outside = "/virtual/tmp/harness-no-git";
    expect(observeChangedFiles(outside, gitStub(["M  src/a.ts"]))).toBeNull();
  });

  test("a malformed status record is an integrity failure", () => {
    expect(() => observeChangedFiles(VIRTUAL_REPO, gitStub(["M"]))).toThrow(
      "repository status record is malformed",
    );
  });
});
