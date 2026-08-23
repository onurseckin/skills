import { dependencyMap } from "../../../olt/scripts/src/graph/dependency-map.ts";

function task(
  id: string,
  scope: string,
  options: { priority?: number; created?: number; effort?: number; status?: string } = {},
): Record<string, unknown> {
  return {
    id,
    type: "task",
    label: id,
    requirement_ids: ["R-001"],
    write_scope: [scope],
    resource_scope: [],
    artifact_ids: ["artifact-all"],
    status: options.status ?? "ready",
    priority: options.priority ?? 1,
    created_order: options.created ?? 10,
    effort: options.effort ?? 1,
  };
}

export function schedulerState(): Record<string, unknown> {
  const tasks = [
    task("priority", "priority", { priority: 2 }),
    task("deep", "deep", { created: 1 }),
    task("deep-child", "deep-child", { status: "proposed" }),
    task("deep-grandchild", "deep-grandchild", { status: "proposed" }),
    task("wide", "wide", { created: 1 }),
    task("wide-child-a", "wide-a", { status: "proposed" }),
    task("wide-child-b", "wide-b", { status: "proposed" }),
    task("narrow", "narrow", { created: 1 }),
    task("narrow-child", "narrow-child", { status: "proposed" }),
    task("older", "older", { created: 1 }),
    task("newer", "newer", { created: 2 }),
    task("low-effort", "low-effort", { created: 3 }),
    task("high-effort", "high-effort", { created: 3, effort: 2 }),
    task("lex-a", "lex-a", { created: 4 }),
    task("lex-b", "lex-b", { created: 4 }),
    task("lex.zero", "lex-zero-dot", { created: 5 }),
    task("lex:zero", "lex-zero-colon", { created: 5 }),
  ];
  const dependencies = [
    ["deep-child", "deep"],
    ["deep-grandchild", "deep-child"],
    ["wide-child-a", "wide"],
    ["wide-child-b", "wide"],
    ["narrow-child", "narrow"],
  ];
  const graph = {
    schema: "harness.graph",
    version: 1,
    revision: 1,
    nodes: [
      { id: "requirement-1", type: "requirement", label: "R-001", requirement_id: "R-001" },
      { id: "artifact-all", type: "artifact", label: "All output" },
      ...tasks,
    ],
    edges: dependencies.map(([source, target]) => ({ source, target, type: "depends_on" })),
    gates: [
      {
        id: "gate-one",
        command: ["bun", "test"],
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-001"],
        mandatory: true,
      },
      {
        id: "gate-final",
        command: ["bun", "test", "tests"],
        cwd: ".",
        scope: "run",
        requirement_ids: [],
        mandatory: true,
      },
    ],
  };
  const dependencySets = dependencyMap(graph);
  return {
    graph,
    requirements: {
      schema: "harness.requirements",
      version: 1,
      prompt_sha256: "0".repeat(64),
      requirements: [{ id: "R-001", disposition: "actionable", dependencies: [] }],
      dispositions: [],
    },
    tasks: Object.fromEntries(
      tasks.map((item) => [
        item.id,
        { ...item, dependencies: [...(dependencySets.get(item.id as string) ?? [])] },
      ]),
    ),
  };
}

/**
 * The same three-task, one-dependency shape `plan:init` + `plan:add` + `plan:compile` produce for
 * `t-alpha` (independent), `t-beta` (independent), `t-gamma` (depends on `t-alpha`) — built directly
 * so queue-command tests can seed a capsule with one `transact` instead of driving the CLI.
 */
export function queueCapsuleState(): Record<string, unknown> {
  const tasks = [
    task("t-alpha", "src/alpha", { created: 1 }),
    task("t-beta", "src/beta", { created: 2 }),
    task("t-gamma", "src/gamma", { created: 3 }),
  ].map((entry) => ({ ...entry, label: `Label ${entry.id as string}` }));
  const graph = {
    schema: "harness.graph",
    version: 1,
    revision: 1,
    nodes: [
      { id: "requirement-1", type: "requirement", label: "R-001", requirement_id: "R-001" },
      { id: "artifact-all", type: "artifact", label: "All output" },
      ...tasks,
    ],
    edges: [{ source: "t-gamma", target: "t-alpha", type: "depends_on" }],
    gates: [
      {
        id: "gate-one",
        command: ["bun", "test"],
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-001"],
        mandatory: true,
      },
    ],
  };
  const dependencySets = dependencyMap(graph);
  return {
    graph,
    requirements: {
      schema: "harness.requirements",
      version: 1,
      prompt_sha256: "0".repeat(64),
      requirements: [{ id: "R-001", disposition: "actionable", dependencies: [] }],
      dispositions: [],
    },
    tasks: Object.fromEntries(
      tasks.map((item) => [
        item.id,
        { ...item, dependencies: [...(dependencySets.get(item.id as string) ?? [])] },
      ]),
    ),
  };
}

/**
 * Four tasks that separate the three topology reasons: `t-beta-sub` is only serialized by a write
 * scope nested inside `t-beta`, and `t-gamma` only by its dependency on `t-alpha`.
 */
export function topologyState(): Record<string, unknown> {
  const tasks = [
    task("t-alpha", "src/alpha", { created: 1 }),
    task("t-beta", "src/beta", { created: 2 }),
    task("t-beta-sub", "src/beta/sub", { created: 3 }),
    task("t-gamma", "src/gamma", { created: 4 }),
  ];
  const graph = {
    schema: "harness.graph",
    version: 1,
    revision: 3,
    nodes: [
      { id: "requirement-1", type: "requirement", label: "R-001", requirement_id: "R-001" },
      { id: "artifact-all", type: "artifact", label: "All output" },
      ...tasks,
    ],
    edges: [{ source: "t-gamma", target: "t-alpha", type: "depends_on" }],
    gates: [
      {
        id: "gate-one",
        command: ["bun", "test"],
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-001"],
        mandatory: true,
      },
    ],
  };
  const dependencySets = dependencyMap(graph);
  return {
    graph,
    requirements: {
      schema: "harness.requirements",
      version: 1,
      prompt_sha256: "0".repeat(64),
      requirements: [{ id: "R-001", disposition: "actionable", dependencies: [] }],
      dispositions: [],
    },
    tasks: Object.fromEntries(
      tasks.map((item) => [
        item.id,
        { ...item, dependencies: [...(dependencySets.get(item.id as string) ?? [])] },
      ]),
    ),
  };
}
