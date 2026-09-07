import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkPreCompletionDiagnostics } from "../../../olt/scripts/src/reporting/doctor/pre-completion.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

describe("checkPreCompletionDiagnostics", () => {
  let vfs: ReturnType<typeof setupVirtualReportingFS>;

  beforeEach(() => {
    vfs = setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  test("evaluates clean compliant run state with default autoHeal and custom repoRoot", () => {
    const repo = tempDir("pre-comp-clean");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.writeFileSync(join(repo, "package.json"), "{}");
    const runRoot = join(repo, ".olt", "capsules", "run-clean");
    vfs.mkdirSync(runRoot, { recursive: true });

    const result = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state: {},
      autoHeal: false,
    });

    expect(result.readyForCompletion).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
    expect(result.autoHealedItems).toEqual([]);
    expect(result.remedialGuidance).toBeDefined();
    expect(result.remedialActions).toBeDefined();
  });

  test("resolves state from state.json file, handles corrupt state.json, and handles fallback repoRoot", () => {
    const repo = tempDir("pre-comp-state-json");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.writeFileSync(join(repo, "package.json"), "{}");
    const runRoot = join(repo, ".olt", "capsules", "run-disk");
    vfs.mkdirSync(runRoot, { recursive: true });

    // Missing state.json
    const noStateRes = checkPreCompletionDiagnostics({ runRoot, repoRoot: repo, autoHeal: false });
    expect(noStateRes.readyForCompletion).toBe(true);

    // Corrupt state.json
    vfs.writeFileSync(join(runRoot, "state.json"), "invalid json {");
    const corruptStateRes = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      autoHeal: false,
    });
    expect(corruptStateRes.readyForCompletion).toBe(true);

    // Fallback repoRoot resolution (when repoRoot is omitted)
    const fallbackRes = checkPreCompletionDiagnostics({ runRoot, autoHeal: false });
    expect(fallbackRes).toBeDefined();

    // Valid state.json on disk
    vfs.writeFileSync(
      join(runRoot, "state.json"),
      JSON.stringify({
        completion_critic: { status: "expired" },
      }),
    );
    const validDiskRes = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      autoHeal: false,
    });
    expect(validDiskRes.readyForCompletion).toBe(false);
    expect(validDiskRes.blockers.some((b) => b.code === "CRITIC_REVIEW_REQUIRED")).toBe(true);
  });

  test("runs auto-healing routines for git index lock, dangling locks, worktrees, and mailboxes", () => {
    const repo = tempDir("pre-comp-heal");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.writeFileSync(join(repo, "package.json"), "{}");
    vfs.mkdirSync(join(repo, ".olt", "locks"), { recursive: true });
    vfs.mkdirSync(join(repo, ".olt", "mailboxes", "agent-1"), { recursive: true });
    vfs.mkdirSync(join(repo, ".olt", "worktrees", "locks"), { recursive: true });

    // Dead PID in index.lock
    vfs.writeFileSync(join(repo, ".git", "index.lock"), "99999999");
    // Dead PID in dangling lock
    vfs.writeFileSync(
      join(repo, ".olt", "locks", "stale.lock"),
      JSON.stringify({ pid: 99999999, expiresAt: Date.now() - 10000 }),
    );
    // Corrupt cursor for mailbox
    vfs.writeFileSync(join(repo, ".olt", "mailboxes", "agent-1", "cursor.json"), "corrupt {");
    vfs.writeFileSync(join(repo, ".olt", "mailboxes", "agent-1", "inbox.jsonl"), "");
    // Orphan lock in worktrees
    vfs.writeFileSync(
      join(repo, ".olt", "worktrees", "locks", "track-orphan.lock"),
      JSON.stringify({ pid: 99999999, trackId: "track-orphan" }),
    );

    const runRoot = join(repo, ".olt", "capsules", "run-heal");
    vfs.mkdirSync(runRoot, { recursive: true });

    const result = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state: {},
      autoHeal: true,
    });

    expect(result.autoHealedItems.some((item) => item.includes("index.lock"))).toBe(true);
    expect(result.autoHealedItems.some((item) => item.includes("Cleared dangling lock"))).toBe(
      true,
    );
    expect(result.autoHealedItems.some((item) => item.includes("Rebuilt corrupted cursor"))).toBe(
      true,
    );
    expect(result.autoHealedItems.some((item) => item.includes("track-orphan"))).toBe(true);

    // Hardened state verification: confirm physical unlinking / state mutability in RAM
    expect(vfs.existsSync(join(repo, ".git", "index.lock"))).toBe(false);
    expect(vfs.existsSync(join(repo, ".olt", "locks", "stale.lock"))).toBe(false);
    expect(vfs.existsSync(join(repo, ".olt", "worktrees", "locks", "track-orphan.lock"))).toBe(
      false,
    );
  });

  test("flags undispositioned orphan evidence for strings and objects", () => {
    const repo = tempDir("pre-comp-orphan");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.writeFileSync(join(repo, "package.json"), "{}");
    const runRoot = join(repo, ".olt", "capsules", "run-1");
    vfs.mkdirSync(runRoot, { recursive: true });

    const state = {
      orphan_evidence: [
        "sha-undisposed-1",
        { orphan_sha256: "sha-undisposed-2" },
        { orphan_sha256: "sha-disposed" },
      ],
      orphan_evidence_dispositions: [{ orphan_sha256: "sha-disposed" }],
    };

    const result = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state,
      autoHeal: false,
    });

    const orphanBlockers = result.blockers.filter(
      (b) => b.code === "ORPHAN_EVIDENCE_UNDISPOSITIONED",
    );
    expect(orphanBlockers).toHaveLength(2);
    expect(orphanBlockers[0]?.category).toBe("EVIDENCE");
    expect(orphanBlockers[0]?.remedyCommand).toContain("evidence:disposition");
  });

  test("flags completion critic statuses (expired, assigned, packet_published)", () => {
    const repo = tempDir("pre-comp-critic");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.writeFileSync(join(repo, "package.json"), "{}");
    const runRoot = join(repo, ".olt", "capsules", "run-critic");
    vfs.mkdirSync(runRoot, { recursive: true });

    // Expired critic
    const resExpired = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state: { completion_critic: { status: "expired" } },
      autoHeal: false,
    });
    expect(resExpired.blockers.some((b) => b.code === "CRITIC_REVIEW_REQUIRED")).toBe(true);

    // Assigned critic
    const resAssigned = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state: { completion_critic: { status: "assigned", critic_id: "critic-alpha" } },
      autoHeal: false,
    });
    const assignedBlocker = resAssigned.blockers.find((b) => b.code === "CRITIC_REVIEW_PENDING");
    expect(assignedBlocker?.message).toContain("critic-alpha");

    // Packet published without critic_id (defaults to unknown-critic)
    const resPacket = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state: { completion_critic: { status: "packet_published" } },
      autoHeal: false,
    });
    const packetBlocker = resPacket.blockers.find((b) => b.code === "CRITIC_REVIEW_PENDING");
    expect(packetBlocker?.message).toContain("unknown-critic");

    // Compliant status
    const resApproved = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state: { completion_critic: { status: "approved" } },
      autoHeal: false,
    });
    expect(resApproved.blockers.filter((b) => b.category === "CRITIC")).toHaveLength(0);
  });

  test("flags unaddressed findings, quotas, hygiene, git, and worktree blockers", () => {
    const repo = tempDir("pre-comp-findings");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.writeFileSync(join(repo, "package.json"), "{}");
    const runRoot = join(repo, ".olt", "capsules", "run-f");
    vfs.mkdirSync(runRoot, { recursive: true });

    const rUn = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state: { completion_review: { status: "findings", review_sha256: "s1" } },
      autoHeal: false,
    });
    expect(rUn.blockers.some((b) => b.code === "CRITIC_FINDINGS_UNADDRESSED")).toBe(true);

    const rRem = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state: {
        completion_review: { status: "findings", review_sha256: "s1" },
        completion_remediations: [{ review_sha256: "s1" }],
      },
      autoHeal: false,
    });
    expect(rRem.blockers.filter((b) => b.code === "CRITIC_FINDINGS_UNADDRESSED")).toHaveLength(0);

    vfs.writeFileSync(join(repo, "temp_loose.sh"), "#!/bin/bash");
    vfs.writeFileSync(join(repo, ".git", "index.lock"), "99999999");
    const rHygiene = checkPreCompletionDiagnostics({
      runRoot,
      repoRoot: repo,
      state: { tasks: { t1: { id: "t1", status: "completed" } } },
      autoHeal: false,
    });
    expect(
      rHygiene.blockers.some(
        (b) => b.category === "HYGIENE" || b.category === "QUOTA" || b.category === "GIT",
      ),
    ).toBe(true);
  });
});
