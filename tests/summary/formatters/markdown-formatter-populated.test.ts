import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupRoots, emptyState, render, tempRoot } from "./markdown-fixtures-core.ts";
import { populatedGraph, populatedRunRoot, populatedState } from "./markdown-fixtures-dag.ts";

afterEach(cleanupRoots);

describe("markdown report: a fully populated capsule renders every recorded fact", () => {
  test("renders the plan document, the requirement document and the gates it compiled", () => {
    const markdown = render(populatedState, { runRoot: populatedRunRoot() });

    expect(markdown).toContain("| Graph revision | 4 | harness_observed |");
    expect(markdown).toContain("**Summary**: Two subsystems (agent_reported)");
    expect(markdown).toContain("| 1 | todo-1: Add parser tests | agent_reported |");
    expect(markdown).toContain("| 1 | src has no tests | agent_reported |");
    expect(markdown).toContain(
      "| `req-1` | satisfied | actionable | 1, 2 | Do the thing | runtime | medium | 50 | none |",
    );
    expect(markdown).toContain("| `req-1` | the gate passes | task:task-1 |");
    expect(markdown).toContain("| 2 | context | none | background |");
    expect(markdown).toContain("| `gate-1` | task | `bun gate.ts` | true | `req-1` | C-1 exit 0 |");
    expect(markdown).toContain("| `gate-run` | run | `bun test` | true | none | never run |");
    expect(markdown).toContain("| `task-1` | `gate-1` | `C-1` | passed |");
  });

  test("renders commands, tools, branch observations and validation attempts", () => {
    const markdown = render(populatedState, { runRoot: populatedRunRoot(), graph: populatedGraph });

    expect(markdown).toContain(
      "| `C-1` | `bun gate.ts` | `validator-1` | `task-1` | `gate-1` | succeeded | 0 | 2.0s | 12 | 0 | unknown |",
    );
    expect(markdown).toContain("`bun -e process.exit(2)`");
    expect(markdown).toContain("| `Bash (shell)` | `worker-1` | used | agent_reported |");
    expect(markdown).toContain(
      "| Worktree at collect | 1 paths at 2026-08-20T00:00:06.000Z (head abc) |",
    );
    // The branch's own Git-observed file (B15.2): no rationale or diff was read for it (this fixture
    // hand-builds the graph rather than running a real Git diff), so step, lines and delta stay
    // unknown rather than a guessed value.
    expect(markdown).toContain(
      "| `src/one/parser.ts` | `B-1` | unknown | write | unknown | unknown | harness_observed |",
    );
    // The task's own submitted file, enriched with a rationale and a step (B15.2).
    expect(markdown).toContain(
      "| `src/one/index.ts` | `task-1` | 12 | write | 1-4 | +3/-1 | harness_observed |",
    );
    expect(markdown).toContain("#### `src/one/index.ts` (task-1)");
    expect(markdown).toContain("- **Why**: Implemented the parser rewrite");
    // validation_history[0] carries no domain in the fixture, so the column says so rather than
    // guessing the one domain validations[0] happens to use.
    expect(markdown).toContain("| `task-1` | 1 | unknown | `validator-1` | reject | none |");
    expect(markdown).toContain("| `task-1` | 2 | code-quality | `validator-2` | pass | `C-1` |");
    expect(markdown).toContain("probe_demand_answered via `C-1`");
    expect(markdown).toContain("| 900 (host_reported) | 120 (host_reported) |");
    expect(markdown).toContain(
      "| 2026-08-20T00:00:00.000Z | ready | leased | `worker-1` | 1 | claimed |",
    );
  });

  test("reads the critic's own words from the report it wrote", () => {
    const markdown = render(
      {
        ...populatedState,
        completion_critic: {
          critic_id: "critic-1",
          token_digest: "d",
          attempt: 1,
          status: "reviewed",
          started_at: "2026-08-20T00:00:00.000Z",
          deadline_at: "2026-08-20T01:00:00.000Z",
          readiness_sha256: "r",
          repository_binding: {},
        },
      },
      { runRoot: populatedRunRoot() },
    );
    expect(markdown).toContain("| Decision recorded in the report | approve |");
    expect(markdown).toContain("| Critic summary | The whole diff is proven |");
    expect(markdown).toContain("| Report written at | 2026-08-20T01:00:00.000Z |");
  });

  test("a plan document whose entries are unreadable loses the entries, not the page", () => {
    const runRoot = tempRoot();
    mkdirSync(join(runRoot, "planning"), { recursive: true });
    writeFileSync(
      join(runRoot, "planning", "enhanced-plan.json"),
      JSON.stringify({
        schema: "harness.enhanced-plan",
        summary: 42,
        observations: "not-a-list",
        todos: [{ id: "todo-1" }],
        risks: [{ value: "a real risk" }],
      }),
    );
    const markdown = render(emptyState, { runRoot });
    expect(markdown).toContain("Derived from unknown and authoritative: unknown");
    expect(markdown).toContain("Recorded by unknown at unknown");
    expect(markdown).toContain("**Summary**: unknown (unknown)");
    expect(markdown).toContain("| 1 | a real risk | unknown |");
    expect(markdown).toContain("None recorded.");
  });

  test("an unparseable plan document is reported as unreadable, not as an empty plan", () => {
    const root = tempRoot();
    mkdirSync(join(root, "planning"), { recursive: true });
    writeFileSync(join(root, "planning", "enhanced-plan.json"), "{ not json");
    const markdown = render(
      { ...emptyState, planning: { enhanced_plan: { revision: 1 } } },
      { runRoot: root },
    );
    expect(markdown).toContain("planning/enhanced-plan.json could not be read");
  });
});
