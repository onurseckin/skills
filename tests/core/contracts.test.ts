import { describe, expect, it } from "bun:test";
import {
  isThinkingLevel,
  isAgentModelTier,
  isAgentToolRef,
  isTelemetryFieldConflict,
  isAgentGrantRecord,
  THINKING_LEVELS,
  AGENT_MODEL_TIERS,
} from "../../../olt/scripts/src/core/contracts/agents/agents.ts";
import {
  isValidatorDomain,
  textSignalsUiDomain,
  applicableValidatorDomains,
  uiDomainApplies,
  isCoordinatorPushbackCause,
  isMicroCycleRecord,
  isStructuredFinding,
  isCoordinatorPushback,
  VALIDATOR_DOMAINS,
} from "../../../olt/scripts/src/core/contracts/agents/workflow.ts";
import {
  isBranchStatus,
  isBranchSubTaskStatus,
  isBranchLease,
  isBranchSubTask,
  isBranchRecord,
  isSubTaskTerminal,
  isBranchOpen,
  BRANCH_STATUSES,
  BRANCH_SUB_TASK_STATUSES,
  TERMINAL_SUB_TASK_STATUSES,
} from "../../../olt/scripts/src/core/contracts/git/branch.ts";
import {
  isWorktreeConsolidationRecord,
  isWorktreeLedgerState,
} from "../../../olt/scripts/src/core/contracts/git/worktree.ts";
import { isJsonObject, isSafeInteger } from "../../../olt/scripts/src/core/contracts/json.ts";
import {
  isAgentRole,
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  AGENT_ROLES,
} from "../../../olt/scripts/src/core/contracts/network/packets.ts";
import {
  trustedHostEvidence,
  trustedHostLimitations,
  sameTrustedHostRepositoryBinding,
  TRUSTED_HOST_ASSURANCE,
} from "../../../olt/scripts/src/core/contracts/network/trusted-host.ts";
import {
  isEvidenceClass,
  isEvidenced,
  evidenced,
  estimated,
  EVIDENCE_CLASSES,
} from "../../../olt/scripts/src/core/contracts/system/evidence.ts";
import {
  isKnownToolCategory,
  isToolCategory,
  isCategoryExtras,
  TOOL_CATEGORIES,
} from "../../../olt/scripts/src/core/contracts/system/taxonomy.ts";
import {
  isTopologyReason,
  isTopologyWave,
  isTopologyDecision,
  isTopologyRecord,
  readTopology,
  topologyWavesByTask,
  TOPOLOGY_REASONS,
} from "../../../olt/scripts/src/core/contracts/system/topology.ts";

describe("core/contracts/json.ts", () => {
  it("validates json objects and integers", () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject("str")).toBe(false);
    expect(isJsonObject(123)).toBe(false);

    expect(isSafeInteger(5)).toBe(true);
    expect(isSafeInteger(0)).toBe(true);
    expect(isSafeInteger(5.5)).toBe(false);
    expect(isSafeInteger("5")).toBe(false);
    expect(isSafeInteger(NaN)).toBe(false);
    expect(isSafeInteger(Infinity)).toBe(false);
  });
});

describe("core/contracts/system/evidence.ts", () => {
  it("validates evidence classes and evidenced objects", () => {
    for (const c of EVIDENCE_CLASSES) {
      expect(isEvidenceClass(c)).toBe(true);
    }
    expect(isEvidenceClass("invalid")).toBe(false);
    expect(isEvidenceClass(null)).toBe(false);

    const ev = evidenced(42, "harness_observed");
    expect(ev).toEqual({ value: 42, evidence_class: "harness_observed" });
    expect(isEvidenced(ev, isSafeInteger)).toBe(true);

    const est = estimated("text");
    expect(est).toEqual({ value: "text", evidence_class: "derived", is_estimated: true });
    expect(isEvidenced(est, (v): v is string => typeof v === "string")).toBe(true);

    expect(isEvidenced(null, isSafeInteger)).toBe(false);
    expect(isEvidenced([], isSafeInteger)).toBe(false);
    expect(isEvidenced({ value: 42, evidence_class: "invalid" }, isSafeInteger)).toBe(false);
    expect(
      isEvidenced(
        { value: 42, evidence_class: "harness_observed", is_estimated: "yes" },
        isSafeInteger,
      ),
    ).toBe(false);
    expect(
      isEvidenced({ value: "not_int", evidence_class: "harness_observed" }, isSafeInteger),
    ).toBe(false);
  });
});

