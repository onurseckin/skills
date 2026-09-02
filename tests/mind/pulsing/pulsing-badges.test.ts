import { describe, expect, it } from "bun:test";
import {
  renderPulseQuotaProgressBar,
  renderPulseQuotaBadge,
  renderPulseTelemetryBadges,
  formatPulseQuotaHeader,
  renderAsciiDagTelemetryBadge,
} from "../../../olt/scripts/src/mind/pulsing/badges.ts";
import type { PulseQuotaEvaluation } from "../../../olt/scripts/src/mind/pulsing/types.ts";

describe("Mind Pulsing Badges (badges.ts)", () => {
  describe("renderPulseQuotaProgressBar", () => {
    it("handles null and NaN values with empty bar and N/A label", () => {
      expect(renderPulseQuotaProgressBar(null)).toBe("[░░░░░░] N/A");
      expect(renderPulseQuotaProgressBar(NaN, 4)).toBe("[░░░░] N/A");
    });

    it("clamps values below 0 and above 100", () => {
      expect(renderPulseQuotaProgressBar(-15)).toBe("[░░░░░░] 0%");
      expect(renderPulseQuotaProgressBar(120)).toBe("[██████] 100%");
    });

    it("formats integer and fractional percentages with custom width", () => {
      expect(renderPulseQuotaProgressBar(50, 6)).toBe("[███░░░] 50%");
      expect(renderPulseQuotaProgressBar(75.5, 4)).toBe("[███░] 75.50%");
      expect(renderPulseQuotaProgressBar(0)).toBe("[░░░░░░] 0%");
      expect(renderPulseQuotaProgressBar(100)).toBe("[██████] 100%");
    });
  });

  describe("renderPulseQuotaBadge", () => {
    it("renders unmeasured badge when quota is null or NaN", () => {
      expect(renderPulseQuotaBadge(null, "orch-1")).toBe(
        "[HOST: orch-1] [QUOTA: unmeasured · unknown]",
      );
      expect(renderPulseQuotaBadge(NaN, "")).toBe("[QUOTA: unmeasured · unknown]");
      expect(renderPulseQuotaBadge(null, "unknown")).toBe("[QUOTA: unmeasured · unknown]");
    });

    it("renders critical breaker when status is critical or quota <= 10", () => {
      expect(renderPulseQuotaBadge(5.5, "worker-a", "critical")).toBe(
        "[HOST: worker-a] [QUOTA: 5.50% 🚨 CRITICAL BREAKER]",
      );
      expect(renderPulseQuotaBadge(9.0, "", "nominal")).toBe("[QUOTA: 9.00% 🚨 CRITICAL BREAKER]");
    });

    it("renders warning badge when status is warning or quota < 20", () => {
      expect(renderPulseQuotaBadge(50, "orch-2", "warning")).toBe(
        "[HOST: orch-2] [QUOTA: [███░░░] 50% ⚠️ WARNING]",
      );
      expect(renderPulseQuotaBadge(18.25, "", "nominal")).toBe(
        "[QUOTA: [█░░░░░] 18.25% ⚠️ WARNING]",
      );
    });

    it("renders nominal badge when quota >= 20 and status is nominal", () => {
      expect(renderPulseQuotaBadge(80, "host-primary", "nominal")).toBe(
        "[HOST: host-primary] [QUOTA: [█████░] 80% nominal]",
      );
      expect(renderPulseQuotaBadge(100, "")).toBe("[QUOTA: [██████] 100% nominal]");
    });
  });

  describe("renderPulseTelemetryBadges", () => {
    const baseEval: PulseQuotaEvaluation = {
      activeHost: "host-node-1",
      lowestRemainingQuota: 75,
      status: "nominal",
      isCircuitBreakerTripped: false,
      constrainedModels: [],
    };

    it("renders nominal telemetry badges with host and nominal breaker", () => {
      const badges = renderPulseTelemetryBadges(baseEval);
      expect(badges).toEqual([
        "[HOST: host-node-1]",
        "[QUOTA: [█████░] 75% nominal]",
        "[BREAKER: NOMINAL]",
      ]);
    });

    it("respects includeHost: false and unknown host strings", () => {
      const badgesNoHost = renderPulseTelemetryBadges(baseEval, { includeHost: false });
      expect(badgesNoHost).not.toContain("[HOST: host-node-1]");

      const badgesUnknown = renderPulseTelemetryBadges({ ...baseEval, activeHost: "unknown" });
      expect(badgesUnknown.some((b) => b.startsWith("[HOST:"))).toBe(false);

      const badgesEmpty = renderPulseTelemetryBadges({ ...baseEval, activeHost: "" });
      expect(badgesEmpty.some((b) => b.startsWith("[HOST:"))).toBe(false);
    });

    it("handles null lowestRemainingQuota", () => {
      const badges = renderPulseTelemetryBadges({
        ...baseEval,
        lowestRemainingQuota: null,
      });
      expect(badges).toContain("[QUOTA: unmeasured]");
    });

    it("handles critical and warning evaluation status", () => {
      const criticalEval: PulseQuotaEvaluation = {
        ...baseEval,
        lowestRemainingQuota: 4.5,
        status: "critical",
        isCircuitBreakerTripped: true,
      };
      const critBadges = renderPulseTelemetryBadges(criticalEval);
      expect(critBadges).toContain("[QUOTA: 4.50% 🚨 CRITICAL]");
      expect(critBadges).toContain("[BREAKER: 🚨 TRIPPED]");

      const warnEval: PulseQuotaEvaluation = {
        ...baseEval,
        lowestRemainingQuota: 15,
        status: "warning",
      };
      const warnBadges = renderPulseTelemetryBadges(warnEval);
      expect(warnBadges).toContain("[QUOTA: [█░░░░░] 15% ⚠️ LOW]");
    });

    it("supports includeProgressBar: false and compact: true options", () => {
      const noBarBadges = renderPulseTelemetryBadges(baseEval, { includeProgressBar: false });
      expect(noBarBadges).toContain("[QUOTA: 75.00% nominal]");

      const compactBadges = renderPulseTelemetryBadges(baseEval, { compact: true });
      expect(compactBadges).toContain("[QUOTA: [███░] 75% nominal]");
    });

    it("includes autowake and constrained models badges when present", () => {
      const fullEval: PulseQuotaEvaluation = {
        ...baseEval,
        autoWakeSchedule: { durationSeconds: 45, reason: "cooling_off" },
        constrainedModels: ["model-x", "model-y"],
      };
      const badges = renderPulseTelemetryBadges(fullEval);
      expect(badges).toContain("[AUTOWAKE: +45s]");
      expect(badges).toContain("[CONSTRAINED: 2 models]");
    });
  });

  describe("formatPulseQuotaHeader", () => {
    it("formats header with valid quota and nominal breaker", () => {
      const header = formatPulseQuotaHeader({
        activeHost: "cluster-alpha",
        lowestRemainingQuota: 88.5,
        status: "nominal",
        isCircuitBreakerTripped: false,
        constrainedModels: [],
      });
      expect(header).toContain("HOST: cluster-alpha");
      expect(header).toContain("QUOTA: 88.50%");
      expect(header).toContain("STATUS: NOMINAL");
      expect(header).toContain("BREAKER: NOMINAL");
      expect(header.split("\n")).toHaveLength(3);
    });

    it("formats header with null quota and tripped circuit breaker", () => {
      const header = formatPulseQuotaHeader({
        activeHost: "",
        lowestRemainingQuota: null,
        status: "critical",
        isCircuitBreakerTripped: true,
        constrainedModels: [],
      });
      expect(header).toContain("HOST: unknown");
      expect(header).toContain("QUOTA: Unavailable");
      expect(header).toContain("STATUS: CRITICAL");
      expect(header).toContain("BREAKER: 🚨 TRIPPED (<10%)");
    });
  });

  describe("renderAsciiDagTelemetryBadge", () => {
    it("renders badge with rounded quota value", () => {
      expect(renderAsciiDagTelemetryBadge(8, 3, 66.8)).toBe("[DAG: 8N/3W | Q: 67%]");
      expect(renderAsciiDagTelemetryBadge(12, 4, 100)).toBe("[DAG: 12N/4W | Q: 100%]");
    });

    it("renders badge with N/A when lowestQuota is null", () => {
      expect(renderAsciiDagTelemetryBadge(4, 2, null)).toBe("[DAG: 4N/2W | Q: N/A]");
    });
  });
});
