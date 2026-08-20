import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { buildRunReportCapsule } from "./markdown-run-report-fixture.ts";

let repo = "";
let markdown = "";
let failingExitCode: unknown;

beforeAll(async () => {
  const built = await buildRunReportCapsule();
  repo = built.repo;
  markdown = built.markdown;
  failingExitCode = built.failingExitCode;
}, 300_000);

afterAll(() => {
  if (repo.length > 0) rmSync(repo, { recursive: true, force: true });
});

function positionOf(heading: string): number {
  const index = markdown.indexOf(heading);
  expect(index, `${heading} is missing from the report`).toBeGreaterThan(-1);
  return index;
}

describe("summary.md is a complete, sequential run report", () => {
  test("carries every section, in run order", () => {
    const headings = [
      "## 1. Run Identity",
      "## 2. Original Prompt",
      "## 3. Enhanced Plan",
      "## 4. Derived Requirements",
      "## 5. Recorded Topology",
      "## 6. Task Graph",
      "## 7. Implementation Phases",
      "## 8. Task Trajectory",
      "## 9. Agents And Sub-agents",
      "## 10. Branch Excursions",
      "## 11. Files Changed",
      "## 12. Scripts And Commands",
      "## 13. Tools",
      "## 14. Probes, Pushbacks And Repairs",
      "## 15. Gates",
      "## 16. Completeness Critic",
      "## 17. Model And Token Telemetry",
      "## 18. Complete Timeline",
    ];
    const positions = headings.map(positionOf);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  test("quotes the original prompt and the enhanced plan derived from it", () => {
    expect(markdown).toContain("Build the alpha subsystem.");
    expect(markdown).toContain("Wire gamma onto alpha.");
    expect(markdown).toContain("Three subsystems, two of them independent");
    expect(markdown).toContain("todo-1: Add parser tests");
    expect(markdown).toContain("The lexer rewrite may regress");
    expect(markdown).toContain("Which grammar version applies");
    expect(markdown).toContain("agent_reported");
    expect(markdown).toContain("authoritative: false");
  });

  test("lists the derived requirements with the prompt lines they bind to", () => {
    for (const requirement of ["req-alpha", "req-beta", "req-gamma"]) {
      expect(markdown).toContain(requirement);
    }
    expect(markdown).toContain("Prompt line dispositions");
  });

  test("records the topology and explains what ran in parallel and why", () => {
    expect(markdown).toContain("**Max parallel**");
    expect(markdown).toContain("priority_capacity");
    expect(markdown).toContain("dependency: wave 2: depends on task-alpha");
    expect(markdown).toContain("2 tasks were free to run in parallel in this phase.");
  });

  test("draws the task graph as ASCII inside the document", () => {
    expect(markdown).toContain("[ WAVE 1 ] 2 tasks in parallel");
    expect(markdown).toContain("| task-alpha  Alpha subsystem");
    expect(markdown).toContain("Dependency edges:");
    expect(markdown).toContain("task-alpha --> task-gamma");
    expect(markdown).not.toContain("```mermaid");
  });

  test("shows every agent and sub-agent with role, parent, grants and reports", () => {
    for (const agent of [
      "coordinator-1",
      "worker-alpha",
      "worker-beta",
      "worker-gamma",
      "validator-1",
      "validator-2",
      "sub-lexer",
      "sub-parser",
      "critic-1",
    ]) {
      expect(markdown).toContain(agent);
    }
    expect(markdown).toContain("+-- sub-lexer [sub-implementer] on S-lexer (released)");
    expect(markdown).toContain("Read (agent_reported)");
    expect(markdown).toContain("Bash [agent_reported]");
  });

  test("explains the branch excursion, who took which sub-task and what came back", () => {
    expect(markdown).toContain("the lexer and the parser had to move together");
    expect(markdown).toContain("Rewrite the lexer");
    expect(markdown).toContain("Rewrite the parser");
    expect(markdown).toContain("lexer and parser landed together");
    expect(markdown).toContain("S-lexer finished");
  });

  test("lists every recorded command with its exit code, including a failing one", () => {
    expect(failingExitCode).toBe(3);
    expect(markdown).toContain("bun -e process.exit(3)");
    expect(markdown).toMatch(/\| 3 \|/);
    expect(markdown).toContain("bun gate.ts");
  });

  test("separates probes from pushbacks and numbers their rounds", () => {
    expect(markdown).toContain("probe-task-alpha-01-1");
    expect(markdown).toContain("Prove the lexer rejects an empty payload");
    expect(markdown).toContain("finding-task-beta-reject");
    expect(markdown).toContain("the beta entry point never validates its input");
    expect(markdown).toContain("### Adversarial probes");
    expect(markdown).toContain("### Pushbacks and defect findings");
    expect(markdown).toContain("| `task-beta` | 1 | 1 |");
    expect(markdown).toContain("| `task-beta` | 1 | code-quality | `validator-1` | reject |");
    expect(markdown).toContain("| `task-beta` | 2 | code-quality | `validator-2` | pass |");
  });

  test("reports the gates, their recorded runs and the critic's verdict", () => {
    expect(markdown).toContain("gate-run-completion");
    expect(markdown).toContain("gate-alpha");
    expect(markdown).toContain("Every requirement is proven by a recorded gate");
    expect(markdown).toContain("| Verdict | clean |");
    expect(markdown).toContain("| Run completion | complete |");
    expect(markdown).toContain("| `req-alpha` | satisfied |");
  });

  test("reports telemetry with its evidence class and unknown where nothing was reported", () => {
    // `agent:register --model` is the caller's own claim, not a host probe, so it earns
    // agent_reported; only the harness's own transcript probe ever earns host_reported.
    expect(markdown).toContain("test-model-l (agent_reported)");
    // `agent:report --tokens-in` is likewise the caller's own running total.
    expect(markdown).toContain("1,200 (agent_reported)");
    expect(markdown).toContain("| `coordinator-1` | coordinator | unknown | unknown |");
    expect(markdown).toContain("derived, estimate");
  });

  test("carries the whole timeline rather than a sample", () => {
    const rows = markdown
      .slice(positionOf("## 18. Complete Timeline"))
      .split("\n")
      .filter((line) => /^\| \d+ \| /.test(line));
    expect(rows.length).toBeGreaterThan(40);
    expect(rows[0]).toContain("| 1 |");
  });
});