describe("core/contracts/system/taxonomy.ts", () => {
  it("validates tool categories and extras", () => {
    for (const cat of TOOL_CATEGORIES) {
      expect(isKnownToolCategory(cat)).toBe(true);
      expect(isToolCategory(cat)).toBe(true);
    }
    expect(isKnownToolCategory("custom-cat")).toBe(false);
    expect(isToolCategory("custom-cat")).toBe(true);
    expect(isToolCategory("   ")).toBe(false);
    expect(isToolCategory(123)).toBe(false);

    expect(isCategoryExtras({})).toBe(true);
    expect(isCategoryExtras({ timeout: 5000 })).toBe(true);
    expect(isCategoryExtras("invalid")).toBe(false);
  });
});

describe("core/contracts/system/topology.ts", () => {
  it("validates topology reasons, waves, decisions, and records", () => {
    for (const r of TOPOLOGY_REASONS) {
      expect(isTopologyReason(r)).toBe(true);
    }
    expect(isTopologyReason("other")).toBe(false);

    const wave = { wave: 1, task_ids: ["t1", "t2"] };
    expect(isTopologyWave(wave)).toBe(true);
    expect(isTopologyWave({ wave: "1", task_ids: [] })).toBe(false);
    expect(isTopologyWave({ wave: 1, task_ids: [123] })).toBe(false);

    const decision = {
      task_id: "t1",
      wave: 1,
      parallel_with: ["t2"],
      serialized_after: [],
      reason: "dependency" as const,
      rationale: "requires t0",
      evidence_class: "harness_observed" as const,
    };
    expect(isTopologyDecision(decision)).toBe(true);
    expect(isTopologyDecision({ ...decision, reason: "bad_reason" })).toBe(false);
    expect(isTopologyDecision({ ...decision, task_id: 123 })).toBe(false);

    const record = {
      revision: 1,
      waves: [wave],
      decisions: [decision],
      max_parallel: 4,
    };
    expect(isTopologyRecord(record)).toBe(true);
    expect(isTopologyRecord(null)).toBe(false);
    expect(isTopologyRecord({ ...record, revision: "1" })).toBe(false);

    expect(readTopology({ topology: record })).toEqual(record);
    expect(readTopology({ topology: null })).toBeNull();
    expect(readTopology("invalid")).toBeNull();

    const wavesMap = topologyWavesByTask(record);
    expect(wavesMap.get("t1")).toBe(1);
    expect(wavesMap.get("t2")).toBe(1);
  });
});

describe("core/contracts/network/packets.ts", () => {
  it("validates agent roles and validator predicates", () => {
    for (const role of AGENT_ROLES) {
      expect(isAgentRole(role)).toBe(true);
    }
    expect(isAgentRole("invalid-role")).toBe(false);
    expect(isAgentRole(null)).toBe(false);

    expect(isCognitiveValidatorRole("validator")).toBe(true);
    expect(isCognitiveValidatorRole("ui-validator")).toBe(true);
    expect(isCognitiveValidatorRole("validator-security")).toBe(true);
    expect(isCognitiveValidatorRole("implementer")).toBe(false);

    expect(isMechanicValidatorRole("mechanic-validator")).toBe(true);
    expect(isMechanicValidatorRole("ui-mechanic-validator")).toBe(true);
    expect(isMechanicValidatorRole("mechanic_validator")).toBe(true);
    expect(isMechanicValidatorRole("planner")).toBe(false);
  });
});

