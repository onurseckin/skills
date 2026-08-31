import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  renderAsciiDag,
  renderVisualDag,
  type DagNodeSummary,
} from "../../../../olt/scripts/src/cli/commands/dag-view.ts";

describe("renderAsciiDag formatting & Visual Export", () => {
  test("renders clean ASCII box borders with wave headers and status badges", () => {
    const waves = [
      {
        wave: 1,
        tasks: [
          {
            id: "task-init",
            label: "Initialize Storage Layer",
            status: "done",
            priority: 50,
            writeScope: ["src/store"],
            resourceScope: [],
            gate: "bun test store",
            dependencies: [],
            assignedAgent: "worker-0",
            attempt: 1,
            wave: 1,
            criticalDepth: 1,
            descendantCount: 1,
          },
        ],
      },
      {
        wave: 2,
        tasks: [
          {
            id: "task-runner",
            label: "Execute Integration Pipeline",
            status: "ready",
            priority: 50,
            writeScope: ["src/runner"],
            resourceScope: [],
            gate: "bun test runner",
            dependencies: ["task-init"],
            assignedAgent: null,
            attempt: null,
            wave: 2,
            criticalDepth: 0,
            descendantCount: 0,
          },
        ],
      },
    ];

    const rendered = renderAsciiDag(waves, true);

    expect(rendered).toContain("┌─ WAVE 1 (1 lane • done)");
    expect(rendered).toContain("(✓ SATISFIED) task-init");
    expect(rendered).toContain("Initialize Storage Layer");
    expect(rendered).toContain("Role: implementer | Phase: Wave 1 | Work: 1 | Span: 2");
    expect(rendered).toContain("Scope:  src/store");
    expect(rendered).toContain("Agent:  worker-0 (Attempt #1)");
    expect(rendered).toContain("▼");
    expect(rendered).toContain("┌─ WAVE 2 (1 lane • ready)");
    expect(rendered).toContain("(○ READY) task-runner");
    expect(rendered).toContain("Execute Integration Pipeline");
    expect(rendered).toContain("Needs: task-init");
    expect(rendered).toContain("Scope:  src/runner");
    expect(rendered).toContain("Deps:   task-init");
  });

  test("renders active agent coordinate badges and execution subgraphs for leased/validating tasks", () => {
    const waves = [
      {
        wave: 1,
        tasks: [
          {
            id: "task-behavioral-health",
            label: "Behavioral Health Engine",
            status: "leased",
            priority: 90,
            writeScope: ["src/doctor.ts"],
            resourceScope: [],
            gate: "bun test doctor",
            dependencies: [],
            assignedAgent: "impl-behavioral-health",
            assignedRole: "implementer",
            assignedTool: "write_file",
            attempt: 1,
            wave: 1,
            criticalDepth: 1,
            descendantCount: 1,
          },
          {
            id: "task-validator-node",
            label: "Validator Health Audit",
            status: "validating",
            priority: 85,
            writeScope: ["src/validator.ts"],
            resourceScope: [],
            gate: "bun test validator",
            dependencies: [],
            assignedAgent: "val-behavioral-health",
            assignedRole: "validator",
            assignedTool: "verify",
            attempt: 1,
            wave: 1,
            criticalDepth: 1,
            descendantCount: 0,
          },
        ],
      },
    ];

    const rendered = renderAsciiDag(waves, true);

    expect(rendered).toContain("⚡ [ACTIVE EXECUTION SUBGRAPH]");
    expect(rendered).toContain("(🟢 ACTIVE) task-behavioral-health");
    expect(rendered).toContain("[⚡ LEASED: impl-behavioral-health (implementer)]");
    expect(rendered).toContain("(🔵 VALIDATING) task-validator-node");
    expect(rendered).toContain("[⚡ VALIDATING: val-behavioral-health (validator)]");
    expect(rendered).toContain("Tool:   write_file");
    expect(rendered).toContain("Tool:   verify");
    expect(rendered).toContain("──┬── ──▶ [PARALLEL LANE]");
  });

  test("renders dependency reason justifications below task boxes", () => {
    const waves = [
      {
        wave: 1,
        tasks: [
          {
            id: "task-a",
            label: "Schema Definition",
            status: "done",
            priority: 90,
            writeScope: ["src/schema.ts"],
            resourceScope: [],
            gate: "bun test schema",
            dependencies: [],
            assignedAgent: "impl-schema",
            attempt: 1,
            wave: 1,
            criticalDepth: 1,
            descendantCount: 1,
          },
        ],
      },
      {
        wave: 2,
        tasks: [
          {
            id: "task-b",
            label: "Consumer Client",
            status: "ready",
            priority: 80,
            writeScope: ["src/client.ts"],
            resourceScope: [],
            gate: "bun test client",
            dependencies: ["task-a"],
            depReasons: {
              "task-a": "reads schema generated in task-a",
            },
            assignedAgent: null,
            attempt: null,
            wave: 2,
            criticalDepth: 0,
            descendantCount: 0,
          },
        ],
      },
    ];

    const rendered = renderAsciiDag(waves, true);

    expect(rendered).toContain("Deps:   task-a");
    expect(rendered).toContain("↳ Dep on task-a: reads schema generated in task-a");
  });

  test("renders complete topological DAG with boxed nodes, glyphs, connectors, and work/span metrics", () => {
    const task1: DagNodeSummary = {
      id: "task-whoami-identity-command",
      label: "task-whoami-identity-command",
      status: "leased",
      priority: 90,
      writeScope: ["olt/scripts/src/cli/commands/whoami.ts"],
      resourceScope: [],
      gate: "bun test tests/cli/commands/mind/whoami.test.ts",
      dependencies: [],
      assignedAgent: "impl-identity",
      assignedRole: "impl-identity",
      assignedTool: "write_file",
      attempt: 1,
      wave: 1,
      criticalDepth: 0,
      descendantCount: 1,
      effort: 1,
    };

    const task2: DagNodeSummary = {
      id: "task-skill-spec-3m-watchdog",
      label: "task-skill-spec-3m-watchdog",
      status: "blocked",
      priority: 80,
      writeScope: ["olt/SKILL.md"],
      resourceScope: [],
      gate: "bun test tests/contracts/scheduler-invariant.test.ts",
      dependencies: ["task-whoami-identity-command"],
      assignedAgent: null,
      assignedRole: "impl-skill-docs",
      attempt: null,
      wave: 2,
      criticalDepth: 0,
      descendantCount: 0,
      effort: 1,
    };

    const waves = [
      { wave: 1, tasks: [task1] },
      { wave: 2, tasks: [task2] },
    ];

    const rendered = renderVisualDag(waves, { detailed: false });

    expect(rendered).toContain("┌─ WAVE 1 (1 lane • leased) ⚡ [ACTIVE EXECUTION SUBGRAPH]");
    expect(rendered).toContain(
      "(🟢 ACTIVE) task-whoami-identity-command [⚡ LEASED: impl-identity (impl-identity)]",
    );
    expect(rendered).toContain("Role: impl-identity | Phase: Wave 1 | Work: 1 | Span: 1");
    expect(rendered).toContain("┬");
    expect(rendered).toContain("│");
    expect(rendered).toContain("▼");
    expect(rendered).toContain("┌─ WAVE 2 (1 lane • blocked)");
    expect(rendered).toContain("(⏳ BLOCKED) task-skill-spec-3m-watchdog");
    expect(rendered).toContain("Role: impl-skill-docs | Needs: task-whoami-identity-command");
    expect(rendered).toContain("Phase: Wave 2 | Work: 1 | Span: 1");
  });

  test("zero TypeScript any and zero suppressions across dag-view source, visualizer, and test files", async () => {
    const dagViewSource = readFileSync(
      join(import.meta.dir, "../../../../olt/scripts/src/cli/commands/dag-view.ts"),
      "utf8",
    );
    const dagVisualizerSource = readFileSync(
      join(import.meta.dir, "../../../../olt/scripts/src/summary/graph/dag-visualizer.ts"),
      "utf8",
    );
    const testSource = readFileSync(import.meta.path, "utf8");

    const anyAnnotation = new RegExp(":" + " any" + "\\b");
    const anyCast = new RegExp("as" + " any" + "\\b");
    const anyGeneric = new RegExp("<" + "any" + ">");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const content of [dagViewSource, dagVisualizerSource, testSource]) {
      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
