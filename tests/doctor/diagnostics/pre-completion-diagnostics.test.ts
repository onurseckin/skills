import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as doc from "../../../olt/scripts/src/reporting/doctor.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const preCompletionDiagnosticsSuiteName = "Pre-Completion Diagnostics & Guidance Engine";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession | null = null;

function setupVirtualFs(): void {
  vfs = new VirtualMemoryFS();
  vfs.mkdirSync(process.cwd(), { recursive: true });
  vfs.mkdirSync(join(process.cwd(), ".git"), { recursive: true });
  vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
  session = createVirtualFSSession(vfs);
}

afterEach(() => {
  session?.cleanup();
  session = null;
});

const initCapsule = (r: string, id: string, extra: Record<string, unknown> = {}) => {
  const root = join(r, ".olt", "capsules", id);
  vfs.mkdirSync(r, { recursive: true });
  vfs.mkdirSync(join(r, ".git"), { recursive: true });
  vfs.mkdirSync(root, { recursive: true });
  vfs.writeFileSync(join(root, "manifest.json"), `{"run_id":"${id}"}`);
  vfs.writeFileSync(join(root, "state.json"), JSON.stringify({ run_id: id, tasks: {}, ...extra }));
  vfs.writeFileSync(join(root, "events.jsonl"), '{"sequence":1,"type":"genesis"}\n');
  return { repoRoot: r, runRoot: root };
};

describe(preCompletionDiagnosticsSuiteName, () => {
  test("evaluates clean capsule with no blockers as ready for completion", () => {
    setupVirtualFs();
    const { repoRoot, runRoot } = initCapsule("/v/repo-clean", "clean-run");
    const res = doc.checkPreCompletionDiagnostics({ runRoot, repoRoot, autoHeal: false });
    expect(res.readyForCompletion && res.blockers.length === 0).toBe(true);
  });

  test("flags undispositioned orphan evidence as blocker", () => {
    setupVirtualFs();
    const { repoRoot, runRoot } = initCapsule("/v/repo-orphan", "orphan-run", {
      orphan_evidence: ["abc123sha"],
    });
    vfs.mkdirSync(join(runRoot, "evidence", "loose-dir"), { recursive: true });
    vfs.writeFileSync(join(runRoot, "evidence", "loose-dir", "output.txt"), "loose capture");
    const res = doc.checkPreCompletionDiagnostics({ runRoot, repoRoot, autoHeal: false });
    expect(
      !res.readyForCompletion &&
        Boolean(
          res.blockers
            .find((b) => b.code === "ORPHAN_EVIDENCE_UNDISPOSITIONED")
            ?.remedyCommand?.includes("evidence:disposition"),
        ),
    ).toBe(true);
  });

  test("flags pending completeness critic review as blocker", () => {
    setupVirtualFs();
    const state = {
      run_id: "critic-run",
      graph: { nodes: [], edges: [] },
      completion_critic: { critic_id: "critic-1", status: "assigned" },
    };
    const { repoRoot, runRoot } = initCapsule("/v/repo-critic", "critic-run", state);
    const res = doc.checkPreCompletionDiagnostics({ runRoot, repoRoot, state, autoHeal: false });
    expect(
      !res.readyForCompletion &&
        Boolean(
          res.blockers
            .find((b) => b.code === "CRITIC_REVIEW_PENDING")
            ?.remedyCommand?.includes("critic:review"),
        ),
    ).toBe(true);
  });

  test("auto-heals dangling locks during pre-completion check", () => {
    setupVirtualFs();
    const { repoRoot, runRoot } = initCapsule("/v/repo-locks", "lock-run");
    const locksDir = join(repoRoot, ".locks");
    vfs.mkdirSync(locksDir, { recursive: true });
    vfs.writeFileSync(
      join(locksDir, "dead-process.lock"),
      JSON.stringify({ pid: 99999999, created_at: new Date().toISOString() }),
    );
    const res = doc.checkPreCompletionDiagnostics({ runRoot, repoRoot, autoHeal: true });
    expect(
      res.autoHealedItems.some((i) => i.includes("Cleared dangling lock")) &&
        !vfs.existsSync(join(locksDir, "dead-process.lock")),
    ).toBe(true);
  });

  test("generateRemedialGuidance produces actions and summary", () => {
    const g = doc.generateRemedialGuidance({
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
    const keys = [
      "[STATE_PROJECTION]",
      "[UNAPPROVED_ROOT_FILE]",
      "[PUSHBACK_QUOTA_DEFICIT]",
      "[ORPHAN_EVIDENCE]",
    ];
    expect(
      g.remedialActions.length >= 4 &&
        keys.every((k) => g.guidanceSummary.some((s) => s.includes(k))),
    ).toBe(true);
  });

  test("formatDoctorReport renders remedial guidance section", () => {
    const rep = doc.formatDoctorReport({
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
    expect(
      rep.includes("### Pre-Completion Remedial Guidance:") &&
        rep.includes(
          "[STATE_PROJECTION] state.json mismatch -> Run: `bun harness.ts doctor:repair`",
        ),
    ).toBe(true);
  });

  test("runDoctor returns diagnostics, guidance, and actions", async () => {
    setupVirtualFs();
    const { repoRoot, runRoot } = initCapsule("/v/repo-full", "full-run");
    const rep = await doc.runDoctor(runRoot, { repoRoot, autoHeal: true });
    expect(
      Boolean(
        rep.pre_completion_diagnostics && rep.guidance && Array.isArray(rep.remedial_actions),
      ),
    ).toBe(true);
  });
});
