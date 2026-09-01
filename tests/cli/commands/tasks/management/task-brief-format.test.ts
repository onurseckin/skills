import { afterEach, describe, expect, test } from "bun:test";
import { taskBriefCommand } from "../../../../../olt/scripts/src/cli/commands/task-brief.ts";
import {
  formatTaskBrief,
  formatTaskClaimBrief,
  formatValidationStartBrief,
} from "../../../../../olt/scripts/src/cli/formatters/task-formatter.ts";
import { formatAgentBrief } from "../../../../../olt/scripts/src/cli/formatters/agent-formatter.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { TASK_ID, setupRun } from "../../fixtures/probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("formatTaskBrief", () => {
  test("renders full zero-exploration task briefing with all fields", () => {
    const brief = formatTaskBrief({
      taskId: "task-42",
      label: "Implement User Auth",
      role: "implementer",
      agent: "worker-1",
      writeScope: ["src/auth/jwt.ts", "tests/auth/jwt.test.ts"],
      worktreePath: ".worktrees/task-42",
      targetFiles: ["src/auth/jwt.ts", "tests/auth/jwt.test.ts"],
      recommendedCommands: ["bun test tests/auth/jwt.test.ts"],
      gateCommands: ["bun test tests/auth/jwt.test.ts", "bun run lint"],
      acceptanceCriteria: [
        "Passes JWT verification test suite",
        "Requirement `REQ-1`: Token expiration handled",
      ],
      nextSteps: [
        "bun harness.ts task:claim --run .capsules/test --task task-42 --agent worker-1 --role implementer",
      ],
    });

    expect(brief).toContain("### 🌌 Zero-Exploration Briefing: task-42");
    expect(brief).toContain("- **Label**: Implement User Auth");
    expect(brief).toContain("- **Assignment**: Role: `implementer` · Agent: `worker-1`");
    expect(brief).toContain(
      "- **Assigned Write Scope**: `src/auth/jwt.ts`, `tests/auth/jwt.test.ts`",
    );
    expect(brief).toContain("- **Isolated Worktree**: `.worktrees/task-42`");
    expect(brief).toContain(
      "- **Suggested Target Files**: `src/auth/jwt.ts`, `tests/auth/jwt.test.ts`",
    );
    expect(brief).toContain("- **Recommended Commands**:");
    expect(brief).toContain("  - `bun test tests/auth/jwt.test.ts`");
    expect(brief).toContain("- **Gate Commands**:");
    expect(brief).toContain("  - `bun test tests/auth/jwt.test.ts`");
    expect(brief).toContain("  - `bun run lint`");
    expect(brief).toContain("- **Acceptance Criteria**:");
    expect(brief).toContain("  - Passes JWT verification test suite");
    expect(brief).toContain("  - Requirement `REQ-1`: Token expiration handled");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "1. `bun harness.ts task:claim --run .capsules/test --task task-42 --agent worker-1 --role implementer`",
    );
  });

  test("renders minimal briefing when optional fields are empty or undefined", () => {
    const brief = formatTaskBrief({
      taskId: "task-minimal",
      label: "Minimal Task",
      role: "implementer",
      writeScope: [],
      nextSteps: [],
    });

    expect(brief).toContain("### 🌌 Zero-Exploration Briefing: task-minimal");
    expect(brief).toContain("- **Assignment**: Role: `implementer`");
    expect(brief).toContain("- **Assigned Write Scope**: `none`");
    expect(brief).not.toContain("- **Isolated Worktree**:");
    expect(brief).not.toContain("- **Suggested Target Files**:");
    expect(brief).not.toContain("- **Recommended Commands**:");
    expect(brief).not.toContain("- **Gate Commands**:");
    expect(brief).not.toContain("- **Acceptance Criteria**:");
    expect(brief).not.toContain("⚡ Next Actions:");
  });

  test("renders empty write scope as `none`", () => {
    const brief = formatTaskBrief({
      taskId: "task-no-scope",
      writeScope: [],
    });
    expect(brief).toContain("- **Assigned Write Scope**: `none`");
  });
});

describe("formatAgentBrief", () => {
  test("renders full zero-exploration agent briefing with parent lineage and tools", () => {
    const brief = formatAgentBrief({
      agentId: "worker-sub-1",
      role: "implementer",
      parentAgentId: "coord-1",
      parentTaskId: "task-1",
      model: "claude-3-7-sonnet",
      thinkingLevel: "high",
      tools: ["ReadFile", "WriteFile", "RunBash"],
      writeScope: ["src/lib/helper.ts"],
      recommendedCommands: ["bun test tests/core/lib/helper.test.ts"],
    });

    expect(brief).toContain("### 🌌 Zero-Exploration Briefing: Agent worker-sub-1 (implementer)");
    expect(brief).toContain("- **Under**: `coord-1` / task `task-1`");
    expect(brief).toContain("- **Model**: `claude-3-7-sonnet` · **Thinking**: `high`");
    expect(brief).toContain("- **Tools Granted**: `ReadFile`, `WriteFile`, `RunBash`");
    expect(brief).toContain("- **Assigned Write Scope**: `src/lib/helper.ts`");
    expect(brief).toContain("- **Recommended Commands**:");
    expect(brief).toContain("  - `bun test tests/core/lib/helper.test.ts`");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "bun harness.ts task:brief --task task-1 --agent worker-sub-1 --role implementer",
    );
    expect(brief).toContain(
      "bun harness.ts task:claim --task task-1 --agent worker-sub-1 --role implementer",
    );
  });

  test("renders root agent briefing without parent or task", () => {
    const brief = formatAgentBrief({
      agentId: "root-orchestrator",
      role: "orchestrator",
      parentAgentId: null,
      parentTaskId: null,
      model: "gpt-4o",
      thinkingLevel: "medium",
    });

    expect(brief).toContain(
      "### 🌌 Zero-Exploration Briefing: Agent root-orchestrator (orchestrator)",
    );
    expect(brief).toContain("- **Under**: root / no task");
    expect(brief).toContain("- **Tools Granted**: none");
    expect(brief).not.toContain("- **Assigned Write Scope**:");
  });

  test("renders validator agent next actions properly", () => {
    const brief = formatAgentBrief({
      agentId: "val-agent-1",
      role: "validator",
      parentAgentId: "coord-1",
      parentTaskId: "task-2",
    });

    expect(brief).toContain(
      "bun harness.ts task:validate-start --task task-2 --validator val-agent-1",
    );
  });
});

