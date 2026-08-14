import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { initRun, transact } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { runDoctor } from "../../orchestrating-long-tasks/scripts/src/reporting/doctor.ts";
import { renderHandoff, writeHandoff } from "../../orchestrating-long-tasks/scripts/src/reporting/handoff.ts";
import { runStatus } from "../../orchestrating-long-tasks/scripts/src/reporting/status.ts";
import { repositoryBinding } from "../workflow/test-port.ts";
import { orphanEvidenceSha256 } from "../../orchestrating-long-tasks/scripts/src/workflow/orphan-evidence/digest.ts";
import { commandRecord } from "../workflow/test-port.ts";

const roots: string[] = [];
const skillRoot = fileURLToPath(new URL("../../orchestrating-long-tasks", import.meta.url));
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
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), "harness-report-"));
  roots.push(repo);
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
  });
  return runRoot;
}

describe("status handoff and doctor", () => {
  test("hands off an interrupted pre-plan capsule with recoverable planner argv", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-preplan-report-"));
    roots.push(repo);
    const run = initRun(
      repo,
      "preplan-run",
      new TextEncoder().encode("Plan every instruction"),
      "file",
      true,
    );

    const handoff = renderHandoff(run);
    expect(handoff).toContain("Graph revision: not-applied");
    expect(handoff).toContain(JSON.stringify(gateEvidence));
    expect(handoff).toContain("neither configures nor attests it");
    expect(runStatus(run).gate_evidence_limitations).toEqual(gateEvidenceLimitations);
    expect((await runDoctor(run)).gate_evidence_limitations).toEqual(gateEvidenceLimitations);
    expect(handoff).toContain('"packet"');
    expect(handoff).toContain('"planner-0"');
    expect(handoff).toContain('"--expected-revision","0"');
  });

  test("renders deterministic resumable state and exact argv", async () => {
    const run = await fixture();
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
    expect(first).toContain(
      JSON.stringify([
        "bun",
        join(run, "runtime", "harness.ts"),
        "ready",
        "--run",
        run,
        "--max-parallel",
        "1",
      ]),
    );
    const path = writeHandoff(run);
    expect(path).toBe(join(run, "handoff.md"));
  });

  test("status exposes resumable workflow evidence and blockers without secrets", async () => {
    const run = await fixture();
    transact(run, "coordinator", "orphan-recorded", {}, (state) => {
      state.orphan_evidence = [{ task_id: "task-1", reason: "late report" }];
      state.commands ??= {};
      state.commands["C-GATE"] = commandRecord("C-GATE", {
        task_id: "task-1",
        gate_id: "G-1",
      });
    });
    const status = runStatus(run);
    const evidence = { task_id: "task-1", reason: "late report" };
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

  test("never exposes critic token digests in status or handoff", async () => {
    const run = await fixture();
    transact(run, "coordinator", "critic-fixture", {}, (state) => {
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

  test("doctor reports integrity and pinned-runtime availability separately", async () => {
    const run = await fixture();
    const report = await runDoctor(run);
    expect(report.gate_evidence).toEqual(gateEvidence);
    expect(report.gate_evidence_limitations).toEqual(gateEvidenceLimitations);
    expect(report.integrity_issues).toEqual([]);
    expect(report.runtime_pinned).toBeFalse();
    expect(report.workflow_issues).toContain("task task-1 is ready, not done");
    expect(report.packet_issues).toEqual([]);
    expect(report.healthy).toBeFalse();
  });

  test("doctor can include authoritative global installation drift", async () => {
    const run = await fixture();
    const home = await mkdtemp(join(tmpdir(), "harness-doctor-home-"));
    roots.push(home);
    const report = await runDoctor(run, {
      installation: { source: skillRoot, home, clients: ["codex", "claude"] },
    });
    expect(report.installation).toMatchObject({ installed: false, drifted: true });
    expect(report.installation_issues).toContain("installation: not installed");
  });
});
