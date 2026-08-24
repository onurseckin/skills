import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type StagnationTelemetry,
  VerbatimRoleInjector,
} from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

describe("VerbatimRoleInjector", () => {
  describe("resolveManifestPath", () => {
    it("resolves valid manifests from olt/agents/mind.yaml and olt/agents/orchestrator.yaml", () => {
      const mindPath = VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, "mind");
      expect(mindPath).toBe(resolve(REPO_ROOT, "olt", "agents", "mind.yaml"));

      const orchPath = VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, "orchestrator");
      expect(orchPath).toBe(resolve(REPO_ROOT, "olt", "agents", "orchestrator.yaml"));
    });

    it("throws HarnessError with code NOT_FOUND when manifest does not exist", () => {
      const fakeRole = "non-existent-role-99999";

      expect(() => {
        VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, fakeRole);
      }).toThrow(HarnessError);

      try {
        VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, fakeRole);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code as string).toBe("NOT_FOUND");
        expect(harnessErr.message).toContain(
          `Agent manifest for role '${fakeRole}' not found at candidates:`,
        );
      }
    });

    it("resolves candidates in precedence order: olt/agents/*.yaml, olt/agents/*.yml, agents/*.yaml, agents/*.yml", () => {
      const scratch = scratchRoot(import.meta.path, "candidate-precedence");

      // 1. agents/test-role.yml
      const agentsDir = join(scratch, "agents");
      mkdirSync(agentsDir, { recursive: true });
      const agentsYmlPath = join(agentsDir, "test-role.yml");
      writeFileSync(agentsYmlPath, "name: agents-yml\n", "utf-8");

      expect(VerbatimRoleInjector.resolveManifestPath(scratch, "test-role")).toBe(
        resolve(agentsYmlPath),
      );

      // 2. agents/test-role.yaml (takes precedence over agents/test-role.yml)
      const agentsYamlPath = join(agentsDir, "test-role.yaml");
      writeFileSync(agentsYamlPath, "name: agents-yaml\n", "utf-8");

      expect(VerbatimRoleInjector.resolveManifestPath(scratch, "test-role")).toBe(
        resolve(agentsYamlPath),
      );

      // 3. olt/agents/test-role.yml (takes precedence over agents/*)
      const oltAgentsDir = join(scratch, "olt", "agents");
      mkdirSync(oltAgentsDir, { recursive: true });
      const oltAgentsYmlPath = join(oltAgentsDir, "test-role.yml");
      writeFileSync(oltAgentsYmlPath, "name: olt-agents-yml\n", "utf-8");

      expect(VerbatimRoleInjector.resolveManifestPath(scratch, "test-role")).toBe(
        resolve(oltAgentsYmlPath),
      );

      // 4. olt/agents/test-role.yaml (highest precedence)
      const oltAgentsYamlPath = join(oltAgentsDir, "test-role.yaml");
      writeFileSync(oltAgentsYamlPath, "name: olt-agents-yaml\n", "utf-8");

      expect(VerbatimRoleInjector.resolveManifestPath(scratch, "test-role")).toBe(
        resolve(oltAgentsYamlPath),
      );
    });
  });

  describe("loadVerbatimManifestContent", () => {
    it("returns exact string content of manifest without modification", () => {
      const mindContent = VerbatimRoleInjector.loadVerbatimManifestContent(REPO_ROOT, "mind");
      const expectedMind = readFileSync(resolve(REPO_ROOT, "olt", "agents", "mind.yaml"), "utf-8");
      expect(mindContent).toBe(expectedMind);

      const orchContent = VerbatimRoleInjector.loadVerbatimManifestContent(
        REPO_ROOT,
        "orchestrator",
      );
      const expectedOrch = readFileSync(
        resolve(REPO_ROOT, "olt", "agents", "orchestrator.yaml"),
        "utf-8",
      );
      expect(orchContent).toBe(expectedOrch);
    });

    it("throws HarnessError when loading non-existent manifest", () => {
      expect(() => {
        VerbatimRoleInjector.loadVerbatimManifestContent(REPO_ROOT, "phantom-role");
      }).toThrow(HarnessError);
    });
  });

  describe("buildInjectionPrompt", () => {
    it("produces Mode A prompt when role === 'mind' and pendingBacklogCount === 0", () => {
      const telemetry: StagnationTelemetry = {
        agentId: "agent-mind-001",
        conversationId: "conv-12345",
        role: "mind",
        idleDurationSeconds: 150,
        pendingBacklogCount: 0,
        pendingPlanCount: 0,
        unresolvedDefectCount: 2,
        lastActiveTimestamp: "2026-08-24T05:00:00Z",
      };

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(REPO_ROOT, "mind", telemetry);

      expect(prompt).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");
      expect(prompt).toContain("CRITICAL SUPERVISORY ALERT: Live Stagnation Detected (>120s Idle)");
      expect(prompt).toContain("Role: mind | Agent: agent-mind-001 | Idle Duration: 150s");
      expect(prompt).toContain("Pending Backlog: 0 | Unresolved Defects: 2");
      expect(prompt).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE (Backlog Queue Empty)");
      expect(prompt).toContain("You have been stagnant/idle for 150s with an empty backlog.");
      expect(prompt).toContain("1. Execute non-idle creative task discovery across the codebase.");
      expect(prompt).toContain("2. Scan for TypeScript `any` or compiler suppression violations.");
      expect(prompt).toContain(
        "3. Audit Charter invariants, historical blunders in .olt/defects.jsonl, and edge case resilience.",
      );
      expect(prompt).toContain(
        "4. Admit new self-evolution candidate tasks via `mind:admit` with Brent Work/Span ($P = W/S$) analysis.",
      );
      expect(prompt).toContain(
        "5. Never pause admitted tasks; dispatch immediately to Orchestrators.",
      );
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/mind.yaml) ===");
      expect(prompt).toContain(
        readFileSync(resolve(REPO_ROOT, "olt", "agents", "mind.yaml"), "utf-8"),
      );
      expect(prompt).toContain("Execute your verbatim role instructions immediately.");
    });

    it("produces Mode B prompt when role === 'mind' and pendingBacklogCount > 0", () => {
      const telemetry: StagnationTelemetry = {
        agentId: "agent-mind-002",
        role: "mind",
        idleDurationSeconds: 180,
        pendingBacklogCount: 4,
        pendingPlanCount: 1,
        unresolvedDefectCount: 0,
      };

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(REPO_ROOT, "mind", telemetry);

      expect(prompt).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");
      expect(prompt).toContain("Role: mind | Agent: agent-mind-002 | Idle Duration: 180s");
      expect(prompt).toContain("Pending Backlog: 4 | Unresolved Defects: 0");
      expect(prompt).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
      expect(prompt).toContain(
        "You have been stagnant/idle for 180s with 4 pending backlog items.",
      );
      expect(prompt).toContain(
        "1. Decompose and admit pending backlog items into execution waves.",
      );
      expect(prompt).toContain(
        "2. Calculate Brent concurrency $P = \\lceil W / S \\rceil$ and dispatch disjoint lanes in parallel.",
      );
      expect(prompt).toContain("3. Supervise active runs and enforce 1-hop micro-cycle repairs.");
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/mind.yaml) ===");
    });

    it("produces Mode B prompt for non-mind roles even when pendingBacklogCount === 0", () => {
      const telemetry: StagnationTelemetry = {
        agentId: "agent-orch-001",
        role: "orchestrator",
        idleDurationSeconds: 130,
        pendingBacklogCount: 0,
        pendingPlanCount: 0,
        unresolvedDefectCount: 1,
      };

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(
        REPO_ROOT,
        "orchestrator",
        telemetry,
      );

      expect(prompt).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");
      expect(prompt).toContain("Role: orchestrator | Agent: agent-orch-001 | Idle Duration: 130s");
      expect(prompt).toContain("Pending Backlog: 0 | Unresolved Defects: 1");
      expect(prompt).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
      expect(prompt).toContain(
        "You have been stagnant/idle for 130s with 0 pending backlog items.",
      );
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/orchestrator.yaml) ===");
      expect(prompt).toContain(
        readFileSync(resolve(REPO_ROOT, "olt", "agents", "orchestrator.yaml"), "utf-8"),
      );
    });
  });

  describe("class instantiation", () => {
    it("can be instantiated and constructor executed", () => {
      const injector = new VerbatimRoleInjector();
      expect(injector).toBeDefined();
      expect(injector instanceof VerbatimRoleInjector).toBe(true);
    });
  });
});
