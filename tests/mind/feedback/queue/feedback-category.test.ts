import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  normalizeFeedbackCategory,
  normalizeFeedbackPriority,
  normalizeFeedbackStatus,
  validateCategory,
  validatePriority,
  validateStatus,
} from "../../../../olt/scripts/src/mind/feedback/normalizer.ts";
import {
  compareFeedbackPriority,
  sortFeedbackByPriority,
} from "../../../../olt/scripts/src/mind/feedback/queue/types.ts";
import type {
  FeedbackItem,
  FeedbackPriority,
} from "../../../../olt/scripts/src/mind/feedback/queue/types.ts";

describe("Feedback Category & Taxonomy Normalizer Suite", () => {
  describe("validateCategory & normalizeFeedbackCategory", () => {
    it("normalizes canonical category names accurately", () => {
      const canonicals = [
        "DOCUMENTATION",
        "AGENT_CONTRACTS",
        "CLI_TOOLING",
        "WATCHDOG",
        "SCALING",
        "ARCHITECTURE",
        "CORE_ENGINE",
        "ENGINE",
        "REPAIR",
        "GENERAL",
        "GOVERNANCE",
        "ORCHESTRATION",
        "AUDITING",
        "COMMUNICATION",
        "VALIDATION",
        "NOTIFICATION",
      ] as const;

      for (const cat of canonicals) {
        expect(validateCategory(cat)).toBe(cat);
        expect(normalizeFeedbackCategory(cat.toLowerCase())).toBe(cat);
      }
    });

    it("resolves all supported shorthand aliases to canonical forms", () => {
      const aliasMap: Record<string, string> = {
        DOCS: "DOCUMENTATION",
        DOC: "DOCUMENTATION",
        CONTRACTS: "AGENT_CONTRACTS",
        AGENT: "AGENT_CONTRACTS",
        CLI: "CLI_TOOLING",
        TOOLING: "CLI_TOOLING",
        BUGFIX: "REPAIR",
        FIX: "REPAIR",
        POLICY: "GOVERNANCE",
        WORKFLOW: "ORCHESTRATION",
        AUDIT: "AUDITING",
        MSG: "COMMUNICATION",
        MESSAGING: "COMMUNICATION",
        VALIDATOR: "VALIDATION",
        NOTIFICATIONS: "NOTIFICATION",
        NOTIFY: "NOTIFICATION",
      };

      for (const [alias, expected] of Object.entries(aliasMap)) {
        expect(validateCategory(`  ${alias.toLowerCase()}  `)).toBe(expected);
      }
    });

    it("strictly throws HarnessError with INTEGRITY code on invalid inputs", () => {
      const invalidInputs = ["", "   ", "UNKNOWN_CATEGORY", "RANDOM", null, undefined, 12345];
      for (const invalid of invalidInputs) {
        expect(() => validateCategory(invalid)).toThrow(HarnessError);
        expect(() => normalizeFeedbackCategory(invalid)).toThrow(/valid category/);
      }
    });
  });

  describe("validatePriority & normalizeFeedbackPriority", () => {
    it("validates canonical priorities and aliases with case-insensitivity", () => {
      expect(validatePriority("CRITICAL_USER_FEEDBACK")).toBe("CRITICAL_USER_FEEDBACK");
      expect(normalizeFeedbackPriority("critical")).toBe("CRITICAL_USER_FEEDBACK");
      expect(validatePriority("HIGH_ARCHITECTURAL_FEATURE")).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(normalizeFeedbackPriority("high")).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(validatePriority("USER_DIRECTIVE")).toBe("USER_DIRECTIVE");
      expect(normalizeFeedbackPriority("directive")).toBe("USER_DIRECTIVE");
      expect(validatePriority("NORMAL")).toBe("NORMAL");
      expect(normalizeFeedbackPriority("medium")).toBe("NORMAL");
      expect(validatePriority("low")).toBe("LOW");
    });

    it("strictly throws HarnessError with INTEGRITY code on unrecognized priority", () => {
      expect(() => validatePriority("URGENT")).toThrow(HarnessError);
      expect(() => normalizeFeedbackPriority(null)).toThrow(/valid priority/);
      expect(() => normalizeFeedbackPriority("")).toThrow(/valid priority/);
    });
  });

  describe("validateStatus & normalizeFeedbackStatus", () => {
    it("validates canonical statuses and supported aliases", () => {
      expect(validateStatus("PENDING")).toBe("PENDING");
      expect(normalizeFeedbackStatus("pending")).toBe("PENDING");
      expect(validateStatus("ADMITTED")).toBe("ADMITTED");
      expect(normalizeFeedbackStatus("planned")).toBe("ADMITTED");
      expect(validateStatus("DECLINED")).toBe("DECLINED");
      expect(validateStatus("PROCESSED")).toBe("PROCESSED");
      expect(validateStatus("COMPLETED")).toBe("COMPLETED");
    });

    it("strictly throws HarnessError with INTEGRITY code on unrecognized status", () => {
      expect(() => validateStatus("IN_PROGRESS")).toThrow(HarnessError);
      expect(() => normalizeFeedbackStatus(undefined)).toThrow(/valid status/);
    });
  });

  describe("compareFeedbackPriority & sortFeedbackByPriority", () => {
    it("orders feedback priorities by ascending rank index", () => {
      const priorities: FeedbackPriority[] = [
        "LOW",
        "NORMAL",
        "USER_DIRECTIVE",
        "HIGH_ARCHITECTURAL_FEATURE",
        "CRITICAL_USER_FEEDBACK",
      ];
      const sorted = [...priorities].sort((a, b) => compareFeedbackPriority(a, b));
      expect(sorted).toEqual([
        "CRITICAL_USER_FEEDBACK",
        "HIGH_ARCHITECTURAL_FEATURE",
        "USER_DIRECTIVE",
        "NORMAL",
        "LOW",
      ]);
    });

    it("breaks priority ties using ISO-8601 timestamp chronology", () => {
      const item1: FeedbackItem = {
        id: "fb-1",
        timestamp: "2026-09-01T12:00:00.000Z",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
        title: "Later Item",
        content: "Content",
      };
      const item2: FeedbackItem = {
        id: "fb-2",
        timestamp: "2026-09-01T10:00:00.000Z",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
        title: "Earlier Item",
        content: "Content",
      };
      const sorted = sortFeedbackByPriority([item1, item2]);
      expect(sorted[0]?.id).toBe("fb-2");
      expect(sorted[1]?.id).toBe("fb-1");
    });
  });
});
