import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { safeRmSync } from "../../olt/scripts/src/core/shared/safe-fs/index.ts";
import {
  checkPreCompletionDiagnostics,
  generateRemedialGuidance,
  formatDoctorReport,
  runDoctor,
} from "../../olt/scripts/src/reporting/doctor.ts";

describe("Pre-Completion Diagnostics & Guidance Engine", () => {
  let scratchDir: string;
  let runRoot: string;

  beforeEach(() => {
    scratchDir = join(
      tmpdir(),
      `doctor-precompletion-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runRoot = join(scratchDir, ".olt", "capsules", "test-run");
    mkdirSync(runRoot, { recursive: true });
    mkdirSync(join(scratchDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(scratchDir)) {
      safeRmSync(scratchDir, {
        allowedRoots: [tmpdir()],
        allowGitRepositoryDeletion: true,
        missingOk: true,
      });
    }
  });

  test("evaluates a clean capsule with no blockers as ready for completion", () => {
    const manifest = {
      run_id: "test-run",
      created_at: new Date().toISOString(),
    };
    const state = {
      run_id: "test-run",
      status: "active",
      tasks: {},
      grants: [],
      commands: {},
    };
    writeFileSync(join(runRoot, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(runRoot, "state.json"), JSON.stringify(state));
    writeFileSync(
      join(runRoot, "events.jsonl"),
      JSON.stringify({ sequence: 1, type: "genesis" }) + "\n",
    );

    const result = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: scratchDir,
      state,
      autoHeal: true,
    });

    expect(result.readyForCompletion).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.remedialGuidance).toBeDefined();
  });

  test("flags undispositioned orphan evidence as pre-completion blocker and provides guidance", () => {
    const state = {
      run_id: "test-run",
      graph: { nodes: [], edges: [] },
      orphan_evidence: [{ orphan_sha256: "abc123orphan" }],
      orphan_evidence_dispositions: [],
    };
    writeFileSync(join(runRoot, "manifest.json"), JSON.stringify({ run_id: "test-run" }));
    writeFileSync(join(runRoot, "state.json"), JSON.stringify(state));
    writeFileSync(
      join(runRoot, "events.jsonl"),
      JSON.stringify({ sequence: 1, type: "genesis" }) + "\n",
    );

    const result = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: scratchDir,
      state,
      autoHeal: false,
    });

    expect(result.readyForCompletion).toBe(false);
    const orphanBlocker = result.blockers.find((b) => b.code === "ORPHAN_EVIDENCE_UNDISPOSITIONED");
    expect(orphanBlocker).toBeDefined();
    expect(orphanBlocker?.remedyCommand).toContain("evidence:disposition");
  });

  test("flags pending completeness critic review as pre-completion blocker", () => {
    const state = {
      run_id: "test-run",
      graph: { nodes: [], edges: [] },
      completion_critic: { critic_id: "critic-1", status: "assigned" },
    };
    writeFileSync(join(runRoot, "manifest.json"), JSON.stringify({ run_id: "test-run" }));
    writeFileSync(join(runRoot, "state.json"), JSON.stringify(state));
    writeFileSync(
      join(runRoot, "events.jsonl"),
      JSON.stringify({ sequence: 1, type: "genesis" }) + "\n",
    );

    const result = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: scratchDir,
      state,
      autoHeal: false,
    });

    expect(result.readyForCompletion).toBe(false);
    const criticBlocker = result.blockers.find((b) => b.code === "CRITIC_REVIEW_PENDING");
    expect(criticBlocker).toBeDefined();
    expect(criticBlocker?.remedyCommand).toContain("critic:review");
  });

  test("auto-heals dangling locks and reports repaired items during pre-completion check", () => {
    const locksDir = join(scratchDir, ".locks");
    mkdirSync(locksDir, { recursive: true });
    writeFileSync(
      join(locksDir, "dead-process.lock"),
      JSON.stringify({ pid: 99999999, created_at: new Date().toISOString() }),
    );

    const state = { run_id: "test-run", tasks: {} };
    writeFileSync(join(runRoot, "manifest.json"), JSON.stringify({ run_id: "test-run" }));
    writeFileSync(join(runRoot, "state.json"), JSON.stringify(state));
    writeFileSync(
      join(runRoot, "events.jsonl"),
      JSON.stringify({ sequence: 1, type: "genesis" }) + "\n",
    );

    const result = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: scratchDir,
      state,
      autoHeal: true,
    });

    expect(result.autoHealedItems.some((item) => item.includes("Cleared dangling lock"))).toBe(
      true,
    );
    expect(existsSync(join(locksDir, "dead-process.lock"))).toBe(false);
  });

  test("generateRemedialGuidance produces structured actions and summary strings", () => {
    const guidance = generateRemedialGuidance({
      runRoot: "/test/run",
      integrityIssues: [{ code: "STATE_PROJECTION", message: "Projection mismatch" }],
      findings: [
        {
          code: "UNAPPROVED_ROOT_FILE",
          severity: "ERROR",
          engine: "checkRepositoryHygiene",
          message: "Root file unapproved: scratch.ts",
        },
        {
          code: "PUSHBACK_QUOTA_DEFICIT",
          severity: "ERROR",
          engine: "checkPushbackQuotas",
          message: "Task deficit: 2/5 pushbacks",
        },
      ],
      orphanEvidence: ["orphan-sha-999"],
    });

    expect(guidance.remedialActions.length).toBeGreaterThanOrEqual(4);
    expect(guidance.guidanceSummary.some((g) => g.includes("[STATE_PROJECTION]"))).toBe(true);
    expect(guidance.guidanceSummary.some((g) => g.includes("[UNAPPROVED_ROOT_FILE]"))).toBe(true);
    expect(guidance.guidanceSummary.some((g) => g.includes("[PUSHBACK_QUOTA_DEFICIT]"))).toBe(true);
    expect(guidance.guidanceSummary.some((g) => g.includes("[ORPHAN_EVIDENCE]"))).toBe(true);
  });

  test("formatDoctorReport renders pre-completion remedial guidance section when provided", () => {
    const report = formatDoctorReport({
      runRoot: "/test/run",
      healthy: false,
      bunVersion: "1.2.0",
      bunSupported: true,
      gitignored: true,
      issues: ["STATE_PROJECTION: Mismatch"],
      remedialGuidance: [
        "[STATE_PROJECTION] state.json mismatch -> Run: `bun harness.ts doctor:repair`",
      ],
    });

    expect(report).toContain("### Pre-Completion Remedial Guidance:");
    expect(report).toContain(
      "[STATE_PROJECTION] state.json mismatch -> Run: `bun harness.ts doctor:repair`",
    );
  });

  test("runDoctor returns pre_completion_diagnostics, guidance, and remedial_actions in payload", async () => {
    writeFileSync(join(runRoot, "manifest.json"), JSON.stringify({ run_id: "test-run" }));
    writeFileSync(join(runRoot, "state.json"), JSON.stringify({ run_id: "test-run" }));
    writeFileSync(
      join(runRoot, "events.jsonl"),
      JSON.stringify({ sequence: 1, type: "genesis" }) + "\n",
    );

    const report = await runDoctor(runRoot, { repoRoot: scratchDir, autoHeal: true });

    expect(report.pre_completion_diagnostics).toBeDefined();
    expect(report.guidance).toBeDefined();
    expect(Array.isArray(report.remedial_actions)).toBe(true);
  });
});
