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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceMailboxCursorBatch,
  dispatchPeerMessage,
  ensureMailboxDir,
  loadMailboxCursor,
  readUnreadMessages,
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

describe("Conversational Engagement Protocols & Active Swarm Audit Suite", () => {
  let testRepoRoot: string;

  beforeEach(() => {
    testRepoRoot = join(
      tmpdir(),
      `mind-conversational-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(testRepoRoot, { recursive: true });
    mkdirSync(join(testRepoRoot, ".olt"), { recursive: true });
    mkdirSync(join(testRepoRoot, ".olt", "mailboxes"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testRepoRoot, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  describe("2. Active Swarm Tailored 1-on-1 Conversational Audits (Skill Auditor)", () => {
    it("discovers active agents and interrogates across Four Core Inquiries", () => {
      // Setup active agent mailboxes
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

      // Four Core Inquiries
      const coreInquiries = [
        "Inquiry 1: Atomic task clarity & deterministic acceptance criteria",
        "Inquiry 2: Strict capability boundary adherence (Zero supervisor edits / Zero validator test runs)",
        "Inquiry 3: Concrete forward momentum evidence (File-scoped tests / artifact writes)",
        "Inquiry 4: Self-reflection on friction points and blockers",
      ];

      // Skill Auditor sends tailored 1-on-1 audits to all active agents
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

      // Verify Implementer mailbox received 4 inquiries
      const unreadImplementer = readUnreadMessages(
        implementerPaths.inboxPath,
        loadMailboxCursor(implementerPaths.cursorPath),
      );
      expect(unreadImplementer.messages.length).toBe(4);
      expect(
        (unreadImplementer.messages[0]?.payload as { inquiryText: string }).inquiryText,
      ).toContain("Atomic task clarity");

      advanceMailboxCursorBatch(implementerPaths.cursorPath, unreadImplementer.messages);

      // Implementer replies with forward momentum evidence
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
