import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateGraph } from "../../../olt/scripts/src/graph/validate-graph.ts";
import { validateRequirements } from "../../../olt/scripts/src/requirements/validate-requirements.ts";
import { validateReview } from "../../../olt/scripts/src/workflow/review/validate-review.ts";
import { validateReport } from "../../../olt/scripts/src/workflow/submission/validate-report.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const vfs = new VirtualMemoryFS();
const session = createVirtualFSSession(vfs);

const virtualPath = "/virtual/references/schema-examples.md";
vfs.mkdirSync("/virtual/references", { recursive: true });

const EXAMPLES: Record<string, Record<string, unknown>> = {
  Requirements: {
    schema: "harness.requirements",
    version: 1,
    prompt_sha256: "fe515cb0785793c167ccb9259e21974d41a6935703ac03176d3e5e88159f9aa0",
    requirements: [
      {
        id: "R-001",
        source_lines: [1],
        source_excerpt: "Preserve the complete prompt.",
        instruction: "Preserve the complete prompt.",
        implementation: "Store the exact prompt bytes and bind them to the run manifest digest.",
        subsystem: "src/store",
        acceptance: [
          {
            id: "A-001",
            criterion: "The stored prompt bytes and manifest digest match the source.",
            evidence: ["A passing prompt-capsule integrity test command"],
          },
        ],
        candidate_gates: [{ argv: ["bun", "test", "tests/store/prompt.test.ts"], cwd: "." }],
        priority: 100,
        risk: "high",
        ambiguity: [],
        dependencies: [],
        disposition: "actionable",
        status: "planned",
      },
    ],
    dispositions: [{ line: 1, kind: "requirement", requirement_id: "R-001" }],
  },
  "Plural source-line mapping": {
    schema: "harness.requirements",
    version: 1,
    prompt_sha256: "d2dea8db8fb2bb51d87a5fea5b4f10d896c66fcd667109a0a12786de232c6193",
    requirements: [
      {
        id: "R-LOCAL",
        source_lines: [1],
        source_excerpt: "Add local caching and publish it only after I approve.",
        instruction: "Add local caching.",
        implementation: "Implement and verify the local cache without publishing anything.",
        subsystem: "src/cache",
        acceptance: [
          {
            id: "A-LOCAL",
            criterion: "The local cache passes its focused behavior tests.",
            evidence: ["A successful focused cache test command"],
          },
        ],
        candidate_gates: [{ argv: ["bun", "test", "tests/cache.test.ts"], cwd: "." }],
        priority: 80,
        risk: "medium",
        ambiguity: [],
        dependencies: [],
        disposition: "actionable",
        status: "planned",
      },
      {
        id: "R-PUBLISH",
        source_lines: [1],
        source_excerpt: "Add local caching and publish it only after I approve.",
        instruction: "Publish only after explicit approval.",
        implementation: "Keep publication paused until an audited user grant authorizes it.",
        subsystem: "release",
        acceptance: [
          {
            id: "A-PUBLISH",
            criterion: "No publication occurs before a recorded grant.",
            evidence: ["The authority history and a successful publication-policy check"],
          },
        ],
        candidate_gates: [{ argv: ["bun", "test", "tests/publish.test.ts"], cwd: "." }],
        priority: 70,
        risk: "high",
        ambiguity: ["The destination is selected only after approval."],
        dependencies: ["R-LOCAL"],
        disposition: "needs_authority",
        status: "planned",
      },
    ],
    dispositions: [
      {
        line: 1,
        kind: "requirement",
        requirement_ids: ["R-LOCAL", "R-PUBLISH"],
        rationale:
          "Publication is a separate external mutation that the user explicitly reserved for approval.",
      },
    ],
  },
  Graph: {
    schema: "harness.graph",
    version: 1,
    revision: 1,
    nodes: [
      {
        id: "requirement-1",
        type: "requirement",
        label: "R-001",
        requirement_id: "R-001",
      },
      {
        id: "artifact-1",
        type: "artifact",
        label: "Immutable prompt capsule",
      },
      {
        id: "task-1",
        type: "task",
        label: "Implement immutable prompt capsule",
        requirement_ids: ["R-001"],
        write_scope: ["src/store"],
        resource_scope: [],
        artifact_ids: ["artifact-1"],
        status: "ready",
        priority: 100,
        effort: 3,
        created_order: 0,
      },
    ],
    edges: [
      { source: "task-1", target: "requirement-1", type: "implements" },
      { source: "task-1", target: "artifact-1", type: "produces" },
    ],
    gates: [
      {
        id: "gate-task-1",
        command: ["bun", "test", "tests/store/prompt.test.ts"],
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-001"],
        mandatory: true,
      },
      {
        id: "gate-run",
        command: ["bun", "test", "tests"],
        cwd: ".",
        scope: "run",
        requirement_ids: [],
        mandatory: true,
      },
    ],
  },
  "Implementer submission": {
    summary: "The prompt capsule now preserves and verifies the exact source bytes.",
    requirement_ids: ["R-001"],
    files_changed: ["src/store/prompt.ts"],
    checks: [{ command_id: "C-IMPLEMENTER-1" }],
    evidence: [{ path: "commands/C-IMPLEMENTER-1/record.json" }],
  },
  "Validator rejection": {
    verdict: "reject",
    requirement_ids: ["R-001"],
    checks: [{ command_id: "C-VALIDATOR-1" }],
    findings: [
      {
        id: "F-001",
        class: "defect",
        requirement_id: "R-001",
        severity: "important",
        observation: "prompt.md retains writable mode bits after initialization.",
        evidence: [{ path: ".olt/capsules/example/prompt.md", mode: "0644" }],
        remediation:
          "Persist prompt.md without any write mode bits and fsync the containing directory.",
        revalidation: "Initialize a fresh run and assert prompt.md mode has no 0222 bits.",
      },
    ],
  },
  "Validator pass after repair": {
    verdict: "pass",
    requirement_ids: ["R-001"],
    checks: [{ command_id: "C-VALIDATOR-2" }],
    findings: [],
    resolved_findings: [
      {
        finding_id: "F-001",
        method: "Initialized a fresh run and inspected prompt.md mode bits.",
        evidence: [{ command_id: "C-VALIDATOR-2" }],
      },
    ],
  },
};

