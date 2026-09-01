import { describe, expect, it } from "bun:test";
import {
  COGNITIVE_DIRECTIVE_DIMENSIONS,
  assessStagnationState,
  extractContextAnchors,
  generateAntiStagnationTriggers,
  generateCognitiveDirective,
  generateCognitiveSchedulerPrompt,
  generateCognitiveSteps,
  generateProbingDirective,
  selectSocraticQuestions,
  SOCRATIC_CATALOG,
} from "../../../olt/scripts/src/engine/scheduler/prompt/index.ts";
import {
  assertHostThinkingPolicy,
  getAllHostSchedulers,
  getHostSchedulerConfig,
  isHighThinkingEnforced,
  resolveModelForTier,
  validateHostSchedulerConfig,
  type HostSchedulerConfig,
} from "../../../olt/scripts/src/orchestrator/host-schedulers.ts";

describe("Cognitive Scheduler & Probing Directives", () => {
  describe("Prompt Subsystem & Directive Generators", () => {
    it("generates a structured cognitive probing directive with all required fields", () => {
      const directive = generateCognitiveDirective({
        tickNumber: 1,
        cycleIndex: 1,
        preferredDimension: "socratic_forensics",
      });

      expect(directive.id).toContain("cog-dir-1-socratic");
      expect(directive.tickNumber).toBe(1);
      expect(directive.cycleIndex).toBe(1);
      expect(directive.dimension).toBe("socratic_forensics");
      expect(directive.title).toBe(SOCRATIC_CATALOG.socratic_forensics.title);
      expect(directive.strategicDirective).toBe(
        SOCRATIC_CATALOG.socratic_forensics.strategicDirective,
      );
      expect(directive.socraticQuestions.length).toBeGreaterThan(0);
      expect(directive.steps.length).toBeGreaterThan(0);
      expect(directive.actionableImperatives.length).toBeGreaterThan(0);
      expect(directive.contextAnchors.length).toBeGreaterThan(0);
      expect(directive.formattedMarkdown).toContain("COGNITIVE SCHEDULER PROBING DIRECTIVE");
      expect(directive.formattedMarkdown).toContain("STRATEGIC DIRECTIVE");
      expect(directive.formattedMarkdown).toContain("FUNDAMENTAL SOCRATIC INQUIRIES");
      expect(directive.formattedMarkdown).toContain("MULTI-STEP ACTIONABLE EXECUTION PATHWAY");
    });

    it("ensures prompt non-monotone variance across different scheduler cycles", () => {
      const dir1 = generateCognitiveDirective({ tickNumber: 1, cycleIndex: 1 });
      const dir2 = generateCognitiveDirective({ tickNumber: 2, cycleIndex: 2 });
      const dir3 = generateCognitiveDirective({ tickNumber: 3, cycleIndex: 3 });

      expect(dir1.dimension).not.toBe(dir2.dimension);
      expect(dir2.dimension).not.toBe(dir3.dimension);
      expect(dir1.id).not.toBe(dir2.id);
      expect(dir1.formattedMarkdown).not.toBe(dir2.formattedMarkdown);
    });

    it("supports all declared cognitive directive dimensions", () => {
      for (const dimension of COGNITIVE_DIRECTIVE_DIMENSIONS) {
        const directive = generateCognitiveDirective({
          tickNumber: 10,
          preferredDimension: dimension,
        });
        expect(directive.dimension).toBe(dimension);
        expect(directive.title).toBe(SOCRATIC_CATALOG[dimension].title);
        expect(directive.steps.length).toBeGreaterThan(0);
      }
    });

    it("generates anti-stagnation shock directives on persistent zero-value streaks", () => {
      const assessment = assessStagnationState({
        zeroValueStreak: 6,
        stagnant: true,
      });
      expect(assessment.isStagnant).toBe(true);
      expect(assessment.severity).toBe("emergency");

      const triggers = generateAntiStagnationTriggers({
        zeroValueStreak: 6,
        stagnant: true,
      });
      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0]?.severity).toBe("emergency");
      expect(triggers[0]?.imperativeAction).toContain("Mode A Autonomous Product Manager");

      const directive = generateCognitiveDirective({
        tickNumber: 5,
        zeroValueStreak: 6,
        stagnant: true,
      });
      expect(directive.dimension).toBe("anti_stagnation_intervention");
      expect(directive.formattedMarkdown).toContain("ANTI-STAGNATION TRIGGERS");
    });

    it("generates multi-step execution steps with required proofs and forbidden shortcuts", () => {
      const steps = generateCognitiveSteps("multi_step_execution");
      expect(steps.length).toBe(4);
      expect(steps[0]?.title).toBe("Task Boundary & Scope Lock");
      expect(steps[0]?.requiredProof).toBeDefined();
      expect(steps[0]?.forbiddenShortcuts?.length).toBeGreaterThan(0);
      expect(steps[2]?.title).toBe("Unit & Gate Verification");
      expect(steps[3]?.title).toBe("Evidence & Submission Report");
    });

    it("extracts context anchors with strict invariant and model tier mandates", () => {
      const stateMock = {
        tasks: {
          "task-1": { status: "done" },
          "task-2": { status: "ready" },
          "task-3": { status: "leased" },
        },
      };
      const anchors = extractContextAnchors({
        state: stateMock,
        host: "claude_code",
        modelTier: "Tier 2 Coordinator",
        thinkingLevel: "high",
        zeroValueStreak: 3,
      });

      expect(anchors.some((a) => a.title.includes("Zero Suppressions"))).toBe(true);
      expect(anchors.some((a) => a.title.includes("5-Minute SLA"))).toBe(true);
      expect(anchors.some((a) => a.title.includes("CLAUDE_CODE"))).toBe(true);
      expect(anchors.some((a) => a.title.includes("Task Graph Topology"))).toBe(true);
      expect(anchors.some((a) => a.title.includes("Quiescence Tracker"))).toBe(true);
    });

    it("selects Socratic questions and applies rotation for variance", () => {
      const q1 = selectSocraticQuestions("socratic_forensics", { cycleIndex: 0 });
      const q2 = selectSocraticQuestions("socratic_forensics", { cycleIndex: 1 });
      expect(q1.length).toBeGreaterThan(0);
      expect(q2.length).toBeGreaterThan(0);
      expect(q1[0]?.question).toBeDefined();
      expect(q1[0]?.rationale).toBeDefined();
    });

    it("provides generateCognitiveSchedulerPrompt and generateProbingDirective aliases", () => {
      const prompt = generateCognitiveSchedulerPrompt({ tickNumber: 1 });
      expect(prompt).toContain("COGNITIVE SCHEDULER PROBING DIRECTIVE");
      const probing = generateProbingDirective({ tickNumber: 1 });
      expect(probing.id).toBeDefined();
    });
  });

  describe("Host Schedulers Matrix & Thinking Validation", () => {
    it("provides valid configurations for all registered hosts", () => {
      const hosts = getAllHostSchedulers();
      expect(hosts.length).toBe(4);
      expect(hosts.map((h) => h.host_id).sort()).toEqual(
        ["antigravity", "claude_code", "codex", "cursor"].sort(),
      );

      for (const host of hosts) {
        const config = getHostSchedulerConfig(host.host_id);
        expect(config).toBe(host);
        expect(isHighThinkingEnforced(config)).toBe(true);
        expect(() => assertHostThinkingPolicy(config)).not.toThrow();

        const validation = validateHostSchedulerConfig(config);
        expect(validation.isValid).toBe(true);
        expect(validation.errors.length).toBe(0);
      }
    });

    it("resolves model and thinking level for tier_0_2 vs tier_3", () => {
      const claude02 = resolveModelForTier("claude_code", "tier_0_2");
      expect(claude02.model).toBe("claude-5-opus");
      expect(claude02.thinking).toBe("high");

      const claude3 = resolveModelForTier("claude_code", "tier_3");
      expect(claude3.model).toBe("claude-5-sonnet");
      expect(claude3.thinking).toBe("medium");

      const gemini02 = resolveModelForTier("antigravity", "tier_0_2");
      expect(gemini02.model).toBe("gemini-3.7-flash");
      expect(gemini02.thinking).toBe("high");
    });

    it("throws on unknown host scheduler ID", () => {
      expect(() => getHostSchedulerConfig("invalid_host" as unknown as "antigravity")).toThrow(
        "Unknown host scheduler ID: invalid_host",
      );
    });

    it("validates host scheduler thinking policy violations", () => {
      const invalidConfig: HostSchedulerConfig = {
        host_id: "antigravity",
        default_cadence_seconds: 300,
        tier_0_2_model: "gemini-3.7-flash",
        tier_0_2_thinking: "low",
        tier_3_model: "gemini-3.7-flash",
        tier_3_thinking: "low",
        max_single_task_seconds: 600, // SLA violation
        heartbeat_tick_seconds: 60,
        watchdog_timeout_seconds: 300,
      };

      expect(isHighThinkingEnforced(invalidConfig)).toBe(false);
      expect(() => assertHostThinkingPolicy(invalidConfig)).toThrow(
        "violates high thinking policy",
      );

      const validation = validateHostSchedulerConfig(invalidConfig);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Tier 0-2 thinking must be "high"'))).toBe(
        true,
      );
      expect(validation.errors.some((e) => e.includes("SLA"))).toBe(true);
    });
  });
});
