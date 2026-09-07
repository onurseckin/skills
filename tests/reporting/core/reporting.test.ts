import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";
import { renderHandoff, writeHandoff } from "../../../olt/scripts/src/reporting/handoff.ts";
import { renderPreplanHandoff } from "../../../olt/scripts/src/reporting/preplan-handoff.ts";
import { runStatus } from "../../../olt/scripts/src/reporting/status.ts";
import { dispatchFailures, handoffArgv } from "./dispatchable.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  disableInMemorySessionStore,
  enableInMemorySessionStore,
} from "../../../olt/scripts/src/authority/session/paths.ts";

mock.module("../../../olt/scripts/src/installer/installation-status.ts", () => ({
  installationStatus: async () => ({
    installed: false,
    drifted: true,
    destination: "/virtual/destination",
    links: { codex: "/virtual/destination", claude: null },
    issues: ["not installed"],
  }),
}));

mock.module("../../../olt/scripts/src/packets/repository-git-command.ts", () => ({
  repositoryGit: () => ({ status: 0, bytes: Buffer.alloc(0) }),
  REPOSITORY_GIT_TIMEOUT_MS: 15_000,
}));

mock.module("../../../olt/scripts/src/engine/store/integrity/integrity.ts", () => ({
  verifyIntegrity: () => [],
}));

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | null = null;
let counter = 0;

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function setupReportingSandbox(): VirtualMemoryFS {
  enableInMemorySessionStore();
  if (session) {
    session.cleanup();
    session = null;
  }
  vfs = new VirtualMemoryFS();
  const repoRoot = normPath(process.cwd());
  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".git"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".olt"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".olt", "capsules"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".olt", "scratch"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".olt", "runs"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".tmp"), { recursive: true });
  vfs.writeFileSync(
    join(repoRoot, "package.json"),
    JSON.stringify({ name: "@onurseckinsenoglu/skills" }),
  );
  vfs.mkdirSync("/virtual/scratch", { recursive: true });
  vfs.chdir(repoRoot);
  session = createVirtualFSSession(vfs);
  return vfs;
}

function cleanupReportingSandbox(): void {
  disableInMemorySessionStore();
  if (session) {
    session.cleanup();
    session = null;
  }
  vfs = new VirtualMemoryFS();
}

function tempDir(label = "test"): string {
  counter += 1;
  const dir = `/virtual/scratch/reporting-${label}-${counter}`;
  vfs.mkdirSync(dir, { recursive: true });
  return dir;
}

const skillRoot = join(process.cwd(), "olt");
const gateEvidence = {
  assurance: "trusted_host_observed_v1",
  sandboxed: false,
  trusted_boundary: "local OS user, host-selected toolchain and transitive processes",
};
const gateEvidenceLimitations = [
  "The host or coding application may add a sandbox; the harness neither configures nor attests it.",
  "Same-user mutate, execute, and restore between observations is outside this assurance.",
  "Process ownership signaling remains independently fail-closed.",
];

function fixture(extraMutate?: (state: Record<string, unknown>) => void): string {
  const repo = tempDir("harness-report");
  const runRoot = initRun(
    repo,
    "handoff-run",
    new TextEncoder().encode("Keep every instruction"),
    "file",
    true,
  );
  transact(runRoot, "planner", "plan-applied", {}, (state) => {
    state.graph = { revision: 3, gates: [] };
    state.requirements = {
      requirements: [{ id: "R-1", disposition: "actionable", status: "planned", evidence: [] }],
    };
    state.tasks = {
      "task-1": {
        id: "task-1",
        status: "ready",
        requirement_ids: ["R-1"],
        dependencies: [],
        write_scope: ["src/**"],
        attempts: [],
        history: [],
        repair_round: 0,
      },
    };
    if (extraMutate) extraMutate(state as unknown as Record<string, unknown>);
  });
  return runRoot;
}

export const reportingSuiteName = "status handoff and doctor";

let sharedRun: string;
let preplanRun: string;

describe(reportingSuiteName, () => {
  beforeAll(async () => {
    setupReportingSandbox();
    sharedRun = fixture();
    preplanRun = initRun(
      tempDir("harness-preplan-report"),
      "preplan-run",
      new TextEncoder().encode("Plan every instruction"),
      "file",
      true,
    );
    renderHandoff(sharedRun);
    runStatus(sharedRun);
  });

  afterAll(() => {
    cleanupReportingSandbox();
  });

  test("hands off an interrupted pre-plan capsule with recoverable planner argv", async () => {
    const run = preplanRun;

    const handoff = renderHandoff(run);
    expect(handoff).toContain("Graph revision: not-applied");
    expect(handoff).toContain(JSON.stringify(gateEvidence));
    expect(handoff).toContain("neither configures nor attests it");
    expect(runStatus(run).gate_evidence_limitations).toEqual(gateEvidenceLimitations);
    expect((await runDoctor(run)).gate_evidence_limitations).toEqual(gateEvidenceLimitations);
    const entrypoint = join(skillRoot, "scripts", "harness.ts");
    expect(handoff).toContain(JSON.stringify(["bun", entrypoint, "plan:status", "--run", run]));
    expect(handoff).toContain(JSON.stringify(["bun", entrypoint, "doctor", "--run", run]));
    expect(handoff).toContain(
      JSON.stringify([
        "bun",
        entrypoint,
        "plan:compile",
        "--run",
        run,
        "--actor",
        "<actor-for:plan:compile>",
        "--completion-gate",
        "<completion-gate-for:plan:compile>",
      ]),
    );

    const named = handoffArgv(handoff);
    expect(named.length).toBeGreaterThan(0);
    expect(dispatchFailures(named)).toEqual([]);

    expect(handoff).toContain("none");
    transact(run, "planner", "task-declared", {}, (state) => {
      state.planning = { tasks: [{ id: "task-1" }] };
    });
    expect(renderPreplanHandoff(loadRun(run), entrypoint)).toContain("| planner | task-declared");
  });

  test("renders deterministic resumable state and exact argv", () => {
    const run = sharedRun;
    const first = renderHandoff(run);
    const second = renderHandoff(run);
    expect(second).toBe(first);
    expect(first).toContain("source-verified");
    expect(first).toContain(JSON.stringify(gateEvidence));
    expect(first).toContain("Same-user mutate, execute, and restore");
    expect(first).toContain('"id":"task-1","status":"ready"');
    expect(first).toContain("## Requirements");
    expect(first).toContain("## Completion blockers");
    expect(first).toContain("requirement R-1 is not satisfied");
    const entrypoint = join(skillRoot, "scripts", "harness.ts");
    expect(first).toContain(JSON.stringify(["bun", entrypoint, "queue:wave", "--run", run]));
    expect(first).toContain(
      JSON.stringify([
        "bun",
        entrypoint,
        "task:claim",
        "--run",
        run,
        "--task",
        "task-1",
        "--agent",
        "<implementer-for:task-1>",
        "--role",
        "implementer",
      ]),
    );
    expect(dispatchFailures(handoffArgv(first))).toEqual([]);
    const path = writeHandoff(run);
    expect(path).toBe(join(run, "handoff.md"));
  });
});