const markdownContent = Object.entries(EXAMPLES)
  .map(
    ([heading, json]) =>
      `## ${heading}\n\n\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\`\n\n`,
  )
  .join("");

vfs.writeFileSync(virtualPath, markdownContent);

afterAll(() => {
  session.cleanup();
  vfs.reset();
});

const source = readFileSync(virtualPath, "utf8");

function example(heading: string): Record<string, unknown> {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = source.match(
    new RegExp(
      `## ${escaped}[^\\n]*\\n(?:(?!\\n## ).)*?\\x60\\x60\\x60json\\s+([\\s\\S]*?)\\x60\\x60\\x60`,
      "us",
    ),
  );
  if (!match?.[1]) throw new Error(`missing JSON example: ${heading}`);
  return JSON.parse(match[1]);
}

const task: TaskRecord = {
  id: "task-1",
  status: "validating",
  requirement_ids: ["R-001"],
  write_scope: ["src/store"],
  dependencies: [],
  attempts: [],
  history: [],
  repair_round: 1,
};

describe("documented schema examples", () => {
  test("requirements and graph pass the production validators", () => {
    const requirements = example("Requirements");
    const graph = example("Graph");
    expect(validateRequirements("Preserve the complete prompt.", requirements)).toEqual([]);
    expect(validateGraph(graph, requirements)).toEqual([]);
  });

  test("plural source-line mapping passes the production requirements validator", () => {
    const requirements = example("Plural source-line mapping");
    expect(
      validateRequirements("Add local caching and publish it only after I approve.", requirements),
    ).toEqual([]);
  });

  test("submission, rejection, and repaired pass satisfy runtime contracts", () => {
    expect(() => validateReport(task, example("Implementer submission"))).not.toThrow();
    expect(validateReview(task, example("Validator rejection"))).toMatchObject({
      verdict: "reject",
    });
    expect(validateReview(task, example("Validator pass after repair"))).toMatchObject({
      verdict: "pass",
      resolved_findings: [{ finding_id: "F-001" }],
    });
  });
});