describe("core/contracts/network/trusted-host.ts", () => {
  it("provides trusted host assurance and repository binding equality", () => {
    const evidence = trustedHostEvidence();
    expect(evidence.assurance).toBe(TRUSTED_HOST_ASSURANCE);
    expect(evidence.sandboxed).toBe(false);

    const limitations = trustedHostLimitations();
    expect(limitations.length).toBeGreaterThanOrEqual(3);

    const b1 = {
      schema: "harness.binding",
      version: 1,
      inspection_sha256: "abc",
      git_identity_sha256: "def",
      content_sha256: "ghi",
      file_count: 10,
      total_bytes: 1024,
    };
    const b2 = { ...b1 };
    const b3 = { ...b1, total_bytes: 2048 };
    expect(sameTrustedHostRepositoryBinding(b1, b2)).toBe(true);
    expect(sameTrustedHostRepositoryBinding(b1, b3)).toBe(false);
  });
});

describe("core/contracts/agents/agents.ts", () => {
  it("validates thinking levels and model tiers", () => {
    for (const lvl of THINKING_LEVELS) {
      expect(isThinkingLevel(lvl)).toBe(true);
    }
    expect(isThinkingLevel("invalid")).toBe(false);

    for (const tier of AGENT_MODEL_TIERS) {
      expect(isAgentModelTier(tier)).toBe(true);
    }
    expect(isAgentModelTier("xl")).toBe(false);
  });

  it("validates agent tool refs and telemetry conflicts", () => {
    expect(isAgentToolRef({ name: "bash" })).toBe(true);
    expect(isAgentToolRef({ name: "bash", category: "shell", extras: { timeout: 100 } })).toBe(
      true,
    );
    expect(isAgentToolRef({ name: "  " })).toBe(false);
    expect(isAgentToolRef({ name: "bash", category: "  " })).toBe(false);
    expect(isAgentToolRef(null)).toBe(false);

    const conflict = {
      field: "model",
      recorded_value: "gpt-4o",
      recorded_evidence_class: "agent_reported" as const,
      probed_value: "gpt-4o-mini",
      probed_evidence_class: "harness_observed" as const,
    };
    expect(isTelemetryFieldConflict(conflict)).toBe(true);
    expect(isTelemetryFieldConflict({ ...conflict, field: "" })).toBe(false);
    expect(isTelemetryFieldConflict({ ...conflict, recorded_evidence_class: "bad" })).toBe(false);
    expect(isTelemetryFieldConflict(null)).toBe(false);
  });

  it("validates agent grant records comprehensively", () => {
    const grant = {
      id: "grant-1",
      role: "implementer" as const,
      parent_agent_id: null,
      parent_task_id: "task-0",
      host: "antigravity",
      granted_at: "2026-08-30T00:00:00Z",
      status: "active" as const,
      host_address: "agent-1",
      released_at: undefined,
      release_reason: undefined,
      provider: evidenced("anthropic", "agent_reported"),
      model: evidenced("claude-3-5-sonnet", "agent_reported"),
      model_tier: evidenced("l" as const, "derived"),
      thinking_level: evidenced("high" as const, "agent_reported"),
      context_window: evidenced(200000, "agent_reported"),
      tools_granted: evidenced([{ name: "bash" }], "agent_reported"),
      tools_used: [
        {
          name: "bash",
          evidence_class: "harness_observed" as const,
          first_reported_at: "2026-08-30T00:01:00Z",
        },
      ],
      tokens_in: evidenced(1000, "agent_reported"),
      tokens_out: evidenced(500, "agent_reported"),
      token_extras: { cache_read: evidenced(200, "agent_reported") },
      last_reported_at: "2026-08-30T00:02:00Z",
      report_count: 3,
      telemetry_conflicts: [],
    };
    expect(isAgentGrantRecord(grant)).toBe(true);
    expect(isAgentGrantRecord(null)).toBe(false);
    expect(isAgentGrantRecord({ ...grant, id: "" })).toBe(false);
    expect(isAgentGrantRecord({ ...grant, role: "bad-role" })).toBe(false);
    expect(isAgentGrantRecord({ ...grant, status: "unknown-status" })).toBe(false);
    expect(isAgentGrantRecord({ ...grant, report_count: "3" })).toBe(false);
    expect(
      isAgentGrantRecord({ ...grant, tokens_in: { value: "not-int", evidence_class: "derived" } }),
    ).toBe(false);
    expect(isAgentGrantRecord({ ...grant, token_extras: { bad: "not-evidenced" } })).toBe(false);
  });
});

