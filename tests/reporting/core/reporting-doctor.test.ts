import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";
import { runStatus } from "../../../olt/scripts/src/reporting/status.ts";
import { runStatusCommand } from "../../../olt/scripts/src/cli/commands/run-ops.ts";
import { renderHandoff } from "../../../olt/scripts/src/reporting/handoff.ts";
import { repositoryBinding, commandRecord } from "../../workflow/shared/test-port.ts";
import { orphanEvidenceSha256 } from "../../../olt/scripts/src/workflow/orphan-evidence/digest.ts";
import { generateLeasesReport } from "../../../olt/scripts/src/reporting/unified/index.ts";
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
  const dir = `/virtual/scratch/reporting-doc-${label}-${counter}`;
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
    "doctor-run",
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

export const reportingDoctorSuiteName = "status, doctor, and leases";

let sharedRun: string;
let statusRun: string;

describe(reportingDoctorSuiteName, () => {
  beforeAll(async () => {
    setupReportingSandbox();
    sharedRun = fixture();
    statusRun = fixture((state) => {
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks["task-1"]!.status = "leased";
      tasks["task-1"]!.lease = {
        agent_id: "worker-1",
        role: "implementer",
        token_digest: "b".repeat(64),
        attempt: 1,
        expires_at: "2026-08-13T12:20:00.000Z",
      };
    });
    runStatus(sharedRun);
    runStatusCommand({ run: sharedRun });
    await runDoctor(sharedRun);
  });

  afterAll(() => {
    cleanupReportingSandbox();
  });

  test("status exposes resumable workflow evidence and blockers without secrets", () => {
    const evidence = { task_id: "task-1", reason: "late report" };
    const run = fixture((state) => {
      state.orphan_evidence = [evidence];
      state.commands = (state.commands as Record<string, unknown>) ?? {};
      (state.commands as Record<string, unknown>)["C-GATE"] = {
        id: "C-GATE",
        task_id: "task-1",
        gate_id: "G-1",
        argv: ["bun", "test"],
        cwd: ".",
        cwd_relative: ".",
        repository_root: "/virtual",
        status: "succeeded",
        actor: "validator",
        started_at: "2026-08-13T12:00:00.000Z",
        finished_at: "2026-08-13T12:00:01.000Z",
        exit_code: 0,
        signal: null,
        timeout_kind: null,
        signals_sent: [],
        fingerprint: "fp",
        assurance: "trusted_host_observed_v1",
        repository_after: repositoryBinding,
      } as unknown as ReturnType<typeof commandRecord>;
    });
    const status = runStatus(run);
    expect(status.tasks).toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "ready",
        requirement_ids: ["R-1"],
        open_finding_ids: [],
      }),
    ]);
    expect(status.gate_evidence).toEqual(gateEvidence);
    expect(status.gate_evidence_limitations).toEqual(gateEvidenceLimitations);
    expect(status.commands).toContainEqual(
      expect.objectContaining({
        id: "C-GATE",
        assurance: "trusted_host_observed_v1",
        repository_after: repositoryBinding,
      }),
    );
    expect(status.orphan_evidence).toEqual([
      { orphan_sha256: orphanEvidenceSha256(evidence), evidence },
    ]);
    expect(
      status.completion_blockers.some((issue) => issue.includes("orphan evidence")),
    ).toBeTrue();
    expect(JSON.stringify(status)).not.toContain("token_digest");
    const handoff = renderHandoff(run);
    expect(handoff).toContain(orphanEvidenceSha256(evidence));
    expect(handoff).toContain("Packet files contain no bearer tokens");
    expect(handoff).toContain("--grace-seconds 0");
  });

  test("never exposes critic token digests in status or handoff", () => {
    const run = fixture((state) => {
      state.completion_critic = {
        critic_id: "critic",
        token_digest: "secret-digest",
        attempt: 1,
        status: "assigned",
        started_at: "2026-08-13T12:00:00.000Z",
        deadline_at: "2026-08-13T12:20:00.000Z",
        readiness_sha256: "a".repeat(64),
        repository_binding: structuredClone(repositoryBinding),
      };
    });
    expect(JSON.stringify(runStatus(run))).not.toContain("token_digest");
    expect(renderHandoff(run)).not.toContain("token_digest");
  });

  test("the run:status an agent actually invokes carries no lease token digest", () => {
    const run = statusRun;
    expect(JSON.stringify(runStatusCommand({ run }))).not.toContain("token_digest");
  });

  test("doctor reports integrity and workflow issues separately", async () => {
    const run = sharedRun;
    const report = await runDoctor(run);
    expect(report.gate_evidence).toEqual(gateEvidence);
    expect(report.gate_evidence_limitations).toEqual(gateEvidenceLimitations);
    expect(report.integrity_issues).toEqual([]);
    expect(report.workflow_issues).toContain("task task-1 is ready, not done");
    expect(report.packet_issues).toEqual([]);
    expect(report.healthy).toBeFalse();
  });

  test("doctor can include authoritative global installation drift", async () => {
    const run = sharedRun;
    const home = tempDir("harness-doctor-home");
    const report = await runDoctor(run, {
      installation: { source: skillRoot, home, clients: ["codex", "claude"] },
    });
    expect(report.installation).toMatchObject({ installed: false, drifted: true });
    expect(report.installation_issues).toContain("installation: not installed");
  });

  test("generateLeasesReport generates active lease matrix correctly", () => {
    const run = sharedRun;
    const result = generateLeasesReport(run);
    expect(result.matrix).toBeArray();
    expect(result.markdown).toContain("Active Leases Matrix");
  });
});
