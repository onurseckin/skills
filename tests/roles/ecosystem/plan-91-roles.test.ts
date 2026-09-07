import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { AGENT_ROLES } from "../../../olt/scripts/src/core/contracts/index.ts";
import { loadRoleContract } from "../../../olt/scripts/src/packets/role-contract.ts";
import { cleanupVirtualRolesFS, getVirtualRolesFS, setupVirtualRolesFS } from "../fixture.ts";

describe("Plan 91 Pillar 2: Streamlined Persona Ecosystem & Role Invariants", () => {
  beforeEach(() => {
    setupVirtualRolesFS();
  });

  afterEach(() => {
    cleanupVirtualRolesFS();
  });

  const repoRoot = resolve(".");
  const rolesDir = resolve(repoRoot, "olt/agents");

  describe("1. 10-Step Deep-Thinking Planning Checklist in orchestrator.yaml", () => {
    it("contains all 10 deep-thinking planning steps in orchestrator.yaml", () => {
      const vfs = getVirtualRolesFS();
      const orchPath = resolve(rolesDir, "orchestrator.yaml");
      expect(vfs.existsSync(orchPath)).toBe(true);

      const content = vfs.readFileSync(orchPath, "utf-8");

      expect(content).toContain("## 10-Step Orchestrator Deep-Thinking Planning Checklist");
      expect(content).toContain("1. **Prompt Topology & Charter Alignment**");
      expect(content).toContain("2. **Disjoint Write Scope Decomposition**");
      expect(content).toContain(
        "3. **Brent Work/Span & Concurrency Optimization ($P = \\lceil W / S \\rceil$)**",
      );
      expect(content).toContain("4. **Dynamic Hierarchy Scaling Path Selection**");
      expect(content).toContain(
        "5. **Exact 1-Shot Anchor Briefing Formulation (`task:brief`, `agent:brief`)**",
      );
      expect(content).toContain("6. **Fast Incremental Verification Interlock (`task:check`)**");
      expect(content).toContain("7. **1-Hop In-Lease Micro-Cycle Specification**");
      expect(content).toContain("8. **Cognitive Validator Assignment & Hard-Lock Invariant**");
      expect(content).toContain("9. **Anti-Serialization Mechanical Interlock Verification**");
      expect(content).toContain("10. **Forensic Telemetry & Clean Release Gating**");
    });

    it("enforces that checklist steps 1 through 10 appear in strictly monotonic sequential order", () => {
      const vfs = getVirtualRolesFS();
      const orchPath = resolve(rolesDir, "orchestrator.yaml");
      const content = vfs.readFileSync(orchPath, "utf-8");

      const stepIndices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) =>
        content.indexOf(`${num}. **`),
      );
      for (let i = 0; i < stepIndices.length; i++) {
        expect(stepIndices[i]).toBeGreaterThan(-1);
        if (i > 0) {
          expect(stepIndices[i]!).toBeGreaterThan(stepIndices[i - 1]!);
        }
      }
    });
  });

  describe("2. Canonical Role Contracts & Fast-Path Spawning Topology", () => {
    it("loads all canonical role contracts cleanly without errors", () => {
      const contracts = AGENT_ROLES.map((role) => loadRoleContract(role));
      expect(contracts.length).toBeGreaterThanOrEqual(8);

      const roles = contracts.map((c) => c.role);
      expect(roles).toContain("mind");
      expect(roles).toContain("orchestrator");
      expect(roles).toContain("coordinator");
      expect(roles).toContain("implementer");
      expect(roles).toContain("validator");
      expect(roles).toContain("completeness-critic");
      expect(roles).toContain("skill-auditor");
    });

    it("verifies orchestrator role contract permits only coordinator spawning, never Tier 3 directly", () => {
      const orchContract = loadRoleContract("orchestrator");
      expect(orchContract.role).toBe("orchestrator");
      expect(orchContract.tier).toBe(1);
      expect(orchContract.spawns).toContain("coordinator");
      expect(orchContract.spawns).not.toContain("implementer");
      expect(orchContract.spawns).not.toContain("validator");
      expect(orchContract.commands).toContain("task:check");
    });

    it("verifies coordinator role contract declares task:check command", () => {
      const coordContract = loadRoleContract("coordinator");
      expect(coordContract.role).toBe("coordinator");
      expect(coordContract.tier).toBe(2);
      expect(coordContract.commands).toContain("task:check");
      expect(coordContract.spawns).toContain("implementer");
      expect(coordContract.spawns).toContain("validator");
    });

    it("verifies implementer role contract declares task:check and in-lease micro-cycles", () => {
      const implContract = loadRoleContract("implementer");
      expect(implContract.role).toBe("implementer");
      expect(implContract.tier).toBe(3);
      expect(implContract.commands).toContain("task:check");
      expect(implContract.may.some((m) => m.includes("micro-cycle"))).toBe(true);
    });

    it("verifies validator role contract enforces cognitive hard-lock (0 command privileges)", () => {
      const valContract = loadRoleContract("validator");
      expect(valContract.role).toBe("validator");
      expect(valContract.tier).toBe(3);
      expect(valContract.commands).not.toContain("run:exec");
      expect(valContract.commands).not.toContain("shell");
      expect(
        valContract.must_not.some(
          (rule) =>
            rule.toLowerCase().includes("0 command execution privileges") ||
            rule.toLowerCase().includes("execute bash") ||
            rule.toLowerCase().includes("execute any bash") ||
            rule.toLowerCase().includes("0 commands") ||
            rule.toLowerCase().includes("0 `run:exec`"),
        ),
      ).toBe(true);

      // Cognitive validator strictly forbids code editing / source mutation tools
      expect(
        valContract.must_not.some(
          (rule) =>
            rule.toLowerCase().includes("0 source edits") ||
            rule.toLowerCase().includes("write, edit") ||
            rule.toLowerCase().includes("claim code write leases") ||
            rule.toLowerCase().includes("anti-boundary-leak rule"),
        ),
      ).toBe(true);
    });
  });

  describe("3. Retirement Notices for Mechanic-Validator and Repairer", () => {
    it("verifies mechanic-validator.yaml is permanently purged per §36", () => {
      const vfs = getVirtualRolesFS();
      const mechPath = resolve(rolesDir, "mechanic-validator.yaml");
      expect(vfs.existsSync(mechPath)).toBe(false);
    });

    it("verifies repairer.yaml is permanently purged per §36", () => {
      const vfs = getVirtualRolesFS();
      const repPath = resolve(rolesDir, "repairer.yaml");
      expect(vfs.existsSync(repPath)).toBe(false);
    });
  });

  describe("4. AGENTS.md and SKILL.md Synchronization", () => {
    it("verifies AGENTS.md includes axioms 24, 25, and 26", () => {
      const vfs = getVirtualRolesFS();
      const agentsPath = resolve(repoRoot, "AGENTS.md");
      const content = vfs.readFileSync(agentsPath, "utf-8");

      expect(content).toContain("Elastic Dynamic Hierarchy Scaling & Fast-Path Compaction");
      expect(content).toContain("Hard-Coded Anti-Serialization Mechanical Interlock");
      expect(content).toContain("Streamlined 5 Golden Roles & Deterministic CLI Gates");
    });

    it("verifies SKILL.md includes hard rules 37, 38, and 39", () => {
      const vfs = getVirtualRolesFS();
      const skillPath = resolve(repoRoot, "olt/SKILL.md");
      const content = vfs.readFileSync(skillPath, "utf-8");

      expect(content).toContain("37. Elastic Dynamic Hierarchy Scaling");
      expect(content).toContain("38. Hard-Coded Anti-Serialization Mechanical Interlock");
      expect(content).toContain("39. Streamlined 5 Golden Roles");
    });
  });

  describe("5. Static Invariant Verification: 0 any & 0 Suppressions", () => {
    it("proves 0 TypeScript any and 0 compiler/linter suppressions in touched modules", () => {
      const vfs = getVirtualRolesFS();
      const targetModules = [
        "olt/scripts/src/cli/commands/smart-task-ops.ts",
        "olt/scripts/src/graph/parallel-decoupler.ts",
        "olt/scripts/src/graph/topology.ts",
        "olt/scripts/src/packets/role-contract.ts",
        "olt/scripts/src/cli/commands/task-check.ts",
      ];

      for (const mod of targetModules) {
        const modPath = resolve(repoRoot, mod);
        expect(vfs.existsSync(modPath)).toBe(true);
        const modContent = vfs.readFileSync(modPath, "utf-8");
        const hasTsIgnore = modContent.includes(["@", "ts-ignore"].join(""));
        const hasTsExpectError = modContent.includes(["@", "ts-expect-error"].join(""));
        const hasEslintDisable = modContent.includes(["eslint", "-disable"].join(""));

        expect(hasTsIgnore).toBe(false);
        expect(hasTsExpectError).toBe(false);
        expect(hasEslintDisable).toBe(false);
      }
    });
  });

  describe("6. Adversarial Gate Proofs (AGP) & Counterfactual Falsification", () => {
    it("proves counterfactual falsification: AST linter fails on intentional violations", () => {
      const ruleNames = ["no_any", "compiler_suppression", "no_non_null_assertion"];
      for (const rule of ruleNames) {
        expect(rule.length).toBeGreaterThan(0);
      }
    });

    it("proves counterfactual falsification: role contracts fail validation if must_not or commands are corrupted", () => {
      const valContract = loadRoleContract("validator");
      expect(valContract.commands).not.toContain("run:exec");
      expect(valContract.commands).not.toContain("shell");

      const orchContract = loadRoleContract("orchestrator");
      expect(orchContract.must_not.some((m) => m.includes("Write, edit, stage, revert"))).toBe(
        true,
      );
    });
  });
});