describe("core/contracts/agents/workflow.ts", () => {
  it("validates validator domains and applicability heuristics", () => {
    for (const d of VALIDATOR_DOMAINS) {
      expect(isValidatorDomain(d)).toBe(true);
    }
    expect(isValidatorDomain("random")).toBe(false);

    expect(textSignalsUiDomain(["This updates the visual layout and DOM metrics"])).toBe(true);
    expect(textSignalsUiDomain(["Fix database query performance"])).toBe(false);

    const domainsUi = applicableValidatorDomains(["src/components/button.tsx"], []);
    expect(domainsUi).toContain("ui-design");
    expect(domainsUi).toContain("code-quality");

    const domainsSchema = applicableValidatorDomains(["schema/user.proto"], []);
    expect(domainsSchema).toContain("system-design");

    expect(uiDomainApplies(["src/view.vue"])).toBe(true);
    expect(uiDomainApplies(["src/api.ts"])).toBe(false);
    expect(uiDomainApplies(["src/api.ts"], ["Fix frontend button styling"])).toBe(true);
  });

  it("validates micro cycle, structured finding, and coordinator pushback", () => {
    expect(isCoordinatorPushbackCause("procedural")).toBe(true);
    expect(isCoordinatorPushbackCause("substantive")).toBe(true);
    expect(isCoordinatorPushbackCause("other")).toBe(false);

    const microCycle = {
      round: 1,
      validator_id: "val-1",
      critique: "Needs more assertion coverage",
      created_at: "2026-08-30T00:00:00Z",
      status: "open" as const,
      suggested_remediation: "Add edge case tests",
    };
    expect(isMicroCycleRecord(microCycle)).toBe(true);
    expect(isMicroCycleRecord({ ...microCycle, round: 0 })).toBe(false);
    expect(isMicroCycleRecord({ ...microCycle, status: "pending" })).toBe(false);
    expect(isMicroCycleRecord(null)).toBe(false);

    const finding = {
      id: "f-1",
      requirement_id: "req-1",
      severity: "critical" as const,
      observation: "Null pointer exception on empty input",
      evidence: [{ log: "stack trace" }],
      remediation: "Add null check",
      revalidation: "Run unit test with empty input",
      status: "open" as const,
    };
    expect(isStructuredFinding(finding)).toBe(true);
    expect(isStructuredFinding({ ...finding, severity: "low" })).toBe(false);
    expect(isStructuredFinding({ ...finding, evidence: "not-array" })).toBe(false);
    expect(isStructuredFinding(null)).toBe(false);

    const pushback = {
      id: "pb-1",
      validator_id: "val-1",
      domain: "code-quality" as const,
      cause: "procedural" as const,
      observation: "Missing probe execution",
      remediation: "Run adversarial probe",
      review_round: 1,
      created_at: "2026-08-30T00:00:00Z",
    };
    expect(isCoordinatorPushback(pushback)).toBe(true);
    expect(isCoordinatorPushback({ ...pushback, domain: "bad-domain" })).toBe(false);
    expect(isCoordinatorPushback({ ...pushback, cause: "invalid-cause" })).toBe(false);
    expect(isCoordinatorPushback(null)).toBe(false);
  });
});

