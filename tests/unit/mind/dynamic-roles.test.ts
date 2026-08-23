import { describe, expect, it, beforeEach } from "bun:test";
import {
  DynamicRoleRegistry,
  formatDynamicRoleBody,
  formatDynamicRoleFrontmatter,
  formatDynamicRoleMarkdown,
  generateDynamicRoleCheatSheet,
  getGlobalRoleRegistry,
  mutateRoleWithFeedback,
  parseDynamicRoleContract,
  renderDynamicRolesAsciiTable,
  resetGlobalRoleRegistry,
  synthesizeDynamicRole,
  synthesizeRoleFromDefectRemediation,
  synthesizeRoleFromTaskRequirements,
  validateDynamicRoleSpec,
  type DynamicRoleContract,
  type DynamicRoleSpec,
} from "../../../olt/scripts/src/mind/dynamic-roles.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";

describe("Hyper-Conscious Mind Dynamic Role Synthesis Engine", () => {
  beforeEach(() => {
    resetGlobalRoleRegistry();
  });

  describe("Dynamic Role Specification Validation (validateDynamicRoleSpec)", () => {
    it("validates well-formed implementer spec", () => {
      const spec: DynamicRoleSpec = {
        name: "test-implementer",
        archetype: "tier_3_implementer",
        tier: 3,
        title: "Test Implementer",
        summary: "Executes test tasks within write scope.",
        grantedCommands: ["task:claim", "task:submit"],
        permittedActivities: ["Claim leased task", "Run focused test"],
        prohibitedActions: ["Touch files outside write scope"],
        invariants: ["Zero any invariant"],
        spawns: [],
        cognitivePillars: ["Type safety", "Scope isolation"],
        writeScopePolicy: "lease_bounded",
      };

      const result = validateDynamicRoleSpec(spec);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.roleName).toBe("test-implementer");
      expect(result.tier).toBe(3);
    });

    it("rejects invalid role names", () => {
      const spec: DynamicRoleSpec = {
        name: "INVALID_Role_Name!#",
        archetype: "tier_3_implementer",
        tier: 3,
        title: "Invalid Role",
        summary: "Summary",
        grantedCommands: ["task:claim"],
        permittedActivities: ["May act"],
        prohibitedActions: ["Must not act"],
        invariants: [],
        spawns: [],
        cognitivePillars: ["Pillar 1"],
        writeScopePolicy: "lease_bounded",
      };

      const result = validateDynamicRoleSpec(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid. Must match pattern"))).toBe(true);
    });

    it("rejects invalid tiers outside 0..3", () => {
      const spec: DynamicRoleSpec = {
        name: "test-invalid-tier",
        archetype: "tier_3_implementer",
        tier: 5,
        title: "Invalid Tier",
        summary: "Summary",
        grantedCommands: [],
        permittedActivities: [],
        prohibitedActions: [],
        invariants: [],
        spawns: [],
        cognitivePillars: [],
        writeScopePolicy: "lease_bounded",
      };

      const result = validateDynamicRoleSpec(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Tier must be an integer between 0 and 3"))).toBe(
        true,
      );
    });

    it("detects archetype-tier mismatch", () => {
      const spec: DynamicRoleSpec = {
        name: "mismatched-mind",
        archetype: "tier_0_mind",
        tier: 3,
        title: "Mismatched Mind",
        summary: "Summary",
        grantedCommands: ["mind:pulse"],
        permittedActivities: ["Autonomous pulse"],
        prohibitedActions: ["Direct write"],
        invariants: [],
        spawns: [],
        cognitivePillars: ["Infinite Cadence"],
        writeScopePolicy: "forbidden",
      };

      const result = validateDynamicRoleSpec(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("expects Tier 0"))).toBe(true);
    });

    it("enforces Anti-Boundary-Leak rule for validators", () => {
      const specWithWritePolicy: DynamicRoleSpec = {
        name: "leaky-validator",
        archetype: "tier_3_validator",
        tier: 3,
        title: "Leaky Validator",
        summary: "Summary",
        grantedCommands: ["gate:check"],
        permittedActivities: ["Execute gate"],
        prohibitedActions: [],
        invariants: [],
        spawns: [],
        cognitivePillars: ["Adversarial check"],
        writeScopePolicy: "lease_bounded", // VIOLATION
      };

      const result1 = validateDynamicRoleSpec(specWithWritePolicy);
      expect(result1.valid).toBe(false);
      expect(result1.errors.some((e) => e.includes("Anti-Boundary-Leak Violation"))).toBe(true);

      const specWithWriteMay: DynamicRoleSpec = {
        name: "write-validator",
        archetype: "tier_3_validator",
        tier: 3,
        title: "Write Validator",
        summary: "Summary",
        grantedCommands: ["gate:check"],
        permittedActivities: ["Execute gate", "Claim lease to write bug fix"], // VIOLATION
        prohibitedActions: [],
        invariants: [],
        spawns: [],
        cognitivePillars: ["Adversarial check"],
        writeScopePolicy: "forbidden",
      };

      const result2 = validateDynamicRoleSpec(specWithWriteMay);
      expect(result2.valid).toBe(false);
      expect(
        result2.errors.some((e) => e.includes("permitted activities contain write actions")),
      ).toBe(true);
    });

    it("rejects forbidden commands such as orchestrator:run", () => {
      const spec: DynamicRoleSpec = {
        name: "dangerous-role",
        archetype: "tier_1_orchestrator",
        tier: 1,
        title: "Dangerous Role",
        summary: "Summary",
        grantedCommands: ["orchestrator:run"], // FORBIDDEN
        permittedActivities: ["Supervise"],
        prohibitedActions: ["Direct write"],
        invariants: [],
        spawns: ["coordinator"],
        cognitivePillars: ["Supervision"],
        writeScopePolicy: "forbidden",
      };

      const result = validateDynamicRoleSpec(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("strictly forbidden"))).toBe(true);
    });

    it("enforces spawn restrictions per tier", () => {
      // Tier 3 cannot spawn
      const tier3Spawner: DynamicRoleSpec = {
        name: "spawning-implementer",
        archetype: "tier_3_implementer",
        tier: 3,
        title: "Spawning Implementer",
        summary: "Summary",
        grantedCommands: ["task:claim"],
        permittedActivities: ["Claim task"],
        prohibitedActions: ["Out of scope write"],
        invariants: [],
        spawns: ["sub-worker"], // VIOLATION
        cognitivePillars: ["Execution"],
        writeScopePolicy: "lease_bounded",
      };

      const result1 = validateDynamicRoleSpec(tier3Spawner);
      expect(result1.valid).toBe(false);
      expect(result1.errors.some((e) => e.includes("cannot spawn subagents"))).toBe(true);

      // Tier 1 can only spawn coordinator
      const tier1Bypasser: DynamicRoleSpec = {
        name: "bypassing-orchestrator",
        archetype: "tier_1_orchestrator",
        tier: 1,
        title: "Bypassing Orchestrator",
        summary: "Summary",
        grantedCommands: ["orchestrator:supervise"],
        permittedActivities: ["Supervise"],
        prohibitedActions: ["Direct write"],
        invariants: [],
        spawns: ["implementer"], // VIOLATION - bypasses tier 2
        cognitivePillars: ["Supervision"],
        writeScopePolicy: "forbidden",
      };

      const result2 = validateDynamicRoleSpec(tier1Bypasser);
      expect(result2.valid).toBe(false);
      expect(result2.errors.some((e) => e.includes("may only spawn Tier 2 'coordinator'"))).toBe(
        true,
      );
    });
  });

  describe("Dynamic Role Synthesis (synthesizeDynamicRole)", () => {
    it("synthesizes a specialized Tier 3 implementer role with deterministic SHA256", () => {
      const contract = synthesizeDynamicRole({
        name: "perf-optimizer",
        archetype: "tier_3_implementer",
        domain: "performance",
        title: "Performance Optimizer",
        summary: "Optimizes hot loop paths without introducing regressions.",
        grantedCommands: ["task:claim", "task:submit", "run:exec"],
        cognitivePillars: [
          "Zero-Regression Performance Engineering",
          "Strict Microbenchmark Determinism",
        ],
      });

      expect(contract.role).toBe("perf-optimizer");
      expect(contract.tier).toBe(3);
      expect(contract.domain).toBe("performance");
      expect(contract.writeScopePolicy).toBe("lease_bounded");
      expect(contract.commands).toEqual(["task:claim", "task:submit", "run:exec"]);
      expect(contract.cognitivePillars).toContain("Zero-Regression Performance Engineering");
      expect(contract.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(contract.markdown).toContain("role: perf-optimizer");
      expect(contract.markdown).toContain("# Performance Optimizer");
    });

    it("synthesizes a specialized Tier 3 validator role with default Anti-Boundary-Leak guarantees", () => {
      const contract = synthesizeDynamicRole({
        name: "sec-validator",
        archetype: "tier_3_validator",
        domain: "security",
        title: "Security Auditor Validator",
        summary: "Audits security invariants and credential handling.",
      });

      expect(contract.role).toBe("sec-validator");
      expect(contract.tier).toBe(3);
      expect(contract.domain).toBe("security");
      expect(contract.writeScopePolicy).toBe("forbidden");
      expect(contract.must_not.some((m) => m.includes("Anti-Boundary-Leak"))).toBe(true);
      expect(contract.must_not.some((m) => m.includes("Validate own implementations"))).toBe(true);
    });

    it("synthesizes Tier 0 Mind and Tier 2 Coordinator roles", () => {
      const mindContract = synthesizeDynamicRole({
        name: "mind-executive",
        archetype: "tier_0_mind",
        title: "Executive Autonomous Mind",
        summary: "Governs infinite cadence and self-evolution cycles.",
      });
      expect(mindContract.tier).toBe(0);
      expect(mindContract.spawns).toEqual(["orchestrator"]);
      expect(mindContract.commands).toContain("mind:self-evolve");

      const coordContract = synthesizeDynamicRole({
        name: "wave-coordinator",
        archetype: "tier_2_coordinator",
        title: "Wave Coordinator",
        summary: "Compiles wave plans and orchestrates tasks.",
      });
      expect(coordContract.tier).toBe(2);
      expect(coordContract.commands).toContain("plan:compile");
      expect(coordContract.commands).toContain("queue:wave");
    });

    it("throws HarnessError on invalid synthesis parameters", () => {
      expect(() =>
        synthesizeDynamicRole({
          name: "bad-validator",
          archetype: "tier_3_validator",
          writeScopePolicy: "unrestricted", // VIOLATION
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Role Contract Parsing (parseDynamicRoleContract)", () => {
    it("parses markdown contract with frontmatter and body", () => {
      const rawMarkdown = `---
role: specialized-critic
tier: 3
domain: code-quality
may:
  - Evaluate semantic completeness
  - Record findings
must_not:
  - Claim code write leases
  - Edit source files
commands:
  - critic:evaluate
  - gate:check
spawns:
  - []
---

# Specialized Critic

Evaluates semantic quality of changes.

## Cognitive Pillars
- Semantic Completeness
- Strict Adversarial Verification

## Architectural Constraints
- Authority Tier: Tier 3
`;

      const contract = parseDynamicRoleContract(rawMarkdown, "test-critic.md");
      expect(contract.role).toBe("specialized-critic");
      expect(contract.tier).toBe(3);
      expect(contract.domain).toBe("code-quality");
      expect(contract.may).toEqual(["Evaluate semantic completeness", "Record findings"]);
      expect(contract.must_not).toEqual(["Claim code write leases", "Edit source files"]);
      expect(contract.commands).toEqual(["critic:evaluate", "gate:check"]);
      expect(contract.spawns).toEqual([]);
      expect(contract.cognitivePillars).toEqual([
        "Semantic Completeness",
        "Strict Adversarial Verification",
      ]);
      expect(contract.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("parses from Uint8Array bytes", () => {
      const rawMarkdown = `---
role: byte-role
tier: 2
may:
  - Act
must_not:
  - Fail
commands:
  - queue:wave
spawns:
  - implementer
---

# Byte Role
Prose summary
`;
      const bytes = new TextEncoder().encode(rawMarkdown);
      const contract = parseDynamicRoleContract(bytes);
      expect(contract.role).toBe("byte-role");
      expect(contract.tier).toBe(2);
    });

    it("throws HarnessError on malformed documents", () => {
      expect(() => parseDynamicRoleContract("not markdown without fence")).toThrow(HarnessError);

      const unterminated = "---\nrole: incomplete\ntier: 1\n";
      expect(() => parseDynamicRoleContract(unterminated)).toThrow(HarnessError);

      const missingRole = "---\ntier: 1\n---\n# Body";
      expect(() => parseDynamicRoleContract(missingRole)).toThrow(HarnessError);

      const invalidTier = "---\nrole: bad-tier\ntier: 99\n---\n# Body";
      expect(() => parseDynamicRoleContract(invalidTier)).toThrow(HarnessError);
    });
  });

  describe("Task Role Synthesis (synthesizeRoleFromTaskRequirements)", () => {
    it("synthesizes 1:1 paired Implementer and Validator fulfilling anti-batching and anti-leak", () => {
      const plan = synthesizeRoleFromTaskRequirements({
        taskId: "task-feat-auth-101",
        taskTitle: "Implement JWT Token Verification",
        writeScope: ["src/auth/jwt.ts", "tests/unit/auth/jwt.test.ts"],
        gate: "bun test tests/unit/auth/jwt.test.ts",
        domain: "security",
        complexity: "high",
        charterGoals: ["Zero Vulnerability", "High Throughput"],
      });

      expect(plan.taskId).toBe("task-feat-auth-101");
      expect(plan.antiBatchingCompliant).toBe(true);
      expect(plan.antiBoundaryLeakGuaranteed).toBe(true);

      // Verify implementer role
      expect(plan.implementerRole.role).toContain("implementer-security-task-feat-auth-101");
      expect(plan.implementerRole.writeScopePolicy).toBe("lease_bounded");
      expect(plan.implementerRole.commands).toContain("task:claim");
      expect(plan.implementerRole.commands).toContain("task:submit");
      expect(plan.implementerRole.spec.metadata?.taskId).toBe("task-feat-auth-101");

      // Verify validator role
      expect(plan.validatorRole.role).toContain("validator-security-task-feat-auth-101");
      expect(plan.validatorRole.writeScopePolicy).toBe("forbidden");
      expect(plan.validatorRole.commands).toContain("gate:check");
      expect(plan.validatorRole.must_not.some((m) => m.includes("Anti-Boundary-Leak"))).toBe(true);
      expect(plan.validatorRole.spec.metadata?.validatedImplementer).toBe(
        plan.implementerRole.role,
      );
    });

    it("synthesizes specialized repairer role when requiresRepair is true", () => {
      const plan = synthesizeRoleFromTaskRequirements({
        taskId: "task-fix-memory-leak",
        taskTitle: "Fix buffer leak in event loop",
        writeScope: ["src/event-loop.ts"],
        gate: "bun test tests/unit/event-loop.test.ts",
        requiresRepair: true,
      });

      expect(plan.implementerRole.role).toContain("repairer-task-fix-memory-leak");
      expect(plan.implementerRole.spec.archetype).toBe("tier_3_repairer");
      expect(plan.implementerRole.commands).toContain("recover");
    });
  });

  describe("Defect Remediation Role Synthesis (synthesizeRoleFromDefectRemediation)", () => {
    it("synthesizes specialized defect remediator with root-cause defense pillars", () => {
      const role = synthesizeRoleFromDefectRemediation({
        defectId: "defect-scope-leak-042",
        defectType: "WRITE_SCOPE_LEAK",
        rootCause: "Unchecked file write outside lease boundary",
        affectedScope: ["src/core/runner.ts"],
        correctiveAction: "Enforce strictly checked file paths in wrapper",
        requiredInvariants: ["Pre-write path containment check"],
      });

      expect(role.role).toContain("remediator-defect-defect-scope-leak-042");
      expect(role.tier).toBe(3);
      expect(role.domain).toBe("defect-investigation");
      expect(role.cognitivePillars.some((p) => p.includes("WRITE_SCOPE_LEAK"))).toBe(true);
      expect(role.cognitivePillars.some((p) => p.includes("Unchecked file write"))).toBe(true);
      expect(role.must_not.some((m) => m.includes("Re-introduce identical defect signature"))).toBe(
        true,
      );
    });
  });

  describe("Role Mutation & Evolutionary Lineage (mutateRoleWithFeedback)", () => {
    it("evolves dynamic role with feedback and updates lineage metadata", () => {
      const initialRole = synthesizeDynamicRole({
        name: "adaptive-worker",
        archetype: "tier_3_implementer",
        title: "Adaptive Worker v1",
        summary: "First generation worker",
        invariants: ["Invariant 1"],
        cognitivePillars: ["Pillar 1"],
      });

      expect(initialRole.spec.version).toBe(1);

      const evolvedRole = mutateRoleWithFeedback(initialRole, {
        mutationReason: "Tighten verification after edge-case failure",
        newInvariants: ["Invariant 2 - Strict Null Checking"],
        newPillars: ["Pillar 2 - Zero Tolerance for Implicit Any"],
        additionalCommands: ["doctor"],
        additionalProhibitions: ["Use non-null assertion operator !"],
      });

      expect(evolvedRole.spec.version).toBe(2);
      expect(evolvedRole.spec.parentRole).toBe("adaptive-worker");
      expect(evolvedRole.spec.invariants).toContain("Invariant 2 - Strict Null Checking");
      expect(evolvedRole.spec.cognitivePillars).toContain(
        "Pillar 2 - Zero Tolerance for Implicit Any",
      );
      expect(evolvedRole.spec.grantedCommands).toContain("doctor");
      expect(evolvedRole.spec.prohibitedActions).toContain("Use non-null assertion operator !");

      expect(evolvedRole.spec.lineage).toHaveLength(1);
      expect(evolvedRole.spec.lineage?.[0]?.mutationReason).toBe(
        "Tighten verification after edge-case failure",
      );
      expect(evolvedRole.spec.lineage?.[0]?.previousSha256).toBe(initialRole.sha256);
      expect(evolvedRole.sha256).not.toBe(initialRole.sha256);
    });
  });

  describe("Dynamic Role Cheat-Sheet Generation (generateDynamicRoleCheatSheet)", () => {
    it("generates full markdown cheat-sheet", () => {
      const role = synthesizeDynamicRole({
        name: "test-cheat-role",
        archetype: "tier_3_implementer",
        title: "Cheat Role",
        summary: "Summary for cheat sheet",
        grantedCommands: ["task:claim", "task:submit"],
      });

      const sheet = generateDynamicRoleCheatSheet(role);
      expect(sheet.role).toBe("test-cheat-role");
      expect(sheet.tier).toBe(3);
      expect(sheet.grantedCommands).toEqual(["task:claim", "task:submit"]);
      expect(sheet.commandDetails).toHaveLength(2);
      expect(sheet.markdown).toContain("### 🛡️ Role Contract: `test-cheat-role` (Tier 3)");
      expect(sheet.markdown).toContain("#### ⚡ Granted CLI Verbs & Syntax");
      expect(sheet.markdown).toContain("#### 🚫 Invariants & Absolute Prohibitions");
    });

    it("generates compact cheat-sheet", () => {
      const role = synthesizeDynamicRole({
        name: "compact-role",
        archetype: "tier_2_coordinator",
        grantedCommands: ["plan:compile", "queue:wave"],
      });

      const sheet = generateDynamicRoleCheatSheet(role, { compact: true });
      expect(sheet.markdown).toContain("### ⚡ Compact Cheat-Sheet: `compact-role` (Tier 2)");
      expect(sheet.markdown).toContain("Granted Commands (2)");
    });
  });

  describe("Dynamic Roles ASCII Table Rendering (renderDynamicRolesAsciiTable)", () => {
    it("renders empty table message when list is empty", () => {
      const table = renderDynamicRolesAsciiTable([]);
      expect(table).toBe("(no dynamic roles registered)");
    });

    it("renders formatted ASCII table with multiple roles", () => {
      const r1 = synthesizeDynamicRole({
        name: "r1-mind",
        archetype: "tier_0_mind",
      });
      const r2 = synthesizeDynamicRole({
        name: "r2-validator",
        archetype: "tier_3_validator",
        domain: "security",
      });

      const table = renderDynamicRolesAsciiTable([r1, r2]);
      expect(table).toContain("r1-mind");
      expect(table).toContain("r2-validator");
      expect(table).toContain("tier_0_mind");
      expect(table).toContain("tier_3_validator");
      expect(table).toContain("security");
    });
  });

  describe("Dynamic Role Catalog Registry (DynamicRoleRegistry)", () => {
    it("manages role lifecycle (register, get, has, revoke, filter, list)", () => {
      const registry = new DynamicRoleRegistry();

      const r1 = synthesizeDynamicRole({
        name: "role-sec-1",
        archetype: "tier_3_validator",
        domain: "security",
      });

      const r2 = synthesizeDynamicRole({
        name: "role-code-1",
        archetype: "tier_3_implementer",
        domain: "code-quality",
      });

      const r3 = synthesizeDynamicRole({
        name: "role-coord-1",
        archetype: "tier_2_coordinator",
      });

      registry.register(r1);
      registry.register(r2);
      registry.register(r3);

      expect(registry.count()).toBe(3);
      expect(registry.has("role-sec-1")).toBe(true);
      expect(registry.has("unknown-role")).toBe(false);

      expect(registry.get("role-sec-1")?.role).toBe("role-sec-1");

      // Filtering tests
      expect(registry.filterByTier(3)).toHaveLength(2);
      expect(registry.filterByTier(2)).toHaveLength(1);
      expect(registry.filterByDomain("security")).toHaveLength(1);
      expect(registry.filterByArchetype("tier_3_implementer")).toHaveLength(1);

      // Revoke test
      const revoked = registry.revoke("role-code-1");
      expect(revoked).toBe(true);
      expect(registry.count()).toBe(2);
      expect(registry.has("role-code-1")).toBe(false);

      // Clear test
      registry.clear();
      expect(registry.count()).toBe(0);
    });

    it("exports and imports catalog", () => {
      const registry = new DynamicRoleRegistry();
      registry.register(
        synthesizeDynamicRole({
          name: "exp-role-1",
          archetype: "tier_3_implementer",
          domain: "system-design",
        }),
      );

      const exported = registry.exportCatalog();
      expect(exported.totalRoles).toBe(1);
      expect(exported.roles[0]?.name).toBe("exp-role-1");

      const newRegistry = new DynamicRoleRegistry();
      const count = newRegistry.importCatalog(exported);
      expect(count).toBe(1);
      expect(newRegistry.has("exp-role-1")).toBe(true);
    });

    it("manages global role registry singleton", () => {
      const globalReg = getGlobalRoleRegistry();
      globalReg.register(
        synthesizeDynamicRole({
          name: "global-role-1",
          archetype: "tier_0_mind",
        }),
      );

      expect(getGlobalRoleRegistry().has("global-role-1")).toBe(true);

      resetGlobalRoleRegistry();
      expect(getGlobalRoleRegistry().count()).toBe(0);
    });
  });
});
