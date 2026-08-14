import { describe, expect, test } from "bun:test";
import { validateGraph } from "../../src/graph/index.ts";
import { taskById, validPlanningDocuments } from "./fixtures.ts";

describe("graph ownership roles and scoped gates", () => {
  test("only proposed or ready statuses may be fabricated in a plan", () => {
    const { graph, requirements } = validPlanningDocuments();
    taskById(graph, "task-1").status = "running";
    expect(validateGraph(graph, requirements)).not.toEqual([]);
  });

  test("requires normalized cwd and explicit task or run gate scope", () => {
    const { graph, requirements } = validPlanningDocuments();
    expect(validateGraph(graph, requirements)).toEqual([]);
    for (const mutate of [
      (gate: Record<string, unknown>) => delete gate.scope,
      (gate: Record<string, unknown>) => delete gate.cwd,
      (gate: Record<string, unknown>) => (gate.scope = "global"),
      (gate: Record<string, unknown>) => (gate.cwd = "../escape"),
    ]) {
      const candidate = structuredClone(graph);
      mutate((candidate.gates as Record<string, unknown>[])[0]!);
      expect(validateGraph(candidate, requirements)).not.toEqual([]);
    }
    const noRun = structuredClone(graph);
    noRun.gates = (noRun.gates as Record<string, unknown>[]).filter(({ scope }) => scope !== "run");
    expect(validateGraph(noRun, requirements)).not.toEqual([]);
  });

  test("run gates cannot substitute for actionable task-gate coverage", () => {
    const { graph, requirements } = validPlanningDocuments();
    const gates = graph.gates as Record<string, unknown>[];
    gates[0]!.mandatory = false;
    gates[1]!.requirement_ids = ["R-001", "R-002"];
    expect(validateGraph(graph, requirements)).not.toEqual([]);
  });

  test("run gates cannot own requirement IDs", () => {
    const { graph, requirements } = validPlanningDocuments();
    const runGate = (graph.gates as Record<string, unknown>[]).find(
      ({ scope }) => scope === "run",
    )!;
    runGate.requirement_ids = ["R-001"];
    expect(validateGraph(graph, requirements)).toContain(
      "gates[1].requirement_ids must be empty for a run gate",
    );
  });

  test("rejects wrapped no-ops, shells, and every inline runtime mode", () => {
    const nestedNoop = [...Array.from({ length: 32 }, () => ["env", "command"]).flat(), "echo"];
    const commands: unknown[] = [
      ["true"],
      ["false"],
      ["/usr/bin/true"],
      ["sh", "-c", "true"],
      ["/bin/sh", "-c", "/usr/bin/true"],
      ["bash", "-lc", "exit 0"],
      ["zsh", "-lc", ":"],
      ["bun", "-e", "process.exit(0)"],
      ["bun", "--eval", " process.exit(0); "],
      ["echo", "passed"],
      ["/usr/bin/printf", "%s", "passed"],
      ["sh", "-c", "echo passed"],
      ["bash", "-lc", "printf '%s\\n' passed; exit 0"],
      ["bun", "-e", "console.log('passed')"],
      ["bun", "-e", "if (1 + 1 !== 2) process.exit(1); console.log('passed')"],
      ["node", "--eval", "1 + 1"],
      ["node", "--eval=require('fs').accessSync('package.json')"],
      ["bun", "-eawait Bun.file('package.json').text()"],
      ["deno", "eval", "Deno.statSync('package.json')"],
      ["env", "RESULT=passed", "echo", "$RESULT"],
      ["env", "-C", ".", "echo", "passed"],
      ["env", "-S", "echo passed"],
      ["command", "env", "MODE=test", "command", "git", "diff", "--check"],
      ["env", "-i", "-u", "IGNORED", "-C", ".", "command", "--", "test", "-f", "package.json"],
      ["command", "printf", "%s", "passed"],
      ["sh", "-c", "command printf '%s\\n' passed"],
      ["node", "-p", "1 + 1"],
      ["node", "--print", "process.cwd()"],
      ["node", "--print=require('fs').accessSync('package.json')"],
      ["node", "--require", "scripts/noop.js"],
      ["bun", "--preload", "scripts/noop.ts"],
      ["deno", "--config", "test"],
      ["fish", "-c", "test -f package.json"],
      ["cmd.exe", "/c", "dir package.json"],
      ["powershell", "-Command", "Test-Path package.json"],
      [
        "bun",
        "-e",
        "// Bun.file('package.json').text(); throw new Error('fake')\nconsole.log('passed')",
      ],
      [
        "bun",
        "-e",
        "const fake = \"Bun.file('package.json').text(); throw new Error('fake')\"; console.log(fake)",
      ],
      [
        "bun",
        "-e",
        "if (false) { await Bun.file('package.json').text(); throw new Error('unreachable') }",
      ],
      [
        "node",
        "-e",
        "require('fs'); const accessSync = () => undefined; accessSync('package.json')",
      ],
      [
        "node",
        "-e",
        "const require = () => ({ accessSync: () => undefined }); require('fs').accessSync('package.json')",
      ],
      ["bun", "-e", "await Bun.file('package.json').text().catch(() => 'passed')"],
      nestedNoop,
      [...Array.from({ length: 300 }, () => "env"), "git", "diff", "--check"],
      "true",
      "false",
      "exit 0",
      "echo passed",
    ];
    for (const command of commands) {
      const { graph, requirements } = validPlanningDocuments();
      (graph.gates as Record<string, unknown>[])[0]!.command = command;
      expect(validateGraph(graph, requirements)).toContain(
        "gates[0].command must perform substantive verification",
      );
    }
  });

  test("accepts direct tools and file-backed runtime gates", () => {
    for (const command of [
      ["git", "diff", "--check"],
      ["test", "-f", "package.json"],
      ["test", "-h", "links/current"],
      ["node", "scripts/verify.js"],
      ["bun", "scripts/verify.ts"],
      ["bun", ".harness/example/runtime/harness.ts", "status", "--run", ".harness/example"],
      ["deno", "test", "tests/verify_test.ts"],
      ["deno", "run", "scripts/verify.ts"],
      ["bun", "test", "tests"],
      ["npm", "run", "lint"],
      ["command", "env", "--", "git", "diff", "--check"],
      ["env", "command", "--", "test", "-f", "package.json"],
    ]) {
      const { graph, requirements } = validPlanningDocuments();
      (graph.gates as Record<string, unknown>[])[0]!.command = command;
      expect(validateGraph(graph, requirements)).toEqual([]);
    }
  });

  test("rejects busybox and toybox multicall wrappers", () => {
    for (const command of [
      ["busybox", "echo", "passed"],
      ["/usr/bin/busybox", "true"],
      ["toybox", "printf", "passed"],
      ["env", "toybox", "test", "-f", "package.json"],
    ]) {
      const { graph, requirements } = validPlanningDocuments();
      (graph.gates as Record<string, unknown>[])[0]!.command = command;
      expect(validateGraph(graph, requirements)).toContain(
        "gates[0].command must perform substantive verification",
      );
    }
  });

  test("rejects unsafe runtime script paths", () => {
    for (const command of [
      ["node", "/dev/null"],
      ["node", "--test=/dev/null"],
      ["node", "--test", "tests/verify.txt"],
      ["node", "/tmp/verify.js"],
      ["node", "../scripts/verify.js"],
      ["node", "./scripts/verify.js"],
      ["node", "scripts\\verify.js"],
      ["node", "scripts/verify.txt"],
      ["bun", "/tmp/verify.ts"],
      ["bun", "test", "tests/verify.txt"],
      ["bun", "../scripts/verify.ts"],
      ["bun", "run", "/tmp/verify.ts"],
      ["bun", "build", "../scripts/verify.ts"],
      ["node", "--test", "/tmp/verify.test.js"],
      ["deno", "run", "/tmp/verify.ts"],
      ["deno", "test", "tests/verify.txt"],
      ["deno", "run", "scripts/verify"],
      ["deno", "check", "../scripts/verify.ts"],
    ]) {
      const { graph, requirements } = validPlanningDocuments();
      (graph.gates as Record<string, unknown>[])[0]!.command = command;
      expect(validateGraph(graph, requirements)).toContain(
        "gates[0].command must perform substantive verification",
      );
    }
  });

  test("pending-authority requirements retain task and mandatory-gate coverage", () => {
    const { graph, requirements } = validPlanningDocuments();
    const second = (requirements.requirements as Record<string, unknown>[])[1]!;
    second.disposition = "needs_authority";
    expect(validateGraph(graph, requirements)).toEqual([]);
    taskById(graph, "task-2").requirement_ids = ["R-001"];
    expect(validateGraph(graph, requirements)).toContain(
      "requirement R-002 is not covered by a task",
    );

    (graph.gates as Record<string, unknown>[])[0]!.requirement_ids = ["R-001"];
    expect(validateGraph(graph, requirements)).toContain(
      "requirement R-002 lacks mandatory task gate coverage",
    );
  });

  test("artifacts must have task ownership", () => {
    const { graph, requirements } = validPlanningDocuments();
    (graph.nodes as unknown[]).push({ id: "artifact-orphan", type: "artifact", label: "Orphan" });
    expect(validateGraph(graph, requirements)).not.toEqual([]);
  });

  test("implementer assignment and validator roles must remain independent", () => {
    const { graph, requirements } = validPlanningDocuments();
    (graph.nodes as unknown[]).push(
      { id: "agent-i", type: "agent", label: "Implementer", role: "implementer" },
      { id: "agent-v", type: "agent", label: "Validator", role: "validator" },
    );
    (graph.edges as unknown[]).push(
      { source: "task-1", target: "agent-i", type: "assigned_to" },
      { source: "agent-v", target: "task-1", type: "validates" },
    );
    expect(validateGraph(graph, requirements)).toEqual([]);
    const contaminated = structuredClone(graph);
    (contaminated.edges as Record<string, unknown>[]).find(
      ({ type }) => type === "validates",
    )!.source = "agent-i";
    expect(validateGraph(contaminated, requirements)).not.toEqual([]);
  });
});
