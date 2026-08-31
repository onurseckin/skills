import { describe, expect, test } from "bun:test";
import {
  formatPulseQuotaHeader,
  renderAsciiDagTelemetryBadge,
  renderPulseQuotaBadge,
  renderPulseQuotaProgressBar,
  renderPulseTelemetryBadges,
  type PulseQuotaEvaluation,
} from "../../olt/scripts/src/mind/pulsing/index.ts";

describe("Mind Pulse ASCII Telemetry Badges & Progress Bars", () => {
  test("renders precise ASCII progress bars across percentages", () => {
    expect(renderPulseQuotaProgressBar(100, 6)).toBe("[██████] 100%");
    expect(renderPulseQuotaProgressBar(50, 6)).toBe("[███░░░] 50%");
    expect(renderPulseQuotaProgressBar(0, 6)).toBe("[░░░░░░] 0%");
    expect(renderPulseQuotaProgressBar(83.33, 6)).toBe("[█████░] 83.33%");
    expect(renderPulseQuotaProgressBar(null, 6)).toBe("[░░░░░░] N/A");
    expect(renderPulseQuotaProgressBar(NaN, 6)).toBe("[░░░░░░] N/A");
    expect(renderPulseQuotaProgressBar(120, 6)).toBe("[██████] 100%");
    expect(renderPulseQuotaProgressBar(-10, 6)).toBe("[░░░░░░] 0%");
  });

  test("renders pulse quota badges for nominal, warning, and critical states", () => {
    const nominalBadge = renderPulseQuotaBadge(90, "antigravity", "nominal");
    expect(nominalBadge).toContain("[HOST: antigravity]");
    expect(nominalBadge).toContain("90%");
    expect(nominalBadge).toContain("nominal");

    const warnBadge = renderPulseQuotaBadge(18, "claude_code", "warning");
    expect(warnBadge).toContain("[HOST: claude_code]");
    expect(warnBadge).toContain("WARNING");

    const critBadge = renderPulseQuotaBadge(6.5, "cursor", "critical");
    expect(critBadge).toContain("[HOST: cursor]");
    expect(critBadge).toContain("CRITICAL BREAKER");
    expect(critBadge).toContain("6.50%");

    const unknownBadge = renderPulseQuotaBadge(null, "unknown", "unknown");
    expect(unknownBadge).toContain("unmeasured");
  });

  test("renders telemetry badge lists with options", () => {
    const mockEval: PulseQuotaEvaluation = {
      activeHost: "antigravity",
      status: "nominal",
      isCircuitBreakerTripped: false,
      lowestRemainingQuota: 75.5,
      thresholdPercentage: 10,
      constrainedModels: [],
      metrics: [],
      checkedAt: new Date().toISOString(),
      warningMessages: [],
    };

    const badges = renderPulseTelemetryBadges(mockEval);
    expect(badges).toContain("[HOST: antigravity]");
    expect(badges.some((b) => b.includes("75.50%"))).toBe(true);
    expect(badges).toContain("[BREAKER: NOMINAL]");

    const compactBadges = renderPulseTelemetryBadges(mockEval, {
      compact: true,
      includeHost: false,
    });
    expect(compactBadges).not.toContain("[HOST: antigravity]");
    expect(compactBadges.some((b) => b.includes("75.50%"))).toBe(true);
  });

  test("renders autowake and constrained models in badges when present", () => {
    const mockEval: PulseQuotaEvaluation = {
      activeHost: "claude_code",
      status: "critical",
      isCircuitBreakerTripped: true,
      lowestRemainingQuota: 8.0,
      thresholdPercentage: 10,
      constrainedModels: ["claude-3-opus", "claude-3-sonnet"],
      autoWakeSchedule: {
        targetWakeupIso: "2026-09-01T12:01:00.000Z",
        durationSeconds: 120,
        timerCondition: "never",
        activeAgentsCount: 0,
      },
      metrics: [],
      checkedAt: new Date().toISOString(),
      warningMessages: ["Low quota"],
    };

    const badges = renderPulseTelemetryBadges(mockEval);
    expect(badges).toContain("[BREAKER: 🚨 TRIPPED]");
    expect(badges).toContain("[AUTOWAKE: +120s]");
    expect(badges).toContain("[CONSTRAINED: 2 models]");
  });

  test("formats pulse quota ASCII header block", () => {
    const mockEval: PulseQuotaEvaluation = {
      activeHost: "antigravity",
      status: "nominal",
      isCircuitBreakerTripped: false,
      lowestRemainingQuota: 95.0,
      thresholdPercentage: 10,
      constrainedModels: [],
      metrics: [],
      checkedAt: new Date().toISOString(),
      warningMessages: [],
    };

    const header = formatPulseQuotaHeader(mockEval);
    expect(header).toContain("HOST: antigravity");
    expect(header).toContain("QUOTA: 95.00%");
    expect(header).toContain("STATUS: NOMINAL");
    expect(header).toContain("BREAKER: NOMINAL");
  });

  test("renders compact ASCII DAG telemetry badge", () => {
    expect(renderAsciiDagTelemetryBadge(4, 2, 85)).toBe("[DAG: 4N/2W | Q: 85%]");
    expect(renderAsciiDagTelemetryBadge(10, 3, null)).toBe("[DAG: 10N/3W | Q: N/A]");
  });
});
