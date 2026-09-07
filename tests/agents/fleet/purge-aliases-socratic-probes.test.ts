import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import {
  CONTRACTS_TIER_2,
  ORCHESTRATION_CONTRACTS,
  SPECIALIST_CONTRACTS,
  EXECUTION_GENERIC_CONTRACTS,
} from "../../../olt/scripts/src/agents/fleet/contracts-tier2.ts";
import {
  TIER_NAMES,
  agentIdToRole,
  agentIdToTier,
  parseTierValue,
  roleToTier,
  validateTierSpawning,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const CONTRACT_PATHS = [
  "olt/scripts/src/agents/fleet/contracts-tier2.ts",
  "olt/scripts/src/agents/fleet/contracts/types.ts",
  "olt/scripts/src/agents/fleet/contracts/index.ts",
  "olt/scripts/src/agents/fleet/contracts/orchestration.ts",
  "olt/scripts/src/agents/fleet/contracts/specialists.ts",
  "olt/scripts/src/agents/fleet/contracts/execution-generic.ts",
];

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession = createVirtualFSSession(vfs);

const PRELOADED_CONTRACTS = new Map<string, string>();
for (const relPath of CONTRACT_PATHS) {
  const fullPath = resolve(relPath);
  PRELOADED_CONTRACTS.set(fullPath, String(session.readFileSync(fullPath, "utf-8")));
}

describe("Two-Key Socratic Cognitive Validation: Purge Agent Aliases & Partition Tier 2 Contracts", () => {
  beforeEach(() => {
    session.cleanup();
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    for (const [fullPath, content] of PRELOADED_CONTRACTS) {
      vfs.mkdirSync(dirname(fullPath), { recursive: true });
      vfs.writeFileSync(fullPath, content);
    }
  });

  afterEach(() => {
    session.cleanup();
  });
  describe("Probe 1: Modularity and Physical Line Limit Invariant", () => {
    test("verifies all partitioned tier-2 contracts files satisfy LOC <= 400 invariant", () => {
      const paths = [
        "olt/scripts/src/agents/fleet/contracts-tier2.ts",
        "olt/scripts/src/agents/fleet/contracts/types.ts",
        "olt/scripts/src/agents/fleet/contracts/index.ts",
        "olt/scripts/src/agents/fleet/contracts/orchestration.ts",
        "olt/scripts/src/agents/fleet/contracts/specialists.ts",
        "olt/scripts/src/agents/fleet/contracts/execution-generic.ts",
      ];

      for (const relPath of paths) {
        const fullPath = resolve(relPath);
        const text = vfs.readFileSync(fullPath, "utf-8");
        const lines = text.split(/\r?\n/).length;
        expect(lines).toBeLessThanOrEqual(400);
      }
    });

    test("verifies all tier-2 contracts are properly typed, category-bound, and frozen", () => {
      expect(CONTRACTS_TIER_2.length).toBeGreaterThan(0);
      for (const contract of CONTRACTS_TIER_2) {
        expect([1, 2, 3]).toContain(contract.tier as number);
        expect(["orchestration", "execution", "quality"]).toContain(contract.category);
        expect(Object.isFrozen(contract)).toBe(true);
        expect(contract.id.length).toBeGreaterThan(0);
        expect(contract.role.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Probe 2: Legacy Alias Purge and Exact String Parsing Invariant", () => {
    test("verifies parseTierValue rejects legacy alias string patterns", () => {
      const legacyTierStrings = [
        "tier-0",
        "tier_0",
        "tier 0",
        "human",
        "tier-1",
        "tier_1",
        "tier 1",
        "orch",
        "tier-2",
        "tier_2",
        "tier 2",
        "coord",
        "tier-3",
        "tier_3",
        "tier 3",
      ];

      for (const legacy of legacyTierStrings) {
        expect(parseTierValue(legacy)).toBeNull();
      }

      expect(parseTierValue("0")).toBe(0);
      expect(parseTierValue("1")).toBe(1);
      expect(parseTierValue("2")).toBe(2);
      expect(parseTierValue("3")).toBe(3);

      expect(parseTierValue("-1")).toBeNull();
      expect(parseTierValue("4")).toBeNull();
      expect(parseTierValue("0.0")).toBeNull();
      expect(parseTierValue("NaN")).toBeNull();
      expect(parseTierValue(" 2 ")).toBe(2);
    });

    test("verifies roleToTier drops alias prefix heuristics and falls back to Tier 3", () => {
      expect(roleToTier("orch")).toBe(3);
      expect(roleToTier("coord")).toBe(3);
      expect(roleToTier("human")).toBe(3);
      expect(roleToTier("lead")).toBe(3);
      expect(roleToTier("user")).toBe(3);

      expect(roleToTier("mind")).toBe(0);
      expect(roleToTier("orchestrator")).toBe(1);
      expect(roleToTier("mind-auditor")).toBe(1);
      expect(roleToTier("coordinator")).toBe(2);
      expect(roleToTier("implementer")).toBe(3);
      expect(roleToTier("validator")).toBe(3);
    });
  });

  describe("Probe 3: Agent ID Alias Purge and Exact Prefix Invariant", () => {
    test("verifies agentIdToRole rejects short legacy prefixes (impl, val, orch, coord)", () => {
      expect(agentIdToRole("impl-123")).toBeNull();
      expect(agentIdToRole("val-456")).toBeNull();
      expect(agentIdToRole("orch-789")).toBeNull();
      expect(agentIdToRole("coord-101")).toBeNull();
      expect(agentIdToRole("human-operator")).toBeNull();

      expect(agentIdToRole("implementer-123")).toBe("implementer");
      expect(agentIdToRole("validator-456")).toBe("validator");
      expect(agentIdToRole("orchestrator-789")).toBe("orchestrator");
      expect(agentIdToRole("coordinator-101")).toBe("coordinator");
    });

    test("verifies agentIdToTier rejects truncated prefix agent IDs", () => {
      expect(agentIdToTier("impl-1")).toBeNull();
      expect(agentIdToTier("val-1")).toBeNull();
      expect(agentIdToTier("orch-1")).toBeNull();
      expect(agentIdToTier("coord-1")).toBeNull();

      expect(agentIdToTier("implementer-1")).toBe(3);
      expect(agentIdToTier("validator-1")).toBe(3);
      expect(agentIdToTier("orchestrator-1")).toBe(1);
      expect(agentIdToTier("coordinator-1")).toBe(2);

      expect(agentIdToTier("sub-implementer-01")).toBe(3);
      expect(agentIdToTier("implementer-sub-01")).toBe(3);
      expect(agentIdToTier("mind-auditor-beta")).toBe(1);
      expect(agentIdToTier("mind-core")).toBe(0);
    });
  });

  describe("Probe 4: Zero Facade Bypasses and Modular Slicing Invariant", () => {
    test("verifies partitioned contract slices combine without duplicates into CONTRACTS_TIER_2", () => {
      const sumSlices =
        ORCHESTRATION_CONTRACTS.length +
        SPECIALIST_CONTRACTS.length +
        EXECUTION_GENERIC_CONTRACTS.length;
      expect(CONTRACTS_TIER_2.length).toBe(sumSlices);

      const seenIds = new Set<string>();
      for (const contract of CONTRACTS_TIER_2) {
        expect(seenIds.has(contract.id)).toBe(false);
        seenIds.add(contract.id);
      }
    });

    test("verifies all coordinator contracts strictly forbid direct source code edits and lease claiming", () => {
      for (const contract of ORCHESTRATION_CONTRACTS) {
        expect(contract.toolBoundaries.canWriteCode).toBe(false);
        expect(contract.toolBoundaries.canClaimLeases).toBe(false);
      }
    });
  });

  describe("Probe 5: Strict 4-Tier Hierarchy and Spawning Boundary Invariant", () => {
    test("verifies validateTierSpawning enforces hierarchical descent and forbids escalation", () => {
      expect(validateTierSpawning(0, 1).allowed).toBe(true);
      expect(validateTierSpawning(1, 2).allowed).toBe(true);
      expect(validateTierSpawning(2, 3).allowed).toBe(true);
      expect(validateTierSpawning(3, 3).allowed).toBe(true);

      expect(validateTierSpawning(0, 2).allowed).toBe(false);
      expect(validateTierSpawning(1, 3).allowed).toBe(false);
      expect(validateTierSpawning(2, 0).allowed).toBe(false);
      expect(validateTierSpawning(2, 1).allowed).toBe(false);
      expect(validateTierSpawning(3, 0).allowed).toBe(false);
      expect(validateTierSpawning(3, 1).allowed).toBe(false);
      expect(validateTierSpawning(3, 2).allowed).toBe(false);
    });

    test("verifies TIER_NAMES accurately describes all 4 tiers without legacy terminology", () => {
      expect(TIER_NAMES[0]).toContain("Tier 0: Mind Lead");
      expect(TIER_NAMES[1]).toContain("Tier 1: Orchestrator Lead");
      expect(TIER_NAMES[2]).toContain("Tier 2: Coordinator Lead");
      expect(TIER_NAMES[3]).toContain("Tier 3: Implementer");
    });
  });
});