describe("formatTaskClaimBrief enhancements", () => {
  test("includes target files and recommended commands in leased task brief", () => {
    const brief = formatTaskClaimBrief({
      taskId: "task-1",
      agent: "worker-1",
      token: "tok_123",
      durationMinutes: 20,
      writeScope: ["src/index.ts"],
      worktreePath: ".worktrees/task-1",
      targetFiles: ["src/index.ts"],
      recommendedCommands: ["bun test tests/index.test.ts"],
    });

    expect(brief).toContain("### Task Leased: task-1");
    expect(brief).toContain("- **Suggested Target Files**: `src/index.ts`");
    expect(brief).toContain("- **Recommended Commands**:");
    expect(brief).toContain("  - `bun test tests/index.test.ts`");
  });
});

describe("formatValidationStartBrief enhancements", () => {
  test("includes write scope, target files, and recommended commands for validator", () => {
    const brief = formatValidationStartBrief({
      taskId: "task-1",
      validator: "val-1",
      token: "val_tok_123",
      gates: ["bun test tests/core/core.test.ts"],
      writeScope: ["src/core.ts"],
      targetFiles: ["src/core.ts"],
      recommendedCommands: ["bun test tests/core/core.test.ts"],
      minProbes: 1,
    });

    expect(brief).toContain("### Validation Leased: task-1");
    expect(brief).toContain("- **Task Write Scope**: `src/core.ts`");
    expect(brief).toContain("- **Suggested Target Files**: `src/core.ts`");
    expect(brief).toContain("- **Recommended Commands**:");
    expect(brief).toContain("  - `bun test tests/core/core.test.ts`");
  });
});

describe("taskBriefCommand and agentBriefCommand handler tests", () => {
  test("taskBriefCommand throws HarnessError when neither task nor agent provided", async () => {
    const { run } = await setupRun("task-brief-no-target", roots);
    await expect(taskBriefCommand({ run })).rejects.toThrow(HarnessError);
  });

  test("taskBriefCommand resolves briefing for ready task and returns complete payload", async () => {
    const { run } = await setupRun("task-brief-test", roots);
    const result = await taskBriefCommand({
      run,
      task: TASK_ID,
      agent: "worker-test",
      role: "implementer",
    });

    expect(typeof result.markdown).toBe("string");
    expect(result.run_root).toBe(run);
    expect(result.task).toBeDefined();
    expect(result.briefing).toBeDefined();

    const briefing = result.briefing as {
      taskId: string;
      writeScope: string[];
      gateCommands?: string[];
      recommendedCommands?: string[];
      nextSteps?: string[];
    };
    expect(briefing.taskId).toBe(TASK_ID);
    expect(briefing.writeScope).toEqual(["tests/core"]);
    expect(briefing.gateCommands).toContain("bun gate-core.ts");
    expect(String(result.markdown)).toContain("### 🌌 Zero-Exploration Briefing: " + TASK_ID);
    expect(String(result.markdown)).toContain("bun gate-core.ts");
  });

  test("taskBriefCommand covers custom targets, gates, title, symbols, and criteria", async () => {
    const { run } = await setupRun("task-brief-custom-fields", roots);

    transact(run, "coordinator", "set-custom-task-fields", {}, (draft) => {
      draft.requirements = {
        requirements: [
          { id: "req-1", title: "Auth Flow", status: "open" },
          { id: "req-2", title: "Data Storage", status: "actionable" },
        ],
      };
      const t = draft.tasks[TASK_ID]!;
      t.label = undefined;
      (t as Record<string, unknown>).title = "Custom Title Task";
      t.target_files = ["src/auth.spec.ts", "src/auth.test.js", "src/auth.spec.js", "src/utils.js"];
      t.requirement_ids = ["req-1", "req-2"];
      t.acceptance_criteria = ["Criteria 1: Auth works"];
      t.target_symbols = ["AuthService", "verifyToken"];
      t.gate = "cargo test && pytest && npm test";
      t.status = "changes_requested";
    });

    const result = await taskBriefCommand({
      run,
      task: TASK_ID,
    });

    expect(String(result.markdown)).toContain("Custom Title Task");
    expect(String(result.markdown)).toContain("Auth Flow");
    expect(String(result.markdown)).toContain("Criteria 1: Auth works");
    expect(String(result.markdown)).toContain("bun test src/auth.spec.ts");
  });
});
