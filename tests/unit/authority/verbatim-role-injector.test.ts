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

    it("falls back to the installed skill role manifest when a product repository has only an owner charter", () => {
      const productRepo = scratchRoot(import.meta.path, "owner-charter-global-role");
      const charterPath = join(productRepo, ".olt", "charter.yaml");
      mkdirSync(join(productRepo, ".olt"), { recursive: true });
      writeFileSync(charterPath, "identity: Product owner charter\n", "utf-8");

      const resolved = VerbatimRoleInjector.resolveManifestPath(productRepo, "mind");
      expect(resolved).toBe(resolve(REPO_ROOT, "olt", "agents", "mind.yaml"));

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(productRepo, "mind", {
        agentId: "mind_limo_gen_3",
        role: "mind",
        idleDurationSeconds: 121,
        pendingBacklogCount: 0,
        pendingPlanCount: 0,
        unresolvedDefectCount: 0,
      });
      expect(prompt).toContain("=== OWNER MIND CHARTER (.olt/charter.yaml) ===");
      expect(prompt).toContain("identity: Product owner charter");
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

  describe("buildMindInitializationPrompt", () => {
    it("produces Mode A initialization prompt by default when backlog count is 0 or omitted", () => {
      const expectedMind = readFileSync(resolve(REPO_ROOT, "olt", "agents", "mind.yaml"), "utf-8");
      const prompt = VerbatimRoleInjector.buildMindInitializationPrompt(REPO_ROOT);

      expect(prompt).toContain("[MIND_INITIALIZATION_VERBATIM_MANIFEST_INJECTION]");
      expect(prompt).toContain(
        "CRITICAL SUPERVISORY INITIALIZATION: Mind Autonomous Consciousness Ignition",
      );
      expect(prompt).toContain("Mind ID: mind-gen-1 | Generation: 1");
      expect(prompt).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE (Backlog Queue Empty)");
      expect(prompt).toContain("INITIALIZATION DIRECTIVES:");
      expect(prompt).toContain(
        "1. Autonomously wake from olt/agents/mind.yaml without human prompts or instructions.",
      );
      expect(prompt).toContain(
        "2. Observe active system health, doctor reports, and candidate queues.",
      );
      expect(prompt).toContain(
        "3. If feedback queue is empty (0 pending items), execute Mode A autonomous discovery:",
      );
      expect(prompt).toContain(
        "Scan codebase for TypeScript `any` or compiler suppression violations.",
      );
      expect(prompt).toContain(
        "Admit new self-evolution candidate tasks via `mind:admit` with Brent Work/Span ($P = W/S$) analysis.",
      );
      expect(prompt).toContain(
        "4. Atomically convert admitted candidates to dispatched tasks with 1:1 isolated implementer-validator allocations.",
      );
      expect(prompt).toContain(
        "5. Operate indefinitely as an infinite autonomous loop (`mind:pulse`); never exit or sit idle.",
      );
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/mind.yaml) ===");
      expect(prompt).toContain(expectedMind);
      expect(prompt).toContain("Execute your verbatim role instructions immediately.");
    });

    it("verifies verbatim manifest injection contains complete charter, 16 pillars, permissions, and Product Owner mandate", () => {
      const prompt = VerbatimRoleInjector.buildMindInitializationPrompt(REPO_ROOT, {
        mindId: "mind-gen-2",
        generation: 2,
        runRoot: "/path/to/capsule",
        charterSourcePath: "olt/agents/mind.yaml",
      });

      expect(prompt).toContain(
        "Mind ID: mind-gen-2 | Generation: 2 | Capsule Root: /path/to/capsule | Charter Source: olt/agents/mind.yaml",
      );

      // Charter Verification
      expect(prompt).toContain("charter:");
      expect(prompt).toContain(
        'identity: "The autonomous maintenance, verification, and hardening mind',
      );
      expect(prompt).toContain("G1");
      expect(prompt).toContain("Continuously ensure 0 TypeScript any");
      expect(prompt).toContain("G2");
      expect(prompt).toContain("Maintain strict multi-agent orchestration invariants");
      expect(prompt).toContain("G3");
      expect(prompt).toContain("Preserve repository integrity");

      // 16 Cognitive Pillars Verification
      expect(prompt).toContain("Pillar 1: CLI-First Token Leverage");
      expect(prompt).toContain("Pillar 2: Visual Truth & Radical Observability");
      expect(prompt).toContain("Pillar 3: Thread Authority & Zero Main-Thread Spillover");
      expect(prompt).toContain("Pillar 4: Perpetual Self-Evolution");
      expect(prompt).toContain("Pillar 5: Graph Visualizer UI & External Interoperability");
      expect(prompt).toContain("Pillar 6: First-Principles Innovation & Radical Simplification");
      expect(prompt).toContain("Pillar 7: Infinite Borderless Cadence & Topological Concurrency");
      expect(prompt).toContain(
        "Pillar 8: Autonomic Self-Recovery & Non-Idle In-Progress Resumption",
      );
      expect(prompt).toContain("Pillar 9: Strategic Brain & Hyper-Active Proactive Cognition");
      expect(prompt).toContain("Pillar 10: Mind Queue Domain & Cognitive Memory Persistence");
      expect(prompt).toContain("Pillar 11: Generation 5 Mindful Infusion");
      expect(prompt).toContain(
        "Pillar 12: Infinite Mind Product Owner Mode & Atomic Admission-to-Dispatch Chaining",
      );
      expect(prompt).toContain("Pillar 13: Active 4-Tier Hierarchical Parent-Child Supervision");
      expect(prompt).toContain("Pillar 14: Script-Backed Scheduler Diagnostics Engine");
      expect(prompt).toContain("Pillar 15: Autonomous Wakeup & Operational Grounding");
      expect(prompt).toContain("Pillar 16: Quota Freeze & Cron Suspension");

      // Permissions Verification
      expect(prompt).toContain("permissions:");
      expect(prompt).toContain("may:");
      expect(prompt).toContain("must_not:");
      expect(prompt).toContain("SUPERVISOR_ZERO_CODE_EDITS");
      expect(prompt).toContain("ANTI_BATCHING_ISOLATION");
      expect(prompt).toContain("QUOTA_FREEZE_ZERO_KILL_RESUME");
    });

    it("produces Mode B initialization prompt when pendingBacklogCount > 0", () => {
      const prompt = VerbatimRoleInjector.buildMindInitializationPrompt(REPO_ROOT, {
        mindId: "mind-gen-3",
        generation: 3,
        pendingBacklogCount: 5,
      });

      expect(prompt).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
      expect(prompt).toContain(
        "2. Ingest 5 pending backlog items from feedback-queue.jsonl and evaluate against 6 Admission Gates.",
      );
      expect(prompt).toContain(
        "3. Calculate Brent Work/Span concurrency $P = \\lceil W / S \\rceil$ and dispatch disjoint lanes in parallel.",
      );
      expect(prompt).toContain(
        "4. Direct Tier 1 Orchestrator exclusively; enforce 1:1 isolated task allocations (Anti-Batching Rule).",
      );
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/mind.yaml) ===");
    });

    it("respects explicit mode override flag", () => {
      const promptModeB = VerbatimRoleInjector.buildMindInitializationPrompt(REPO_ROOT, {
        pendingBacklogCount: 0,
        mode: "B",
      });
      expect(promptModeB).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");

      const promptModeA = VerbatimRoleInjector.buildMindInitializationPrompt(REPO_ROOT, {
        pendingBacklogCount: 10,
        mode: "A",
      });
      expect(promptModeA).toContain(
        "MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE (Backlog Queue Empty)",
      );
    });
  });

  describe("buildInitializationPrompt", () => {
    it("routes role === 'mind' to buildMindInitializationPrompt", () => {
      const prompt = VerbatimRoleInjector.buildInitializationPrompt(REPO_ROOT, "mind", {
        agentId: "custom-mind-id",
        runRoot: "/run/root/test",
        mode: "A",
      });

      expect(prompt).toContain("[MIND_INITIALIZATION_VERBATIM_MANIFEST_INJECTION]");
      expect(prompt).toContain("Mind ID: custom-mind-id");
      expect(prompt).toContain("Capsule Root: /run/root/test");
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/mind.yaml) ===");
    });

    it("formats role initialization for orchestrator with verbatim orchestrator manifest", () => {
      const expectedOrch = readFileSync(
        resolve(REPO_ROOT, "olt", "agents", "orchestrator.yaml"),
        "utf-8",
      );
      const prompt = VerbatimRoleInjector.buildInitializationPrompt(REPO_ROOT, "orchestrator", {
        agentId: "orchestrator-1",
        runRoot: "/run/root/orch",
        taskId: "task-release-1",
      });

      expect(prompt).toContain("[ROLE_INITIALIZATION_VERBATIM_MANIFEST_INJECTION]");
      expect(prompt).toContain("SUPERVISORY ROLE INITIALIZATION: ORCHESTRATOR");
      expect(prompt).toContain(
        "Agent ID: orchestrator-1 | Capsule Root: /run/root/orch | Task: task-release-1",
      );
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/orchestrator.yaml) ===");
      expect(prompt).toContain(expectedOrch);
      expect(prompt).toContain("Execute your verbatim role instructions immediately.");
    });

    it("formats role initialization for coordinator with verbatim coordinator manifest", () => {
      const expectedCoord = readFileSync(
        resolve(REPO_ROOT, "olt", "agents", "coordinator.yaml"),
        "utf-8",
      );
      const prompt = VerbatimRoleInjector.buildInitializationPrompt(REPO_ROOT, "coordinator", {
        agentId: "coordinator-1",
      });

      expect(prompt).toContain("[ROLE_INITIALIZATION_VERBATIM_MANIFEST_INJECTION]");
      expect(prompt).toContain("SUPERVISORY ROLE INITIALIZATION: COORDINATOR");
      expect(prompt).toContain("Agent ID: coordinator-1");
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/coordinator.yaml) ===");
      expect(prompt).toContain(expectedCoord);
    });

    it("throws HarnessError when given unknown role", () => {
      expect(() => {
        VerbatimRoleInjector.buildInitializationPrompt(REPO_ROOT, "unknown-role-xyz");
      }).toThrow(HarnessError);
    });
  });

  describe("buildSubagentSystemPrompt", () => {
    it("builds subagent system prompt with verbatim manifest for implementer", () => {
      const expectedImpl = readFileSync(
        resolve(REPO_ROOT, "olt", "agents", "implementer.yaml"),
        "utf-8",
      );
      const prompt = VerbatimRoleInjector.buildSubagentSystemPrompt(REPO_ROOT, "implementer", {
        customInstructions: "Mandate zero TypeScript any and zero compiler suppressions.",
      });

      expect(prompt).toContain("[SUBAGENT_VERBATIM_SYSTEM_PROMPT: IMPLEMENTER]");
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/implementer.yaml) ===");
      expect(prompt).toContain(expectedImpl);
      expect(prompt).toContain(
        "ADDITIONAL INSTRUCTIONS:\nMandate zero TypeScript any and zero compiler suppressions.",
      );
      expect(prompt).toContain(
        "You must strictly execute within your declared role boundaries, permissions, and invariants.",
      );
    });

    it("builds subagent system prompt without custom instructions", () => {
      const prompt = VerbatimRoleInjector.buildSubagentSystemPrompt(REPO_ROOT, "validator");
      expect(prompt).toContain("[SUBAGENT_VERBATIM_SYSTEM_PROMPT: VALIDATOR]");
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/validator.yaml) ===");
      expect(prompt).not.toContain("ADDITIONAL INSTRUCTIONS:");
    });
  });

  describe("buildSubagentDispatchPrompt", () => {
    it("builds subagent dispatch prompt with task prompt, write scope, exact anchors, and verbatim manifest", () => {
      const expectedImpl = readFileSync(
        resolve(REPO_ROOT, "olt", "agents", "implementer.yaml"),
        "utf-8",
      );
      const prompt = VerbatimRoleInjector.buildSubagentDispatchPrompt(
        REPO_ROOT,
        "implementer",
        "Implement candidate 3 verbatim injection",
        {
          agentId: "implementer-1",
          taskId: "task-1",
          runRoot: "/run/root/test",
          writeScope: ["olt/scripts/src/authority/verbatim-role-injector.ts"],
          exactAnchorBriefing: "Anchor: interface StagnationTelemetry (lines 6-15)",
        },
      );

      expect(prompt).toContain("[SUBAGENT_DISPATCH_MANDATE: IMPLEMENTER]");
      expect(prompt).toContain(
        "DISPATCH COORDINATES: Agent: implementer-1 | Task: task-1 | Capsule Root: /run/root/test",
      );
      expect(prompt).toContain("TASK PROMPT:\nImplement candidate 3 verbatim injection");
      expect(prompt).toContain(
        "ASSIGNED WRITE SCOPE:\n- olt/scripts/src/authority/verbatim-role-injector.ts",
      );
      expect(prompt).toContain(
        "EXACT-ANCHOR BRIEFING:\nAnchor: interface StagnationTelemetry (lines 6-15)",
      );
      expect(prompt).toContain("=== VERBATIM ROLE MANIFEST (olt/agents/implementer.yaml) ===");
      expect(prompt).toContain(expectedImpl);
      expect(prompt).toContain(
        "Execute your verbatim role instructions and task requirements immediately.",
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
