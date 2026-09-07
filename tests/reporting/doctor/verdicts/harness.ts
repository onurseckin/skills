import { join } from "node:path";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  runDoctor,
  type DoctorCheckEngineResult,
} from "../../../../olt/scripts/src/reporting/doctor.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/events/transaction.ts";
import { getVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../../fixture.ts";

export type StateShaper = (state: RunState) => void;

export interface VerdictScenario {
  readonly label: string;
  readonly repoFiles?: Readonly<Record<string, string>>;
  readonly shape?: StateShaper;
  readonly writeScope?: readonly string[];
  readonly testPaths?: readonly string[];
}

export type EngineVerdicts = Readonly<Record<string, DoctorCheckEngineResult>>;

export const CLEAN_WRITE_SCOPE: readonly string[] = ["src/pure-module.ts"];
export const CLEAN_TEST_PATHS: readonly string[] = ["tests/pure-module.test.ts"];

const PURE_SOURCE = `export function combine(left: number, right: number): number {
  return left + right;
}
`;

const PURE_TEST = `import { expect, test } from "bun:test";
import { combine } from "../src/pure-module.ts";

test("combine sums both operands", () => {
  expect(combine(2, 3)).toBe(5);
});
`;

const BASE_REPO_FILES: Readonly<Record<string, string>> = {
  "package.json": "{}",
  "README.md": "# Doctor verdict fixture",
  "tsconfig.json": "{}",
  "src/pure-module.ts": PURE_SOURCE,
  "tests/pure-module.test.ts": PURE_TEST,
};

export function shapeCleanState(state: RunState): void {
  state.tasks = {
    "task-alpha": {
      id: "task-alpha",
      status: "in_progress",
      assigned_agent: "implementer-alpha",
      write_scope: ["src/alpha/**"],
      dependencies: [],
    },
    "task-beta": {
      id: "task-beta",
      status: "in_progress",
      assigned_agent: "implementer-beta",
      write_scope: ["src/beta/**"],
      dependencies: ["task-alpha"],
    },
    "task-gamma": {
      id: "task-gamma",
      status: "satisfied",
      assigned_agent: "implementer-gamma",
      validator_agent: "reviewer-gamma",
      dependencies: ["task-beta"],
      adversarial_probes: [1, 2, 3, 4, 5],
      cognitive_pushbacks: [1, 2, 3, 4, 5],
    },
  };
  state.grants = [
    { id: "implementer-alpha", role: "implementer", tools_used: ["write_to_file"] },
    { id: "implementer-beta", role: "implementer", tools_used: ["edit_file"] },
  ];
  state.commands = {
    "C-0001": {
      id: "C-0001",
      agent_id: "implementer-alpha",
      command: "bun test tests/pure-module.test.ts",
    },
  };
}

function slugify(label: string): string {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return cleaned.length > 0 ? cleaned.slice(0, 60) : "verdict";
}

export async function collectEngineVerdicts(scenario: VerdictScenario): Promise<EngineVerdicts> {
  setupVirtualReportingFS();
  const vfs = getVirtualReportingFS();
  const repo = tempDir(slugify(scenario.label));
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });

  const files: Record<string, string> = { ...BASE_REPO_FILES, ...scenario.repoFiles };
  for (const [relative, content] of Object.entries(files)) {
    const target = join(repo, relative);
    const separator = target.lastIndexOf("/");
    if (separator > 0) vfs.mkdirSync(target.slice(0, separator), { recursive: true });
    vfs.writeFileSync(target, content);
  }

  const runRoot = initRun(
    repo,
    `verdict-${slugify(scenario.label)}`,
    new TextEncoder().encode("Verdict fixture prompt"),
    "file",
    true,
  );

  transact(
    runRoot,
    "coordinator-verdict",
    "plan-brainstormed",
    { plan_id: "verdict-plan" },
    scenario.shape ?? shapeCleanState,
  );

  const report = await runDoctor(
    runRoot,
    {
      repoRoot: repo,
      writeScope: scenario.writeScope ?? CLEAN_WRITE_SCOPE,
      testPaths: scenario.testPaths ?? CLEAN_TEST_PATHS,
      autoHeal: false,
    },
    () => ({ status: 0, bytes: new Uint8Array() }),
  );

  return report.engine_results as EngineVerdicts;
}

export function verdictOf(verdicts: EngineVerdicts, engine: string): DoctorCheckEngineResult {
  const verdict = verdicts[engine];
  if (!verdict) throw new Error(`doctor produced no verdict for engine ${engine}`);
  return verdict;
}

export function codesOf(verdicts: EngineVerdicts, engine: string): readonly string[] {
  return verdictOf(verdicts, engine).findings.map((finding) => finding.code);
}

export function errorCodesOf(verdicts: EngineVerdicts, engine: string): readonly string[] {
  return verdictOf(verdicts, engine)
    .findings.filter((finding) => finding.severity === "ERROR")
    .map((finding) => finding.code);
}

export function messagesOf(verdicts: EngineVerdicts, engine: string): string {
  return verdictOf(verdicts, engine)
    .findings.map((finding) => finding.message)
    .join("\n");
}
