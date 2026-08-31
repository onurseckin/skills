import { describe, expect, it } from "bun:test";
import {
  COGNITIVE_DIRECTIVE_DIMENSIONS,
  CognitiveDirectiveGenerator,
  assessStagnationState,
  extractContextAnchors,
  formatDirectiveMarkdown,
  generateAntiStagnationTriggers,
  generateCognitiveDirective,
  generateCognitiveSchedulerPrompt,
  generateCognitiveSteps,
  generateProbingDirective,
  selectSocraticQuestions,
  SOCRATIC_CATALOG,
} from "../../../../olt/scripts/src/engine/scheduler/prompt/index.ts";
import {
  HOST_SCHEDULERS_MATRIX,
  assertHostThinkingPolicy,
  getAllHostSchedulers,
  getHostSchedulerConfig,
  isHighThinkingEnforced,
  resolveModelForTier,
  validateHostSchedulerConfig,
  type HostSchedulerConfig,
} from "../../../../olt/scripts/src/orchestrator/host-schedulers.ts";
import {
  AdaptiveTimerController,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  applyIntervalJitter,
  calculateBackoffWithStrategy,
  calculateExponentialBackoff,
  computeAntiIdleInterval,
  extractTrailingValueSeriesFromEvents,
  extractTrailingValueSeriesFromState,
  formatIntervalDuration,
  formatRawValueSeries,
  generateTrailingValueSeries,
  parseDuration,
  parseIntervalDuration,
  projectIntervalProgression,
  type TrailingValuePoint,
} from "../../../../olt/scripts/src/core/scheduling/index.ts";
import { executePulseTick } from "../../../../olt/scripts/src/engine/scheduler/feedback/pulse-core.ts";
import type { TransactionPort } from "../../../../olt/scripts/src/workflow/types.ts";

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
      expect(() => assertHostThinkingPolicy(invalidConfig)).toThrow("violates high thinking policy");

      const validation = validateHostSchedulerConfig(invalidConfig);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Tier 0-2 thinking must be "high"'))).toBe(
        true,
      );
      expect(validation.errors.some((e) => e.includes("SLA"))).toBe(true);
    });
  });

  describe("Interval Scheduling Computations", () => {
    it("computes immediate rollover when active work is present", () => {
      const immediate1 = computeAntiIdleInterval({ hasPendingWork: true, zeroValueStreak: 5 });
      expect(immediate1.isImmediate).toBe(true);
      expect(immediate1.intervalMs).toBe(0);
      expect(immediate1.zeroValueStreak).toBe(0);

      const immediate2 = computeAntiIdleInterval({ active: true, zeroValueStreak: 3 });
      expect(immediate2.isImmediate).toBe(true);
      expect(immediate2.intervalMs).toBe(0);
      expect(immediate2.zeroValueStreak).toBe(0);
    });

    it("computes retry-after backoff intervals correctly", () => {
      const res = computeAntiIdleInterval({
        retryAfterMs: 45_000,
        zeroValueStreak: 2,
        applyJitter: false,
      });
      expect(res.isImmediate).toBe(false);
      expect(res.intervalMs).toBe(45_000);
      expect(res.rawIntervalMs).toBe(45_000);
      expect(res.zeroValueStreak).toBe(3);
    });

    it("computes rate limit backoff doubling previous interval", () => {
      const res = computeAntiIdleInterval({
        isRateLimited: true,
        previousIntervalMs: 20_000,
        applyJitter: false,
      });
      expect(res.isImmediate).toBe(false);
      expect(res.intervalMs).toBe(40_000);
      expect(res.rawIntervalMs).toBe(40_000);
    });

    it("computes exponential quiescence backoff", () => {
      const res0 = computeAntiIdleInterval({
        zeroValueStreak: 0,
        baseIntervalMs: 10_000,
        applyJitter: false,
      });
      expect(res0.intervalMs).toBe(10_000);

      const res1 = computeAntiIdleInterval({
        zeroValueStreak: 1,
        baseIntervalMs: 10_000,
        applyJitter: false,
      });
      expect(res1.intervalMs).toBe(15_000);

      const res2 = computeAntiIdleInterval({
        zeroValueStreak: 2,
        baseIntervalMs: 10_000,
        applyJitter: false,
      });
      expect(res2.intervalMs).toBe(22_500);
    });

    it("formats and parses interval durations safely", () => {
      expect(formatIntervalDuration(0)).toBe("0ms");
      expect(formatIntervalDuration(500)).toBe("500ms");
      expect(formatIntervalDuration(5_000)).toBe("5s");
      expect(formatIntervalDuration(60_000)).toBe("1m");
      expect(formatIntervalDuration(65_000)).toBe("1m 5s");
      expect(formatIntervalDuration(3_665_000)).toBe("1h 1m");

      expect(parseDuration("500ms")).toBe(500);
      expect(parseDuration("10s")).toBe(10_000);
      expect(parseDuration("5m")).toBe(300_000);
      expect(parseDuration("2h")).toBe(7_200_000);
      expect(parseDuration("1d")).toBe(86_400_000);
      expect(parseDuration(1500)).toBe(1500);

      expect(parseIntervalDuration("0")).toBe(0);
      expect(parseIntervalDuration("0s")).toBe(0);
      expect(parseIntervalDuration("30s")).toBe(30_000);

      expect(() => parseDuration("invalid")).toThrow("invalid duration format");
      expect(() => parseDuration(-10)).toThrow("must be non-negative");
    });

    it("projects interval progressions across multiple backoff strategies", () => {
      const expProg = projectIntervalProgression(10_000, 100_000, 4, "exponential");
      expect(expProg.length).toBe(4);
      expect(expProg[0]).toBe(10_000);
      expect(expProg[1]).toBe(15_000);
      expect(expProg[2]).toBe(22_500);

      const linProg = projectIntervalProgression(10_000, 100_000, 4, "linear");
      expect(linProg[0]).toBe(10_000);
      expect(linProg[1]).toBe(20_000);
      expect(linProg[2]).toBe(30_000);

      const fixedProg = projectIntervalProgression(10_000, 100_000, 3, "fixed");
      expect(fixedProg).toEqual([10_000, 10_000, 10_000]);

      const immProg = projectIntervalProgression(10_000, 100_000, 3, "immediate");
      expect(immProg).toEqual([0, 0, 0]);
    });

    it("generates trailing value series statistics from pulse points", () => {
      const points: TrailingValuePoint[] = [
        { pulseId: "p1", outcome: "task_completed", value: 10 },
        { pulseId: "p2", outcome: "task_completed", value: 5 },
        { pulseId: "p3", outcome: "quiescent", value: 0 },
        { pulseId: "p4", outcome: "quiescent", value: 0 },
      ];

      const series = generateTrailingValueSeries(points, 20);
      expect(series.rawValues).toEqual([10, 5, 0, 0]);
      expect(series.totalValue).toBe(15);
      expect(series.meanValue).toBe(3.75);
      expect(series.trailingZeroStreak).toBe(2);
      expect(series.isFlatZero).toBe(false);
      expect(series.formattedSeries).toBe("[10, 5, 0, 0]");
      expect(formatRawValueSeries(series.rawValues)).toBe("[10, 5, 0, 0]");
      expect(series.markdown).toContain("Trailing Value Series");
    });

    it("extracts trailing value series from state object", () => {
      const stateMock = {
        pulse: {
          history: [
            { pulse_id: "p1", value: 1, outcome: "admitted", closed_at: "2026-08-31T00:00:00Z" },
            { pulse_id: "p2", value: 0, outcome: "quiescent", closed_at: "2026-08-31T00:05:00Z" },
          ],
        },
      };

      const series = extractTrailingValueSeriesFromState(stateMock, 10);
      expect(series.points.length).toBe(2);
      expect(series.totalValue).toBe(1);
      expect(series.trailingZeroStreak).toBe(1);
    });

    it("extracts trailing value series from event log", () => {
      const eventsMock = [
        { kind: "other-event", payload: {} },
        {
          kind: "mind-pulse-closed",
          payload: { pulse_id: "p-ev-1", value: 4, outcome: "dispatched" },
          timestamp: "2026-08-31T00:00:00Z",
        },
        {
          kind: "mind-pulse-closed",
          payload: { pulse_id: "p-ev-2", value: 0, outcome: "quiescent" },
          timestamp: "2026-08-31T00:05:00Z",
        },
      ];

      const series = extractTrailingValueSeriesFromEvents(eventsMock, 10);
      expect(series.points.length).toBe(2);
      expect(series.totalValue).toBe(4);
      expect(series.trailingZeroStreak).toBe(1);
    });

    it("manages adaptive timer state and adjustments", () => {
      const timer = new AdaptiveTimerController({
        minIntervalMs: 5_000,
        maxIntervalMs: 60_000,
        backoffFactor: 2.0,
        activityBoost: 0.5,
        initialIntervalMs: 10_000,
      });

      expect(timer.currentIntervalMs).toBe(10_000);
      expect(timer.isAdaptive()).toBe(true);

      const adjBackoff = timer.recordIdlePulse();
      expect(adjBackoff.newIntervalMs).toBe(20_000);
      expect(adjBackoff.reason).toBe("idle_backoff");

      const adjBoost = timer.recordActivePulse();
      expect(adjBoost.newIntervalMs).toBe(10_000);
      expect(adjBoost.reason).toBe("activity_burst");

      const reset = timer.resetInterval();
      expect(reset.reason).toBe("manual_reset");
    });
  });

  describe("Feedback Pulse Integration with Cognitive Directives", () => {
    it("attaches rich cognitive probing directive to executePulseTick", () => {
      let stateData: Record<string, unknown> = {
        graph: { edges: [], nodes: [] },
        requirements: {
          requirements: [
            {
              id: "req-1",
              disposition: "actionable",
              status: "planned",
            },
          ],
        },
        tasks: {
          "task-1": {
            id: "task-1",
            status: "ready",
            priority: 50,
            effort: 1,
            created_order: 1,
            write_scope: ["src/file.ts"],
            resource_scope: [],
            requirement_ids: ["req-1"],
            dependencies: [],
          },
        },
        agents: [],
      };

      const portMock: TransactionPort = {
        read: () => stateData,
        transact: (_actor, _kind, _payload, fn) => {
          const draft = JSON.parse(JSON.stringify(stateData)) as Record<string, unknown>;
          fn(draft);
          stateData = draft;
          return draft;
        },
      };

      const result = executePulseTick(portMock, {
        tickNumber: 1,
        preferredDimension: "architecture_simplification",
      });

      expect(result.tickNumber).toBe(1);
      expect(result.cognitiveDirective).toBeDefined();
      expect(result.cognitiveDirective?.dimension).toBe("architecture_simplification");
      expect(result.cognitivePrompt).toBeDefined();
      expect(result.cognitivePrompt).toContain("ARCHITECTURAL PRUNING");
    });
  });
});
