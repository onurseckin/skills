import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MindAuditorEngine,
  SkillAuditorEngine,
  CognitiveUiCritiqueParser,
  OPTICAL_DIMENSIONS,
  OPTICAL_VIEWPORTS,
  type SkillAuditLiveResult,
} from "../../olt/scripts/src/mind/auditing/cognitive/index.ts";

describe("Mind Auditor Repository Governance, Anti-Stagnation & Critique Processing", () => {
  it("detects missing policy.json and records governance issue", () => {
    const testDir = join(
      tmpdir(),
      `test-mind-gov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(testDir, { recursive: true });

    try {
      const audit = MindAuditorEngine.auditRepositoryGovernance(testDir);
      expect(audit.policyValid).toBe(false);
      expect(audit.issues.length).toBeGreaterThan(0);
      expect(audit.issues.some((i) => i.toLowerCase().includes("policy"))).toBe(true);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("detects ungrounded simulated execution when pulse claims ignition but events sequence is <= 1", async () => {
    const testDir = join(
      tmpdir(),
      `test-sim-exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    const capsuleDir = join(testDir, ".olt", "capsules", "run-1");
    mkdirSync(capsuleDir, { recursive: true });

    await Bun.write(
      join(testDir, "last_pulse.json"),
      JSON.stringify({ at: new Date().toISOString() }),
    );

    await Bun.write(
      join(capsuleDir, "events.jsonl"),
      JSON.stringify({ sequence: 1, kind: "mind-initialized" }) + "\n",
    );

    try {
      const audit = MindAuditorEngine.auditRepositoryGovernance(testDir, capsuleDir);
      expect(audit.simulatedExecutionDetected).toBe(true);
      expect(audit.eventsProgressionValid).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Cognitive UI Critique Processing & Design Iterations", () => {
    it("exports all 8 Optical Dimensions and responsive viewports", () => {
      expect(OPTICAL_DIMENSIONS.length).toBe(8);
      expect(OPTICAL_DIMENSIONS).toContain("visual_hierarchy");
      expect(OPTICAL_DIMENSIONS).toContain("optical_spacing");
      expect(OPTICAL_DIMENSIONS).toContain("typography");
      expect(OPTICAL_DIMENSIONS).toContain("clipping_overflow");
      expect(OPTICAL_DIMENSIONS).toContain("contrast_fidelity");
      expect(OPTICAL_DIMENSIONS).toContain("theme_harmony");
      expect(OPTICAL_DIMENSIONS).toContain("z_index_overlay");
      expect(OPTICAL_DIMENSIONS).toContain("touch_targets");

      expect(OPTICAL_VIEWPORTS.length).toBe(4);
      expect(OPTICAL_VIEWPORTS.map((v) => v.id)).toEqual([
        "desktop_wide",
        "desktop",
        "tablet",
        "mobile",
      ]);
    });

    it("parses human-grade cognitive UI feedback into structured findings", () => {
      const critiqueText = `
        # Optical Inspection & Aesthetic Critique
        - Visual Hierarchy: The primary call-to-action button lacks visual dominance over secondary links on Desktop (1440x900).
        - Optical Spacing: Layout grid shows irregular 12px padding rhythm instead of 16px unit grid.
        - Contrast Fidelity: Subdued label text fails APCA contrast threshold (Lc < 45).
        - Touch Targets: Header icon buttons are only 36x36px on mobile (390x844), violating >= 44x44px ergonomic touch bounds.
        - Action: Increase CTA prominence and add Liquid Glass specular border.
        - Action: Standardize container padding rhythm to 16px baseline.
        - Action: Elevate muted text color to reach APCA Lc >= 60.
        - Action: Expand mobile icon touch targets to minimum 44x44px.
      `;

      const parsed = CognitiveUiCritiqueParser.parseCritique(critiqueText);

      expect(parsed.isHumanGrade).toBe(true);
      expect(parsed.dimensionsCovered.length).toBeGreaterThanOrEqual(4);
      expect(parsed.dimensionsCovered).toContain("visual_hierarchy");
      expect(parsed.dimensionsCovered).toContain("optical_spacing");
      expect(parsed.dimensionsCovered).toContain("contrast_fidelity");
      expect(parsed.dimensionsCovered).toContain("touch_targets");
      expect(parsed.findings.length).toBeGreaterThanOrEqual(4);
      expect(parsed.actionItems.length).toBe(4);
    });

    it("synthesizes actionable design iterations with concrete write scopes and verification gates", () => {
      const critiqueText = `
        - Typography: Headings clip container bounds on Mobile (390px) due to fixed 32px line-height.
        - Touch Targets: Action buttons have 40px touch bounding box. Must be >= 44px for general touch and >= 48px for cockpit HUD.
        - Action: Switch line-height to relative 1.25em and allow responsive wrapping.
        - Action: Pad touch bounds to 44x44px with touch-target pseudos.
      `;

      const parsed = MindAuditorEngine.parseUiCritique(critiqueText);
      const iterations = MindAuditorEngine.synthesizeDesignIterations(parsed);

      expect(iterations.length).toBeGreaterThanOrEqual(2);
      for (const iter of iterations) {
        expect(iter.id).toMatch(/^task-ui-iteration-/);
        expect(iter.writeScope.length).toBeGreaterThan(0);
        expect(iter.gate).toContain("bun test");
        expect(iter.acceptanceCriteria.length).toBeGreaterThan(0);
      }

      const feedbackItems = MindAuditorEngine.critiqueToFeedbackItems(parsed);
      expect(feedbackItems.length).toBe(iterations.length);
      expect(feedbackItems[0]?.status).toBe("PENDING");
      expect(feedbackItems[0]?.category).toBe("VALIDATION");
    });
  });

  describe("Skill Auditor 1-Min Cadence & Zero-Delta Message Suppression", () => {
    it("enforces 1-min tracking cadence constant (60s / 60,000ms)", () => {
      expect(SkillAuditorEngine.DEFAULT_CADENCE_INTERVAL_SECONDS).toBe(60);
      expect(SkillAuditorEngine.DEFAULT_CADENCE_INTERVAL_MS).toBe(60_000);
    });

    it("detects zero-delta state when fleet is converged at rest with 0 events and 0 incidents", () => {
      const baseReport: SkillAuditLiveResult = {
        compliant: true,
        incidents: [],
        defectsLogged: 0,
        interjectionsSent: 0,
        cursor: {
          lastInspectedTimestamp: new Date().toISOString(),
          lastInspectedEventIndex: 10,
        },
        eventsAnalyzed: 0,
        timestamp: new Date().toISOString(),
      };

      const delta = SkillAuditorEngine.compareSkillReportDelta(baseReport, baseReport);
      expect(delta.isZeroDelta).toBe(true);
      expect(delta.suppressed).toBe(true);
      expect(delta.summary).toContain("Zero-delta state detected");
      expect(SkillAuditorEngine.isZeroDeltaReport(baseReport, baseReport)).toBe(true);

      const suppressed = SkillAuditorEngine.suppressZeroDeltaReport(baseReport, baseReport);
      expect(suppressed.zero_delta).toBe(true);
      expect(suppressed.suppressed).toBe(true);
    });

    it("detects non-zero delta when new events or incidents arrive", () => {
      const prevReport: SkillAuditLiveResult = {
        compliant: true,
        incidents: [],
        defectsLogged: 0,
        interjectionsSent: 0,
        cursor: { lastInspectedTimestamp: "2026-08-31T06:00:00Z", lastInspectedEventIndex: 10 },
        eventsAnalyzed: 5,
        timestamp: "2026-08-31T06:00:00Z",
      };

      const currReport: SkillAuditLiveResult = {
        compliant: false,
        incidents: [
          {
            id: "inc-1",
            category: "ROLE_BOUNDARY_DEVIATION",
            severity: "HIGH",
            title: "Coordinator Direct Edit",
            description: "Direct write",
            observation: "Direct write",
            remediation: "Dispatch subagents",
            recommendation: "Dispatch subagents",
          },
        ],
        defectsLogged: 1,
        interjectionsSent: 1,
        cursor: { lastInspectedTimestamp: "2026-08-31T06:01:00Z", lastInspectedEventIndex: 15 },
        eventsAnalyzed: 5,
        timestamp: "2026-08-31T06:01:00Z",
      };

      const delta = SkillAuditorEngine.compareSkillReportDelta(currReport, prevReport);
      expect(delta.isZeroDelta).toBe(false);
      expect(delta.suppressed).toBe(false);
      expect(delta.incidentsDelta).toBe(1);
    });
  });

  describe("Mind Supervisory Cadence Anti-Idle & Challenge Generation", () => {
    it("generates cognitive challenges across Mode A dimensions when pending backlog is 0", () => {
      const challenge = MindAuditorEngine.generateCognitiveChallenge({
        cycleIndex: 0,
        pendingBacklogCount: 0,
      });

      expect(challenge.dimension).toBeDefined();
      expect(challenge.title.length).toBeGreaterThan(0);
      expect(challenge.directive.length).toBeGreaterThan(0);
      expect(challenge.questions.length).toBeGreaterThan(0);
      expect(challenge.actionItems.length).toBeGreaterThan(0);

      const prompt = MindAuditorEngine.generateCognitiveChallengePrompt({
        cycleIndex: 0,
        pendingBacklogCount: 0,
      });
      expect(prompt).toContain("COGNITIVE CHALLENGE PROMPT");
      expect(prompt).toContain("CLOSING_FORBIDDEN_FOR_MIND");
    });
  });
});
