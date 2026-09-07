import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  advanceMailboxCursorBatch,
  dispatchPeerMessage,
  ensureMailboxDir,
  loadMailboxCursor,
  readUnreadMessages,
} from "../../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  cleanupVirtualMindFS,
  scratchRoot,
  setupVirtualMindFS,
} from "../../fixtures/mind-fixture.ts";

describe("Conversational Engagement Protocols & Active Swarm Audit Suite", () => {
  let testRepoRoot: string;

  beforeEach(() => {
    const vfs = setupVirtualMindFS();
    testRepoRoot = scratchRoot("conv-protocols", "sub2");
    vfs.mkdirSync(join(testRepoRoot, ".olt", "mailboxes"), { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("2. Active Swarm Tailored 1-on-1 Conversational Audits (Skill Auditor)", () => {
    it("discovers active agents and interrogates across Four Core Inquiries", () => {
      const orchestratorPaths = ensureMailboxDir("orchestrator-alpha", testRepoRoot);
      const coordinatorPaths = ensureMailboxDir("coordinator-frontend", testRepoRoot);
      const implementerPaths = ensureMailboxDir("implementer-parser", testRepoRoot);
      const validatorPaths = ensureMailboxDir("validator-compiler", testRepoRoot);

      const activeAgents = [
        { id: "orchestrator-alpha", role: "orchestrator" },
        { id: "coordinator-frontend", role: "coordinator" },
        { id: "implementer-parser", role: "implementer" },
        { id: "validator-compiler", role: "validator" },
      ];

      const coreInquiries = [
        "Inquiry 1: Atomic task clarity & deterministic acceptance criteria",
        "Inquiry 2: Strict capability boundary adherence (Zero supervisor edits / Zero validator test runs)",
        "Inquiry 3: Concrete forward momentum evidence (File-scoped tests / artifact writes)",
        "Inquiry 4: Self-reflection on friction points and blockers",
      ];

      for (const agent of activeAgents) {
        for (let i = 0; i < coreInquiries.length; i++) {
          dispatchPeerMessage({
            senderId: "skill-auditor",
            senderRole: "skill-auditor",
            recipientRoleOrId: agent.id,
            messageType: "COGNITIVE_PUSHBACK",
            payload: {
              inquiryNumber: i + 1,
              inquiryText: coreInquiries[i],
              targetRole: agent.role,
            },
            correlationId: `audit-${agent.id}-q${i + 1}`,
            baseDir: testRepoRoot,
          });
        }
      }

      const unreadImplementer = readUnreadMessages(
        implementerPaths.inboxPath,
        loadMailboxCursor(implementerPaths.cursorPath),
      );
      expect(unreadImplementer.messages.length).toBe(4);
      expect(
        (unreadImplementer.messages[0]?.payload as { inquiryText: string }).inquiryText,
      ).toContain("Atomic task clarity");

      advanceMailboxCursorBatch(implementerPaths.cursorPath, unreadImplementer.messages);

      dispatchPeerMessage({
        senderId: "implementer-parser",
        senderRole: "implementer",
        recipientRoleOrId: "skill-auditor",
        messageType: "PULSE_HEARTBEAT",
        payload: {
          status: "FORWARD_MOMENTUM_VERIFIED",
          evidence: "Parser unit test suite green with 0 compiler errors.",
        },
        correlationId: "audit-implementer-response",
        baseDir: testRepoRoot,
      });

      const skillAuditorPaths = ensureMailboxDir("skill-auditor", testRepoRoot);
      const unreadAuditor = readUnreadMessages(
        skillAuditorPaths.inboxPath,
        loadMailboxCursor(skillAuditorPaths.cursorPath),
      );
      expect(unreadAuditor.messages.length).toBe(1);
      expect((unreadAuditor.messages[0]?.payload as { status: string }).status).toBe(
        "FORWARD_MOMENTUM_VERIFIED",
      );
    });
  });
});