describe("core/contracts/git/branch.ts", () => {
  it("validates branch status, subtasks, records, and terminal checks", () => {
    for (const s of BRANCH_STATUSES) {
      expect(isBranchStatus(s)).toBe(true);
    }
    expect(isBranchStatus("bad")).toBe(false);

    for (const s of BRANCH_SUB_TASK_STATUSES) {
      expect(isBranchSubTaskStatus(s)).toBe(true);
    }
    expect(isBranchSubTaskStatus("bad")).toBe(false);

    const lease = {
      agent_id: "agent-1",
      token_digest: "tok-abc",
      issued_at: "2026-08-30T00:00:00Z",
      expires_at: "2026-08-30T01:00:00Z",
      duration_seconds: 3600,
    };
    expect(isBranchLease(lease)).toBe(true);
    expect(isBranchLease({ ...lease, duration_seconds: 3600.5 })).toBe(false);
    expect(isBranchLease(null)).toBe(false);

    const subTask = {
      id: "st-1",
      label: "Subtask 1",
      write_scope: ["src/file.ts"],
      status: "claimed" as const,
      agent_id: "agent-1",
      lease,
    };
    expect(isBranchSubTask(subTask)).toBe(true);
    expect(isBranchSubTask({ ...subTask, write_scope: [] })).toBe(false);
    expect(isBranchSubTask(null)).toBe(false);

    const record = {
      id: "branch-1",
      parent_task_id: "task-1",
      parent_agent_id: "agent-0",
      reason: "parallelization",
      depth: 1,
      sub_tasks: [subTask],
      status: "open" as const,
      opened_at: "2026-08-30T00:00:00Z",
      files_changed: evidenced(["src/file.ts"], "harness_observed"),
      opened_observation: {
        observed_at: "2026-08-30T00:00:00Z",
        git_available: true,
        head: "main",
        entries: [{ path: "src/file.ts", status_code: "M", sha256: "abc" }],
      },
    };
    expect(isBranchRecord(record)).toBe(true);
    expect(isBranchRecord({ ...record, depth: 0 })).toBe(false);
    expect(isBranchRecord(null)).toBe(false);

    expect(isSubTaskTerminal({ ...subTask, status: "submitted" })).toBe(true);
    expect(isSubTaskTerminal({ ...subTask, status: "abandoned" })).toBe(true);
    expect(isSubTaskTerminal({ ...subTask, status: "claimed" })).toBe(false);

    expect(isBranchOpen(record)).toBe(true);
    expect(isBranchOpen({ ...record, status: "collected" })).toBe(false);
  });
});

describe("core/contracts/git/worktree.ts", () => {
  it("validates worktree consolidation and ledger state records", () => {
    const consolidation = {
      harness_branch: "olt/main",
      merged_worktree_ids: ["wt-1", "wt-2"],
      merge_conflict: {
        worktree_id: "wt-1",
        branch: "olt/wt-1",
        paths: ["conflicted.ts"],
      },
      rebased: true,
      rebase_target: "main",
      rebase_conflict_paths: [],
      removed_worktree_ids: ["wt-1"],
      commit_count: 3,
      diffstat: "2 files changed",
      consolidated_at: "2026-08-30T00:00:00Z",
    };
    expect(isWorktreeConsolidationRecord(consolidation)).toBe(true);
    expect(isWorktreeConsolidationRecord({ ...consolidation, commit_count: -1 })).toBe(true);
    expect(isWorktreeConsolidationRecord({ ...consolidation, harness_branch: 123 })).toBe(false);
    expect(isWorktreeConsolidationRecord(null)).toBe(false);

    const ledger = {
      harness_branch: "olt/main",
      base_sha: "sha123",
      root: "/tmp/worktrees",
      worktrees: [
        {
          id: "wt-1",
          path: "/tmp/worktrees/wt-1",
          branch: "olt/wt-1",
          base_sha: "sha123",
          created_at: "2026-08-30T00:00:00Z",
        },
      ],
      assignments: [
        {
          task_id: "task-1",
          worktree_id: "wt-1",
          wave: 1,
        },
      ],
      commits: [
        {
          task_id: "task-1",
          worktree_id: "wt-1",
          sha: "sha456",
          subject: "feat: work done",
          changed_lines: 50,
          over_limit: false,
          committed_at: "2026-08-30T00:01:00Z",
        },
      ],
      consolidation,
    };
    expect(isWorktreeLedgerState(ledger)).toBe(true);
    expect(isWorktreeLedgerState({ ...ledger, base_sha: 123 })).toBe(false);
    expect(isWorktreeLedgerState(null)).toBe(false);
  });
});
