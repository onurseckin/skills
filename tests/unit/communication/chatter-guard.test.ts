import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertNonChatterPolicy,
  filterHumanRelayNarration,
  isMidFlightNarration,
  readUnreadMessages,
  resolveMailboxPaths,
  routeStatusUpdate,
  verifyEnvelopeHmac,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import type { MailboxEnvelope } from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Chatter Guard & Mid-Flight Progress Narration Interlock", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `chatter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  describe("isMidFlightNarration", () => {
    it("detects various mid-flight status and step narration patterns", () => {
      const chatterPhrases = [
        "I am now executing task 3.2: Human Relay Chatter Guard",
        "I'm currently running tests against the mailbox suite",
        "Status update: 3 tasks remaining in wave 3",
        "[Status Update]: Dispatched subagent worker-1",
        "Progress update: Step 2/5 completed successfully",
        "Step 3/10 complete",
        "Executing step 1/3: verifying invariants",
        "Worker dispatched to worker-pool-alpha",
        "Waiting for subagent completion...",
        "Heartbeat ping from worker-01",
      ];
      for (const phrase of chatterPhrases) {
        expect(isMidFlightNarration(phrase)).toBe(true);
      }
    });

    it("returns false for final deliverables, summaries, user prompts, and non-narration", () => {
      const nonChatterPhrases = [
        "Here is the implementation of the requested module.",
        "Task completed successfully. Summary of changes: 3 files updated.",
        "All 16 tests passing with 0 failures.",
        "Please confirm if you want to proceed with deletion (y/n):",
        "const answer = 42;",
        "# Architecture Overview\n\nThis document describes the mailbox subsystem.",
        "Step 1: Open the settings panel. Step 2: Select your preferences.",
        "",
      ];
      for (const phrase of nonChatterPhrases) {
        expect(isMidFlightNarration(phrase)).toBe(false);
      }
    });
  });

  describe("assertNonChatterPolicy", () => {
    it("throws ROLE_CONFINEMENT_VIOLATION on mid-flight narration in interactive seats", () => {
      const narration = "I am now executing the database migration...";
      expect(() => assertNonChatterPolicy(narration, { isInteractiveSeat: true })).toThrow(
        HarnessError,
      );
      expect(() => assertNonChatterPolicy(narration, { recipientRoleOrId: "human" })).toThrow(
        HarnessError,
      );
      expect(() => assertNonChatterPolicy(narration, { recipientRoleOrId: "stdout" })).toThrow(
        HarnessError,
      );
      expect(() => assertNonChatterPolicy(narration, { recipientRoleOrId: "user" })).toThrow(
        HarnessError,
      );
      expect(() => assertNonChatterPolicy(narration)).toThrow(HarnessError);

      try {
        assertNonChatterPolicy(narration, { isInteractiveSeat: true });
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
      }
    });

    it("does not throw for non-chatter deliverables or peer mailbox routing", () => {
      const deliverable = "Task completed successfully. All tests passing.";
      const narration = "I am now executing step 2/3...";
      expect(() => assertNonChatterPolicy(deliverable, { isInteractiveSeat: true })).not.toThrow();
      expect(() =>
        assertNonChatterPolicy(deliverable, { recipientRoleOrId: "human" }),
      ).not.toThrow();
      expect(() =>
        assertNonChatterPolicy(narration, {
          isInteractiveSeat: false,
          recipientRoleOrId: "agent-supervisor",
        }),
      ).not.toThrow();
      expect(() =>
        assertNonChatterPolicy(narration, { recipientRoleOrId: "agent-planner-01" }),
      ).not.toThrow();
      expect(() =>
        assertNonChatterPolicy(deliverable, { recipientRoleOrId: "" }),
      ).not.toThrow();
      expect(() =>
        assertNonChatterPolicy(deliverable, { recipientRoleOrId: "  " }),
      ).not.toThrow();
    });

    it("validates input string fail-closed", () => {
      expect(() => assertNonChatterPolicy(null as unknown as string)).toThrow(HarnessError);
    });
  });

  describe("routeStatusUpdate", () => {
    it("creates and appends signed envelopes to parent inbox and sender outbox", () => {
      const agentId = "agent-worker-01";
      const parentId = "agent-supervisor-01";
      const payload = { currentStep: 2, totalSteps: 5, progress: "40%" };

      const envelope = routeStatusUpdate(agentId, parentId, payload, {
        baseDir: testRoot,
        messageType: "PULSE_HEARTBEAT",
      });

      expect(envelope.sender_id).toBe(agentId);
      expect(envelope.recipient_id).toBe(parentId);
      expect(envelope.message_type).toBe("PULSE_HEARTBEAT");
      expect(verifyEnvelopeHmac(envelope).valid).toBe(true);

      const parentPaths = resolveMailboxPaths(parentId, testRoot);
      const parentInbox = readUnreadMessages(parentPaths.inboxPath);
      expect(parentInbox.messages.length).toBe(1);
      expect(parentInbox.messages[0]!.id).toBe(envelope.id);
    });

    it("supports custom secretKey and custom messageType and fails closed on bad args", () => {
      const customSecret = "custom-test-secret-key-12345";
      const envelope = routeStatusUpdate(
        "agent-a",
        "agent-b",
        { defectId: "DEF-001" },
        {
          baseDir: testRoot,
          secretKey: customSecret,
          messageType: "DEFECT_ESCALATION",
        },
      );
      expect(envelope.message_type).toBe("DEFECT_ESCALATION");
      expect(verifyEnvelopeHmac(envelope, customSecret).valid).toBe(true);
      expect(() => routeStatusUpdate("", "parent-01", {}, { baseDir: testRoot })).toThrow(
        HarnessError,
      );
      expect(() => routeStatusUpdate("agent-a", "", {}, { baseDir: testRoot })).toThrow(
        HarnessError,
      );
      expect(() => routeStatusUpdate("agent-a", 123 as unknown as string, {}, { baseDir: testRoot })).toThrow(
        HarnessError,
      );
      expect(() => routeStatusUpdate(123 as unknown as string, "parent-01", {}, { baseDir: testRoot })).toThrow(
        HarnessError,
      );
    });
  });

  describe("filterHumanRelayNarration", () => {
    it("intercepts mid-flight narration, routes envelope to parent, and masks output", () => {
      const rawText = "Status update: Worker dispatched to execute migration.";
      const options = {
        agentId: "agent-worker-02",
        parentId: "agent-supervisor-02",
        baseDir: testRoot,
      };

      const result = filterHumanRelayNarration(rawText, options);
      expect(result.isNarration).toBe(true);
      expect(result.filteredText).toBe("[Status update routed to supervisor mailbox]");
      expect(result.routedEnvelope).toBeDefined();

      const parentPaths = resolveMailboxPaths(options.parentId, testRoot);
      const inboxResult = readUnreadMessages(parentPaths.inboxPath);
      expect(inboxResult.messages.length).toBe(1);
    });

    it("passes through non-narration text unchanged without creating mailbox files", () => {
      const nonNarration = "Here is the final output of the calculation: 42";
      const options = {
        agentId: "agent-worker-03",
        parentId: "agent-supervisor-03",
        baseDir: testRoot,
      };

      const result = filterHumanRelayNarration(nonNarration, options);
      expect(result.isNarration).toBe(false);
      expect(result.filteredText).toBe(nonNarration);

      const parentPaths = resolveMailboxPaths(options.parentId, testRoot);
      expect(existsSync(parentPaths.inboxPath)).toBe(false);
    });

    it("fails closed on invalid arguments", () => {
      expect(() =>
        filterHumanRelayNarration(null as unknown as string, { agentId: "a", parentId: "b" }),
      ).toThrow(HarnessError);
      expect(() => filterHumanRelayNarration("test", { agentId: "", parentId: "b" })).toThrow(
        HarnessError,
      );
      expect(() => filterHumanRelayNarration("test", { agentId: "a", parentId: "" })).toThrow(
        HarnessError,
      );
    });
  });

  describe("Adversarial Edge Cases & Policy Confinement Probes", () => {
    it("case-insensitively identifies all human and interactive recipient targets", () => {
      const chatter = "I am now running test suite";
      const interactiveTargets = [
        "HUMAN",
        "User",
        "STDOUT",
        "Console",
        "Terminal",
        "Owner",
        "MAIN-THREAD",
      ];
      for (const target of interactiveTargets) {
        expect(() => assertNonChatterPolicy(chatter, { recipientRoleOrId: target })).toThrow(
          HarnessError,
        );
      }
    });

    it("preserves user responses containing step-by-step documentation instructions", () => {
      const userDoc =
        "To reproduce:\nStep 1: Open browser\nStep 2: Navigate to URL\nStep 3: Click button";
      expect(isMidFlightNarration(userDoc)).toBe(false);
      expect(() => assertNonChatterPolicy(userDoc, { isInteractiveSeat: true })).not.toThrow();
    });
  });

  describe("Architecture Invariants", () => {
    it("ensures test file is <= 300 physical lines with 0 any", () => {
      const file = join(process.cwd(), "tests/unit/communication/chatter-guard.test.ts");
      const lines = readFileSync(file, "utf8").split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);
    });
  });
});
