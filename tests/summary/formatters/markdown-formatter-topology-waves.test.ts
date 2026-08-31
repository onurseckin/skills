import { afterEach, describe, expect, test } from "bun:test";
import { cleanupRoots, emptyState, render, task } from "./markdown-fixtures-core.ts";

afterEach(cleanupRoots);

describe("markdown report: the drawing and the tables follow the recorded topology", () => {
  test("tasks the topology never placed are drawn under an explicitly unknown wave", () => {
    const markdown = render({
      ...emptyState,
      tasks: { "task-1": task({ id: "task-1", label: "First" }) },
      task_order: ["task-1"],
    });
    expect(markdown).toContain("[ WAVE unknown ]");
    expect(markdown).toContain("Phase: wave unknown");
    expect(markdown).toContain("One task was scheduled into this phase.");
    expect(markdown).toContain("no topology decision was recorded for this task");
  });

  test("a topology naming a task the state does not hold says so in the drawing", () => {
    const markdown = render({
      ...emptyState,
      tasks: { "task-1": task({ id: "task-1", label: "First" }) },
      topology: {
        revision: 2,
        max_parallel: 3,
        waves: [
          { wave: 1, task_ids: ["task-1"] },
          { wave: 2, task_ids: ["task-ghost"] },
        ],
        decisions: [],
      },
    });
    expect(markdown).toContain(
      "(task task-ghost is listed in the topology but absent from the run state)",
    );
    expect(markdown).toContain("**Topology revision**: 2");
  });

  test("each topology decision is rendered with its rationale and evidence class", () => {
    const markdown = render({
      ...emptyState,
      tasks: {
        "task-1": task({ id: "task-1", label: "First" }),
        "task-2": task({ id: "task-2", label: "Second", dependencies: ["task-1"] }),
      },
      topology: {
        revision: 1,
        max_parallel: 2,
        waves: [
          { wave: 1, task_ids: ["task-1"] },
          { wave: 2, task_ids: ["task-2"] },
        ],
        decisions: [
          {
            task_id: "task-1",
            wave: 1,
            parallel_with: ["task-3"],
            serialized_after: [],
            reason: "priority_capacity",
            rationale: "",
            evidence_class: "derived",
          },
          {
            task_id: "task-2",
            wave: 2,
            parallel_with: [],
            serialized_after: ["task-1"],
            reason: "dependency",
            rationale: "waits on task-1",
            evidence_class: "agent_reported",
          },
        ],
      },
    });
    expect(markdown).toContain(
      "| `task-1` | 1 | `task-3` | none | priority_capacity | unknown | derived |",
    );
    expect(markdown).toContain(
      "| `task-2` | 2 | none | `task-1` | dependency | waits on task-1 | agent_reported |",
    );
  });

  test("a table cell may not smuggle a pipe into the table", () => {
    const markdown = render({
      ...emptyState,
      tasks: { "task-1": task({ id: "task-1", label: "First | Second" }) },
    });
    expect(markdown).toContain("First \\| Second");
  });

  test("a prompt containing a fence is quoted with a longer barrier", () => {
    const markdown = render(emptyState, { promptText: "before\n```\ninner\n```\nafter" });
    expect(markdown).toContain("````\nbefore");
  });

  test("a prompt whose own fence is already four backticks wide cannot close the quote", () => {
    const markdown = render(emptyState, { promptText: "before\n````\ninner\n````\nafter" });
    expect(markdown).toContain("`````\nbefore");
    expect(markdown).toContain("after\n`````");
  });

  test("a value carrying backticks keeps them instead of ending its own code span", () => {
    const markdown = render({
      ...emptyState,
      tasks: { "task-1": task({ id: "task-1", write_scope: ["src/`odd`.ts"] }) },
    });
    expect(markdown).toContain("`` src/`odd`.ts ``");
  });
});
