import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { readBranchLedger } from "../../../olt/scripts/src/workflow/branch/ledger.ts";
import {
  enableInMemoryAgentMetadata,
  disableInMemoryAgentMetadata,
} from "../../../olt/scripts/src/runtime/session.ts";
import {
  enableInMemorySessionStore,
  disableInMemorySessionStore,
} from "../../../olt/scripts/src/authority/session/index.ts";
import { enableInMemoryTelemetrySink } from "../../../olt/scripts/src/reporting/index.ts";
import { QuotaVirtualFs } from "../../telemetry/quota/vfs-harness.ts";

export interface BranchFixture {
  repo: string;
  run: string;
  token: string;
}

let branchFs: QuotaVirtualFs | null = null;
let branchCounter = 0;

export async function cleanupRoots(roots: string[]): Promise<void> {
  disableInMemoryAgentMetadata();
  disableInMemorySessionStore();
  if (branchFs) {
    branchFs.cleanup();
    branchFs = null;
  }
  roots.length = 0;
}

export async function branchCapsule(
  roots: string[],
  name: string,
  config: Record<string, number> = {},
): Promise<BranchFixture> {
  enableInMemoryAgentMetadata();
  enableInMemorySessionStore();
  enableInMemoryTelemetrySink();

  if (!branchFs) {
    branchFs = new QuotaVirtualFs();
    branchFs.setup();
  }
  branchCounter += 1;
  const repo = `/virtual/branch-fixture-${name}-${branchCounter}`;
  roots.push(repo);
  branchFs.setFile(repo, "", true);
  branchFs.setFile(`${repo}/.git`, "", true);
  branchFs.setFile(`${repo}/.olt`, "", true);

  if (Object.keys(config).length > 0) {
    branchFs.setFile(`${repo}/harness.config.json`, JSON.stringify(config));
  }
  branchFs.setFile(`${repo}/.gitignore`, ".olt/capsules/\nprompt.txt\n");
  branchFs.setFile(`${repo}/prompt.txt`, "Build the thing.\nCover the thing with tests.\n");

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run-id",
    name,
    "--prompt-file",
    `${repo}/prompt.txt`,
  ]);
  const run = String(init.run_root);
  await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-1",
    "--label",
    "Thing",
    "--scope",
    "src/one",
    "--gate",
    "bun test tests/branch/scope/containment.test.ts",
    "--actor",
    "planner",
  ]);
  await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests/branch/scope/containment.test.ts",
  ]);
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    "coordinator",
    "--role",
    "coordinator",
    "--host",
    "antigravity",
  ]);
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    "worker-1",
    "--role",
    "implementer",
    "--host",
    "antigravity",
    "--parent-agent",
    "coordinator",
    "--actor",
    "coordinator",
    "--parent-task",
    "task-1",
  ]);
  const claimed = await execute([
    "task:claim",
    "--run",
    run,
    "--task",
    "task-1",
    "--agent",
    "worker-1",
    "--role",
    "implementer",
    "--lease-seconds",
    "600",
  ]);
  return { repo, run, token: String(claimed.token) };
}

export interface OpenOptions {
  reason?: string;
  parentTask?: string;
  agent?: string;
  token?: string;
  subTasks?: readonly { id: string; label: string; scopes: readonly string[] }[];
}

export async function openBranchVia(
  fixture: BranchFixture,
  options: OpenOptions = {},
): Promise<Record<string, unknown>> {
  const subTasks = options.subTasks ?? [
    { id: "S-1", label: "Fix the parser", scopes: ["src/one/parser"] },
  ];
  return execute([
    "branch:open",
    "--run",
    fixture.run,
    "--repo",
    fixture.repo,
    "--parent-task",
    options.parentTask ?? "task-1",
    "--agent",
    options.agent ?? "worker-1",
    "--token",
    options.token ?? fixture.token,
    "--reason",
    options.reason ?? "the parser blocks the API change",
    ...subTasks.flatMap((subTask) => [
      "--sub-task",
      subTask.id,
      "--sub-label",
      `${subTask.id}=${subTask.label}`,
      ...subTask.scopes.flatMap((scope) => ["--sub-scope", `${subTask.id}=${scope}`]),
    ]),
  ]);
}

/** Successively deeper paths, so every link of a chain strictly narrows the one above it. */
const CHAIN_SEGMENTS = ["parser", "lexer", "tokens", "emoji", "skin", "tone"];

export function chainScope(depth: number): string {
  return ["src/one", ...CHAIN_SEGMENTS.slice(0, depth)].join("/");
}

export interface ChainLink {
  branchId: string;
  subTaskId: string;
  agent: string;
  token: string;
}

export async function openChainLevel(
  fixture: BranchFixture,
  level: number,
  parent: { taskId: string; agent: string; token: string },
  leaseSeconds = 600,
): Promise<ChainLink> {
  const subTaskId = `S-${level}`;
  const agent = `sub-${level}`;
  const opened = await openBranchVia(fixture, {
    parentTask: parent.taskId,
    agent: parent.agent,
    token: parent.token,
    reason: `level ${level} needs an agent of its own`,
    subTasks: [{ id: subTaskId, label: `Level ${level}`, scopes: [chainScope(level)] }],
  });
  await execute([
    "agent:register",
    "--run",
    fixture.run,
    "--agent",
    agent,
    "--role",
    "sub-implementer",
    "--host",
    "antigravity",
    "--parent-agent",
    parent.agent,
    "--actor",
    parent.agent,
    "--parent-task",
    subTaskId,
  ]);
  const claimed = await execute([
    "branch:claim",
    "--run",
    fixture.run,
    "--repo",
    fixture.repo,
    "--branch",
    String(opened.branch_id),
    "--sub-task",
    subTaskId,
    "--agent",
    agent,
    "--role",
    "sub-implementer",
    "--lease-seconds",
    String(leaseSeconds),
  ]);
  return { branchId: String(opened.branch_id), subTaskId, agent, token: String(claimed.token) };
}

/** A chain of single-child branches under task-1, each level claimed by its own sub-agent. */
export async function branchChain(
  fixture: BranchFixture,
  depth: number,
  leaseSeconds = 600,
): Promise<ChainLink[]> {
  const links: ChainLink[] = [];
  let parent = { taskId: "task-1", agent: "worker-1", token: fixture.token };
  for (let level = 1; level <= depth; level += 1) {
    const link = await openChainLevel(fixture, level, parent, leaseSeconds);
    links.push(link);
    parent = { taskId: link.subTaskId, agent: link.agent, token: link.token };
  }
  return links;
}

export function branchesOf(run: string) {
  return readBranchLedger(loadRun(run).state);
}

export function taskOf(run: string, taskId: string) {
  const tasks = loadRun(run).state.tasks;
  if (typeof tasks !== "object" || tasks === null || Array.isArray(tasks)) {
    throw new Error("run has no tasks");
  }
  const task = tasks[taskId];
  if (typeof task !== "object" || task === null || Array.isArray(task)) {
    throw new Error(`unknown task ${taskId}`);
  }
  return task;
}

export function eventKinds(run: string): string[] {
  return loadRun(run).events.map((event) => event.kind);
}
