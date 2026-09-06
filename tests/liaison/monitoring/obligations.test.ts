import { describe, expect, it } from "bun:test";
import {
  evaluateObligation,
  filterObligationsByState,
  isPathInScope,
  summarizeObligations,
  verifyBindingProof,
} from "../../../olt/scripts/src/liaison/monitoring/obligations.ts";
import type { ObligationDirective } from "../../../olt/scripts/src/liaison/monitoring/types.ts";

export const obligationsSuiteName = "Obligation Tracking & Proof Verification";

describe(obligationsSuiteName, () => {
  const baseDirective: ObligationDirective = Object.freeze({
    directiveId: "dir_001",
    correlationId: "corr_wave42",
    senderId: "claude-planner",
    recipientId: "liaison_antigravity",
    timestamp: "2026-09-06T00:00:00.000Z",
    description: "Implement design system button variant",
    namedPaths: Object.freeze(["src/components/button.tsx", "src/styles/theme.css"]),
    overdueWindowSeconds: 300,
  });

  describe("isPathInScope", () => {
    it("matches exact paths", () => {
      expect(isPathInScope("src/components/button.tsx", "src/components/button.tsx")).toBe(true);
    });

    it("matches directory prefix with or without trailing slashes", () => {
      expect(isPathInScope("src/components/button.tsx", "src/components")).toBe(true);
      expect(isPathInScope("src/components/button.tsx", "src/components/")).toBe(true);
      expect(isPathInScope("src/other/button.tsx", "src/components")).toBe(false);
    });
  });

  describe("verifyBindingProof", () => {
    it("validates when all named paths sit within bound write scope", () => {
      const proof = {
        taskId: "task-button",
        boundScopePaths: ["src/components", "src/styles"],
      };

      const valid = verifyBindingProof(baseDirective.namedPaths, proof);
      expect(valid).toBe(true);
    });

    it("fails when a named path is not in bound write scope (forensics §2.1)", () => {
      // Wave 36 failure mode: waypoint scope not in lane scope
      const proof = {
        taskId: "task-partial",
        boundScopePaths: ["src/components"], // missing src/styles
      };

      const valid = verifyBindingProof(baseDirective.namedPaths, proof);
      expect(valid).toBe(false);
    });

    it("accepts artifact proof or commit hash proof", () => {
      expect(
        verifyBindingProof(baseDirective.namedPaths, {
          artifactPath: "docs/reports/button-audit.md",
        }),
      ).toBe(true);

      expect(
        verifyBindingProof(baseDirective.namedPaths, {
          commitHash: "a1b2c3d4e5",
        }),
      ).toBe(true);
    });

    it("returns false for null or undefined proof", () => {
      expect(verifyBindingProof(baseDirective.namedPaths, null)).toBe(false);
      expect(verifyBindingProof(baseDirective.namedPaths, undefined)).toBe(false);
    });
  });

  describe("evaluateObligation", () => {
    it("marks obligation as delivered when within overdue window", () => {
      const deliveredTime = "2026-09-06T00:01:00.000Z";
      const currentTime = "2026-09-06T00:03:00.000Z"; // 120s elapsed < 300s window

      const result = evaluateObligation(
        {
          directive: baseDirective,
          deliveredAt: deliveredTime,
        },
        currentTime,
      );

      expect(result.bindingState).toBe("delivered");
      expect(result.isOverdue).toBe(false);
      expect(result.elapsedSeconds).toBe(120);
    });

    it("detects overdue obligation when window exceeded (protocol.md §2.2)", () => {
      const deliveredTime = "2026-09-06T00:01:00.000Z";
      const currentTime = "2026-09-06T00:07:00.000Z"; // 360s elapsed > 300s window

      const result = evaluateObligation(
        {
          directive: baseDirective,
          deliveredAt: deliveredTime,
        },
        currentTime,
      );

      expect(result.bindingState).toBe("overdue");
      expect(result.isOverdue).toBe(true);
      expect(result.elapsedSeconds).toBe(360);
    });

    it("marks bound obligation when boundAt is set", () => {
      const result = evaluateObligation({
        directive: baseDirective,
        deliveredAt: "2026-09-06T00:01:00.000Z",
        boundAt: "2026-09-06T00:02:00.000Z",
        proof: {
          taskId: "task-ui",
          boundScopePaths: ["src/components", "src/styles"],
        },
      });

      expect(result.bindingState).toBe("bound");
      expect(result.isOverdue).toBe(false);
      expect(result.proof?.taskId).toBe("task-ui");
    });

    it("marks refused obligation as first-class protocol response", () => {
      const result = evaluateObligation({
        directive: baseDirective,
        deliveredAt: "2026-09-06T00:01:00.000Z",
        refusalReason: "Path src/styles/theme.css locked under active freeze",
      });

      expect(result.bindingState).toBe("refused");
      expect(result.refusalReason).toContain("locked under active freeze");
      expect(result.isOverdue).toBe(false);
    });
  });

  describe("summarizeObligations & filterObligationsByState", () => {
    it("aggregates obligation states correctly", () => {
      const ob1 = evaluateObligation({
        directive: baseDirective,
        deliveredAt: "2026-09-06T00:01:00.000Z",
        boundAt: "2026-09-06T00:02:00.000Z",
      });
      const ob2 = evaluateObligation({
        directive: { ...baseDirective, directiveId: "dir_002" },
        deliveredAt: "2026-09-06T00:01:00.000Z",
        refusalReason: "Out of scope",
      });
      const ob3 = evaluateObligation(
        {
          directive: { ...baseDirective, directiveId: "dir_003" },
          deliveredAt: "2026-09-06T00:00:00.000Z",
        },
        "2026-09-06T00:10:00.000Z", // overdue
      );
      const ob4 = evaluateObligation(
        {
          directive: { ...baseDirective, directiveId: "dir_004" },
          deliveredAt: "2026-09-06T00:09:00.000Z",
        },
        "2026-09-06T00:10:00.000Z", // delivered, not overdue
      );

      const summary = summarizeObligations([ob1, ob2, ob3, ob4]);

      expect(summary.totalObligations).toBe(4);
      expect(summary.boundCount).toBe(1);
      expect(summary.refusedCount).toBe(1);
      expect(summary.overdueCount).toBe(1);
      expect(summary.openCount).toBe(2); // delivered (1) + overdue (1)

      const overdueItems = filterObligationsByState(summary.obligations, "overdue");
      expect(overdueItems).toHaveLength(1);
      expect(overdueItems[0]?.directive.directiveId).toBe("dir_003");
    });
  });
});
