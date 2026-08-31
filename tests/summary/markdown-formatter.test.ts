import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandRecord } from "../../olt/scripts/src/core/contracts/index.ts";
import type { GraphDataset } from "../../olt/scripts/src/summary/graph/index.ts";
import type { TimelineEventRecord } from "../../olt/scripts/src/summary/metrics/index.ts";
import { cleanupRoots, emptyState, metrics, render, task, tempRoot } from "./markdown-fixtures.ts";

afterEach(cleanupRoots);

describe("markdown report: absence is stated, never defaulted", () => {
  test("an empty capsule renders every section and says what it does not have", () => {
    const markdown = render(emptyState);

    expect(markdown).toContain("# Execution Run Report: `unit-run`");
    expect(markdown).toContain("| Graph revision | unknown | harness_observed |");
    expect(markdown).toContain("| Inter-agent exchanges | unknown | derived |");
    expect(markdown).toContain("| Media assets recorded | 0 | harness_observed |");
    expect(markdown).toContain("No enhanced plan was recorded for this run.");
    expect(markdown).toContain("No requirements were compiled.");
    expect(markdown).toContain("No topology was recorded");
    expect(markdown).toContain("(no tasks were compiled into this run)");
    expect(markdown).toContain("No tasks were scheduled into a phase.");
    expect(markdown).toContain("The run compiled no tasks.");
    expect(markdown).toContain("No agent grants were registered.");
    expect(markdown).toContain("No branch was opened during this run.");
    expect(markdown).toContain("No agent reported a changed file");
    expect(markdown).toContain("No command was recorded in this run.");
    expect(markdown).toContain("No tool was granted or reported through the CLI");
    expect(markdown).toContain("No probe demand was recorded.");
    expect(markdown).toContain("No defect finding was recorded.");
    expect(markdown).toContain("No gate was compiled.");
    expect(markdown).toContain("No completeness critic was authorised for this run.");
    expect(markdown).toContain("The capsule recorded no event.");
  });

  test("durations are rendered at the scale they were measured at", () => {
    const markdown = render(emptyState, {
      metrics: { ...metrics, wall_duration_ms: 3_720_000, active_command_duration_ms: 250 },
    });
    expect(markdown).toContain("| Wall duration | 62.0m (3720.0s) | harness_observed |");
    expect(markdown).toContain("| Active command time | 250ms | harness_observed |");
  });

  test("a capsule with no prompt bytes says so instead of showing an empty quote", () => {
    expect(render(emptyState, { promptText: "   " })).toContain(
      "The capsule holds no prompt bytes.",
    );
  });

  test("an unreadable agent ledger is reported, never rendered as an empty roster", () => {
    const markdown = render({ ...emptyState, agents: "not-a-ledger" });
    expect(markdown).toContain("The grant ledger could not be read:");
    expect(markdown).toContain("state.agents must be an array of agent grant records");
    expect(markdown).not.toContain("No agent grants were registered.");
  });

  test("a recorded enhanced plan whose document is missing is not silently dropped", () => {
    const markdown = render({
      ...emptyState,
      planning: { enhanced_plan: { revision: 1, markdown_path: "planning/enhanced-plan.md" } },
    });
    expect(markdown).toContain("planning/enhanced-plan.json could not be read");
  });

  test("a plan document with no summary renders the summary as unknown", () => {
    const runRoot = tempRoot();
    mkdirSync(join(runRoot, "planning"), { recursive: true });
    writeFileSync(
      join(runRoot, "planning", "enhanced-plan.json"),
      JSON.stringify({
        schema: "harness.enhanced-plan",
        version: 1,
        run_id: "unit-run",
        prompt_sha256: "abc123",
        derived_from: "prompt.md",
        authoritative: false,
        recorded_at: "2026-08-20T00:00:00.000Z",
        actor: "planner-1",
        observations: [],
        todos: [],
        risks: [],
        open_questions: [],
        sources: [],
      }),
    );
    const markdown = render(emptyState, { runRoot });
    expect(markdown).toContain("**Summary**: unknown (unknown)");
    expect(markdown).toContain("None recorded.");
  });
});

describe("markdown report: task trajectory renders the report's own cited checks and evidence", () => {
  test("renders each cited entry from its kind/command_id/path/detail fields, and falls back to raw JSON otherwise", () => {
    const markdown = render({
      ...emptyState,
      tasks: {
        "task-a": task({
          id: "task-a",
          status: "done",
          report: {
            summary: "Implemented the feature",
            files_changed: ["src/a.ts"],
            checks: [
              { kind: "command", command_id: "C-1" },
              // No kind/command_id/path/detail field at all: falls back to the raw object.
              { arbitrary: "shape" },
            ],
            evidence: [{ kind: "diff", path: "src/a.ts", detail: "added the guard" }],
          },
        }),
      },
    });

    expect(markdown).toContain("| Checks cited | `kind=command command_id=C-1`, `");
    expect(markdown).toContain(JSON.stringify({ arbitrary: "shape" }));
    expect(markdown).toContain(
      "| Evidence cited | `kind=diff path=src/a.ts detail=added the guard` |",
    );
  });
});

describe("markdown report: the critic's own capsule integrity checks render as a table", () => {
  test("renders kind, status, event head and any issues the critic recorded", () => {
    const markdown = render({
      ...emptyState,
      completion_critic: {
        critic_id: "critic-1",
        status: "authorised",
        attempt: 1,
        started_at: "2026-08-20T00:00:00.000Z",
        deadline_at: "2026-08-20T00:10:00.000Z",
        packet_id: "packet-1",
      },
      completion_review: {
        critic_id: "critic-1",
        packet_id: "packet-1",
        status: "pass",
        reviewed_at: "2026-08-20T00:05:00.000Z",
        review_sha256: "s",
        findings: [],
        requirement_proofs: [],
        residual_risks: [],
        integrity_evidence: [
          {
            kind: "event_log",
            status: "verified",
            event_head: "h".repeat(64),
            issues: [{ code: "gap", message: "sequence 4 to 6 missing" }],
          },
          // No status, event_head or issues at all: still one valid row.
          { kind: "manifest" },
        ],
        repository_command_ids: [],
        checks: [],
      },
    });

    const section = markdown.slice(markdown.indexOf("### Capsule integrity evidence"));
    expect(section).toContain(
      `| event_log | verified | \`${"h".repeat(64)}\` | gap: sequence 4 to 6 missing |`,
    );
    expect(section).toContain("| manifest | unknown | `unknown` | none |");
  });
});

describe("markdown report: a file's Git observation reaches the report end to end (B15.2)", () => {
  test("a node's file carries statusCode/sha256 from graph.json into the Files Changed detail block", () => {
    const graph: GraphDataset = {
      id: "g",
      title: "g",
      nodes: [
        {
          id: "node-task-task-a",
          name: "task-a",
          files: [
            {
              path: "src/a.ts",
              mode: "write",
              statusCode: "M",
              sha256: "e".repeat(64),
              evidence_class: "harness_observed",
            },
          ],
        },
      ],
      edges: [],
    };
    const markdown = render(
      { ...emptyState, tasks: { "task-a": task({ id: "task-a", status: "done" }) } },
      { graph },
    );
    const filesSection = markdown.slice(
      markdown.indexOf("## 11. Files Changed"),
      markdown.indexOf("## 12. Scripts And Commands"),
    );
    expect(filesSection).toContain("- **Git status**: `M`");
    expect(filesSection).toContain(`- **Content hash**: \`${"e".repeat(64)}\``);
  });
});
