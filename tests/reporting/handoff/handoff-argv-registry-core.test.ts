import { describe, expect, test } from "bun:test";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";

export const handoffArgvRegistryCoreSuiteName =
  "every command the restart document can name resolves in registry";

const LITERAL_INVOCATION = /registryArgv\(\s*[A-Za-z_$][\w$]*\s*,\s*"([^"]+)"/g;
const INDIRECT_INVOCATION = /registryArgv\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*[,)]/g;
const NAME_LIST = /:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/g;
const QUOTED = /"([^"]+)"/g;

function namesIn(source: string): string[] {
  const names = [...source.matchAll(LITERAL_INVOCATION)].map(([, name]) => name!);
  for (const [, body] of source.matchAll(NAME_LIST)) {
    names.push(...[...body!.matchAll(QUOTED)].map(([, name]) => name!));
  }
  return names;
}

interface ReportingSource {
  file: string;
  source: string;
}

const SOURCES: ReportingSource[] = [
  {
    file: "next-actions.ts",
    source: `
      registryArgv(entrypoint, "report", [["run", runRoot]]);
      registryArgv(entrypoint, "doctor", [["run", runRoot]]);
      registryArgv(entrypoint, "agent:list", [["run", runRoot]]);
      registryArgv(entrypoint, "branch:status", [["run", runRoot], ["all"]]);
      registryArgv(entrypoint, "recover", [["run", runRoot]]);
      registryArgv(entrypoint, "queue:wave", [["run", runRoot]]);
      registryArgv(entrypoint, "queue:next", [["run", runRoot]]);
      registryArgv(entrypoint, "run:exec", [["run", runRoot]]);
    `,
  },
  {
    file: "task-actions.ts",
    source: `
      registryArgv(entrypoint, "task:claim", []);
      registryArgv(entrypoint, "task:validate-start", []);
      registryArgv(entrypoint, "plan:replan", []);
    `,
  },
  {
    file: "branch-actions.ts",
    source: `
      registryArgv(entrypoint, "branch:status", []);
      registryArgv(entrypoint, "branch:claim", []);
      registryArgv(entrypoint, "branch:submit", []);
      registryArgv(entrypoint, "branch:collect", []);
      registryArgv(entrypoint, "branch:abandon", []);
    `,
  },
  {
    file: "active-actions.ts",
    source: `
      registryArgv(entrypoint, "task:heartbeat", []);
      registryArgv(entrypoint, "task:submit", []);
      registryArgv(entrypoint, "task:probe", []);
      registryArgv(entrypoint, "task:review", []);
    `,
  },
  {
    file: "completion-actions.ts",
    source: `
      registryArgv(entrypoint, "critic:start", []);
      registryArgv(entrypoint, "critic:review", []);
      registryArgv(entrypoint, "run:complete", []);
    `,
  },
  {
    file: "preplan-handoff.ts",
    source: `
      registryArgv(entrypoint, name, [["run", run]]);
      const PLANNER_RECOVERABLE_ACTIONS: readonly string[] = [
        "plan:status",
        "plan:compile",
        "doctor",
        "plan:add",
      ];
    `,
  },
];

const EMITTABLE = [...new Set(SOURCES.flatMap(({ source }) => namesIn(source)))].sort();

const REQUIRED = [
  "branch:collect",
  "critic:review",
  "doctor",
  "plan:compile",
  "queue:wave",
  "recover",
  "run:complete",
  "run:exec",
  "report",
  "task:claim",
  "task:probe",
  "task:review",
  "task:submit",
];

describe(handoffArgvRegistryCoreSuiteName, () => {
  test("resolves in the command registry", () => {
    expect(EMITTABLE.filter((name) => findCommand(name) === undefined)).toEqual([]);
  });

  test("is found by a scan that reaches the call sites it claims to cover", () => {
    for (const name of REQUIRED) expect(EMITTABLE).toContain(name);
  });

  test("comes from a list the scan reads when it is not written into the call", () => {
    const indirect = SOURCES.filter(
      ({ source }) => [...source.matchAll(INDIRECT_INVOCATION)].length > 0,
    );
    expect(indirect.map(({ file }) => file)).toEqual(["preplan-handoff.ts"]);
    for (const { source } of indirect) expect(namesIn(source).length).toBeGreaterThan(0);
  });

  test("is rejected when it is one of the invocations the CLI never had", () => {
    const invented = [
      'registryArgv(entrypoint, "nonexistent-status", [["run", run]]);',
      'registryArgv(entrypoint, "packet", [["run", run]]);',
      'registryArgv(entrypoint, "validate", [["run", run]]);',
      'const INVENTED: readonly string[] = ["plan-apply"];',
    ].join("\n");

    expect(
      namesIn(invented)
        .filter((name) => findCommand(name) === undefined)
        .sort(),
    ).toEqual(["nonexistent-status", "packet", "plan-apply", "validate"]);
  });
});
