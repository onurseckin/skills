import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { whoamiCommand } from "../../../../olt/scripts/src/cli/commands/whoami.ts";
import { dagViewCommand } from "../../../../olt/scripts/src/cli/commands/dag-view.ts";
import {
  findingGetCommand,
  reportGetCommand,
  evidenceGetCommand,
  evidenceScreenshotsCommand,
} from "../../../../olt/scripts/src/cli/commands/inspection-ops.ts";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import { assertRoleMayInvoke } from "../../../../olt/scripts/src/packets/command-authority.ts";
import { loadRoleContract } from "../../../../olt/scripts/src/packets/role-contract.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

const vfs = new VirtualMemoryFS();
const session = createVirtualFSSession(vfs);

afterAll(() => {
  session.cleanup();
  vfs.reset();
});

async function fixtureCapsuleRun() {
  const root = `/virtual/cli-query-${Math.random().toString(36).slice(2)}`;
  const repo = join(root, "repo");
  vfs.mkdirSync(repo, { recursive: true });
  const run = initRun(
    repo,
    "query-run",
    new TextEncoder().encode("Implement multi-viewport responsive UI"),
    "file",
    true,
  );
  return { root, repo, run };
}

describe("CLI Query Integration - Query Execution", () => {
  describe("On-Demand Memory Retrieval Commands", () => {
    test("whoamiCommand identifies execution context, active grants, and held leases", async () => {
      const { run } = await fixtureCapsuleRun();

      transact(run, "test-actor", "seed-grants-leases", {}, (draft) => {
        draft.agents = [
          {
            id: "impl-1",
            role: "implementer",
            status: "active",
            parent_agent_id: null,
            parent_task_id: null,
            host: "antigravity",
            granted_at: "2026-08-13T12:00:00.000Z",
          },
        ];
        draft.tasks = {
          "T-1": {
            id: "T-1",
            status: "leased",
            requirement_ids: ["R-1"],
            write_scope: ["src/ui/layout.tsx"],
            dependencies: [],
            attempts: [],
            history: [],
            repair_round: 0,
            lease: {
              agent_id: "impl-1",
              role: "implementer",
              attempt: 1,
              token_digest: "token-digest-1",
              acquired_at: "2026-08-13T12:00:00.000Z",
              expires_at: "2026-08-13T12:30:00.000Z",
            },
          },
        };
      });

      const result = whoamiCommand({ run, agent: "impl-1", role: "implementer" });
      expect(result.run_root).toBe(run);
      expect(result.agent_id).toBe("impl-1");
      expect(result.role).toBe("implementer");
      expect(typeof result.markdown).toBe("string");
      expect(result.markdown).toContain("Thread Authority Identification (`whoami`)");
      expect(result.markdown).toContain("Active Agent");
      expect(result.markdown).toContain("Held Tasks");
      expect((result.active_leases as unknown[]).length).toBe(1);
      expect((result.active_grants as unknown[]).length).toBe(1);
    });

    test("dag:view queries compiled DAG memory and computes wave metrics and recommendations", async () => {
      const { run, repo } = await fixtureCapsuleRun();

      transact(run, "test-actor", "seed-dag-tasks", {}, (draft) => {
        draft.graph = {
          revision: 1,
          gates: [
            {
              id: "G-1",
              command: ["bun", "test"],
              cwd: ".",
              scope: "task",
              requirement_ids: ["R-1"],
              mandatory: true,
            },
          ],
        };
        draft.tasks = {
          "T-1": {
            id: "T-1",
            label: "Schema Foundation",
            status: "complete",
            requirement_ids: ["R-1"],
            write_scope: ["src/schema.ts"],
            dependencies: [],
            attempts: [],
            history: [],
            repair_round: 0,
            gate: "bun test schema",
          },
          "T-2": {
            id: "T-2",
            label: "UI Component Layout",
            status: "ready",
            requirement_ids: ["R-2"],
            write_scope: ["src/ui/layout.tsx"],
            dependencies: ["T-1"],
            attempts: [],
            history: [],
            repair_round: 0,
            gate: "bun test layout",
          },
          "T-3": {
            id: "T-3",
            label: "Theme & Styles",
            status: "ready",
            requirement_ids: ["R-3"],
            write_scope: ["src/ui/theme.css"],
            dependencies: ["T-1"],
            attempts: [],
            history: [],
            repair_round: 0,
            gate: "bun test theme",
          },
        };
      });

      const dagResult = dagViewCommand({ run, repo });
      expect(dagResult.run_root).toBe(run);
      expect(dagResult.is_compiled).toBe(true);
      expect(dagResult.graph_revision).toBe(1);
      expect(dagResult.total_tasks).toBe(3);
      expect(typeof dagResult.markdown).toBe("string");
      expect(dagResult.markdown).toContain("Live DAG Execution");
      expect(dagResult.markdown).toContain("Live ASCII DAG Trace");

      const waves = dagResult.waves as { wave: number; taskIds: string[] }[];
      expect(waves.length).toBeGreaterThanOrEqual(2);
      expect(waves[0]!.taskIds).toContain("T-1");
      expect(waves[1]!.taskIds).toContain("T-2");
      expect(waves[1]!.taskIds).toContain("T-3");

      const metrics = dagResult.metrics as { criticalPathLength: number };
      expect(metrics.criticalPathLength).toBe(2);
    });

    test("finding:get queries recorded findings from capsule memory", async () => {
      const { run } = await fixtureCapsuleRun();

      transact(run, "val-1", "record-findings", {}, (draft) => {
        draft.tasks = {
          "T-1": {
            id: "T-1",
            status: "changes_requested",
            requirement_ids: ["R-1"],
            write_scope: ["src/ui/responsive.tsx"],
            dependencies: [],
            attempts: [],
            history: [],
            repair_round: 1,
            findings: [
              {
                id: "UI-VIEWPORT-001",
                requirement_id: "R-1",
                severity: "critical",
                observation: "Desktop-Wide 1920x1080 viewport grid overflow detected",
                evidence: [{ path: "evidence/screenshots/desktop-wide-overflow.png" }],
                remediation: "Add max-width container rule",
                revalidation: "bun test viewport",
                status: "open",
              },
            ],
          },
        };
      });

      // Query all findings
      const allFindings = findingGetCommand({ run });
      expect(allFindings.count).toBe(1);
      expect(typeof allFindings.markdown).toBe("string");
      expect(allFindings.markdown).toContain("UI-VIEWPORT-001");

      // Query specific finding by ID
      const singleFinding = findingGetCommand({ run, id: "UI-VIEWPORT-001" });
      expect(singleFinding.id).toBe("UI-VIEWPORT-001");
      expect((singleFinding.finding as Record<string, unknown>).observation).toBe(
        "Desktop-Wide 1920x1080 viewport grid overflow detected",
      );
    });

    test("report:get queries task submission and review reports from disk", async () => {
      const { run } = await fixtureCapsuleRun();
      const reportsDir = join(run, "reports");
      vfs.mkdirSync(reportsDir, { recursive: true });

      const submissionReport = {
        summary: "Implemented responsive 4-tier viewport grid",
        requirement_ids: ["R-1"],
        files_changed: ["src/ui/responsive.tsx"],
        checks: [{ command_id: "C-TEST-1" }],
        evidence: [{ path: "evidence/bundle.json" }],
      };

      const reviewReport = {
        verdict: "pass",
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-VAL-1" }],
        findings: [],
        resolved_findings: [],
      };

      vfs.writeFileSync(join(reportsDir, "T-1-submission.json"), JSON.stringify(submissionReport));
      vfs.writeFileSync(join(reportsDir, "T-1-review.json"), JSON.stringify(reviewReport));

      // Query review report
      const reviewResult = reportGetCommand({ run, task: "T-1", review: true });
      expect(reviewResult.report).toEqual(reviewReport);
      expect(typeof reviewResult.markdown).toBe("string");

      // Query submission report
      const submissionResult = reportGetCommand({ run, task: "T-1", submission: true });
      expect(submissionResult.report).toEqual(submissionReport);

      // Query all reports
      const allReports = reportGetCommand({ run });
      expect(allReports.count).toBe(2);
    });

    test("evidence:get and evidence:screenshots query command execution & screenshot records", async () => {
      const { run, repo } = await fixtureCapsuleRun();

      transact(run, "test-actor", "seed-commands", {}, (draft) => {
        draft.commands = {
          "C-CMD-1": {
            id: "C-CMD-1",
            argv: ["bun", "test", "tests/ui.test.ts"],
            cwd: repo,
            cwd_relative: ".",
            repository_root: repo,
            status: "succeeded",
            task_id: "T-1",
            gate_id: "G-1",
            actor: "val-agent",
            started_at: "2026-08-13T12:00:00.000Z",
            finished_at: "2026-08-13T12:00:01.000Z",
            exit_code: 0,
            policy: { wall_timeout_ms: 60000, max_output_bytes: 1000000 },
            logs: {
              stdout: { path: "commands/C-CMD-1/attempts/1/stdout.log", bytes: 10, sha256: "abc" },
              stderr: { path: "commands/C-CMD-1/attempts/1/stderr.log", bytes: 0, sha256: "def" },
            },
            assurance: "trusted_host_observed_v1",
            attempts: [],
          },
        };
      });

      const evidenceResult = evidenceGetCommand({ run, command: "C-CMD-1" });
      expect(evidenceResult.command_id).toBe("C-CMD-1");
      expect(typeof evidenceResult.markdown).toBe("string");
      expect(evidenceResult.markdown).toContain("C-CMD-1");

      const screenshotsResult = evidenceScreenshotsCommand({ run, task: "T-1" });
      expect(screenshotsResult.run_root).toBe(run);
      expect(Array.isArray(screenshotsResult.screenshots)).toBe(true);
    });
  });
});
