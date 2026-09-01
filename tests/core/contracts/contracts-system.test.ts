import { describe, expect, it } from "bun:test";
import { isJsonObject, isSafeInteger } from "../../../olt/scripts/src/core/contracts/json.ts";
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
import {
  isAgentRole,
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  AGENT_ROLES,
} from "../../../olt/scripts/src/core/contracts/network/packets.ts";
import {
  sameTrustedHostRepositoryBinding,
  trustedHostEvidence,
  trustedHostLimitations,
  TRUSTED_HOST_ASSURANCE,
} from "../../../olt/scripts/src/core/contracts/network/trusted-host.ts";

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
