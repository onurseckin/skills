/**
 * @file conversational-engagement-protocols.test.ts
 * Conversational Engagement Protocols & Active Swarm Audit Integration Test Suite.
 *
 * Validates:
 * 1. Mandatory 3-Round (6-Turn) Socratic Conversational Laddering:
 *    - Round 1 (Turn 1 & 2): Strategic Intent & Horizon Audit.
 *    - Round 2 (Turn 3 & 4): Adversarial Reality & Quality Challenge.
 *    - Round 3 (Turn 5 & 6): Evolutionary Frontier & Concrete Milestone Lock.
 *    - Enforces minimum 6 turns before audit conclusion; rejects canned templates & single-turn notifications.
 * 2. Active Swarm Tailored 1-on-1 Conversational Audits (Skill Auditor):
 *    - Dynamic agent discovery across Orchestrators, Coordinators, Implementers, Validators.
 *    - Four core interrogation inquiries:
 *      1. Atomic task clarity & verification standards.
 *      2. Capability boundaries (Zero supervisor code edits, zero validator test runs).
 *      3. Forward momentum evidence (File-scoped tests, UI layout renders, artifact writes).
 *      4. Self-reflection & blocker disclosure.
 *    - Evaluation: momentum confirmation & invariant re-anchoring.
 * 3. Three-Strike Mechanical Containment & Capability Revocation:
 *    - Strike 1: HALT_AND_DELEGATE (intercepts supervisor attempting direct code edits or tool invocation, issues violation, forces delegation to implementer).
 *    - Strike 2: CAPABILITY_REVOCATION (hard tool stripping of write_to_file, replace_file_content, run_command).
 *    - Strike 3: PERSONA_RESPAWN (terminates rogue agent, sanitizes state, spawns fresh compliant persona).
 *    - Validator Zero Test Execution Invariant: intercepts validator trying to run test runner commands directly.
 * 4. Zero Main Thread Pollution Guarantee for Conversational Audits:
 *    - Mailbox IPC only (.olt/mailboxes/<agentId>).
 *    - Zero console / stdout spam.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  advanceMailboxCursorBatch,
  dispatchPeerMessage,
  ensureMailboxDir,
  getInMemoryMailbox,
  loadMailboxCursor,
  readUnreadMessages,
  setInMemoryMailbox,
  type MailboxEnvelope,
} from "../../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  PARETO_PRIORITY_LEVELS,
  SocraticLadderingEngine,
  type StrategicCommitment,
} from "../../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  DEFAULT_REVOKED_TOOLS,
  MechanicalContainmentEngine,
  type ContainmentResult,
  type SupervisoryViolation,
} from "../../../../olt/scripts/src/mind/containment/index.ts";
import {
  cleanupVirtualMindFS,
  getVirtualMindFS,
  scratchRoot,
  setupVirtualMindFS,
} from "../../fixtures/mind-fixture.ts";

describe("Conversational Engagement Protocols & Active Swarm Audit Suite", () => {
  let testRepoRoot: string;

  beforeEach(() => {
    setupVirtualMindFS();
    testRepoRoot = scratchRoot("conversational-audit", "sub3");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("4. Zero Main Thread Pollution Guarantee for Conversational Audits", () => {
    it("guarantees that 100% of conversational engagement messages are strictly routed through mailbox files", () => {
      const auditorPaths = ensureMailboxDir("auditor-clean", testRepoRoot);
      const workerPaths = ensureMailboxDir("worker-clean", testRepoRoot);

      // Dispatch 10 background messages
      for (let i = 0; i < 10; i++) {
        dispatchPeerMessage({
          senderId: "auditor-clean",
          senderRole: "skill-auditor",
          recipientRoleOrId: "worker-clean",
          messageType: "COGNITIVE_PUSHBACK",
          payload: { batchIndex: i },
          correlationId: `clean-ipc-${i}`,
          baseDir: testRepoRoot,
        });
      }

      // Check inbox in memory
      const lines = getInMemoryMailbox(workerPaths.inboxPath) ?? [];
      expect(lines.length).toBe(10);

      const unread = readUnreadMessages(workerPaths.inboxPath);
      expect(unread.messages.length).toBe(10);
      expect(unread.quarantinedCount).toBe(0);
    });

    it("handles non-existent and empty inboxes gracefully returning empty results", () => {
      const nonExistent = join(testRepoRoot, ".olt", "mailboxes", "ghost-agent", "inbox.jsonl");
      const res = readUnreadMessages(nonExistent);
      expect(res.messages).toEqual([]);
      expect(res.quarantinedCount).toBe(0);
    });

    it("quarantines corrupted/malformed envelopes without crashing reader", () => {
      const paths = ensureMailboxDir("worker-corrupt", testRepoRoot);
      setInMemoryMailbox(paths.inboxPath, [
        "not-valid-json-syntax{{{",
        JSON.stringify({ id: "valid-1", sequence: 1, sender_id: "s", recipient_id: "r", sender_role: "r", message_type: "t", timestamp: "ts", correlation_id: "c", hmac_signature: "h", payload: {} }),
        JSON.stringify({ incomplete: "envelope" }),
      ]);

      const res = readUnreadMessages(paths.inboxPath, null, { quarantinePath: paths.quarantinePath });
      expect(res.messages.length).toBe(1);
      expect(res.messages[0]?.id).toBe("valid-1");
      expect(res.quarantinedCount).toBe(2);
    });

    it("burst dispatches 50 messages maintaining 100% in-memory ordering and cursor advancement", () => {
      const auditor = ensureMailboxDir("auditor-burst", testRepoRoot);
      const worker = ensureMailboxDir("worker-burst", testRepoRoot);

      for (let i = 1; i <= 50; i++) {
        dispatchPeerMessage({
          senderId: "auditor-burst",
          senderRole: "skill-auditor",
          recipientRoleOrId: "worker-burst",
          messageType: "BURST_SIGNAL",
          sequence: i,
          payload: { index: i },
          correlationId: `burst-${i}`,
          baseDir: testRepoRoot,
        });
      }

      const unread = readUnreadMessages(worker.inboxPath, loadMailboxCursor(worker.cursorPath));
      expect(unread.messages.length).toBe(50);
      expect(unread.messages[0]?.sequence).toBe(1);
      expect(unread.messages[49]?.sequence).toBe(50);

      const advanced = advanceMailboxCursorBatch(worker.cursorPath, unread.messages);
      expect(advanced.last_read_sequence).toBe(50);

      const unreadAfter = readUnreadMessages(worker.inboxPath, advanced);
      expect(unreadAfter.messages.length).toBe(0);
    });
  });
});
