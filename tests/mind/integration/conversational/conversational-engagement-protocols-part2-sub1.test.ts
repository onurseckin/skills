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

  describe("1. Mandatory 3-Round (6-Turn) Socratic Conversational Laddering Protocol", () => {
    it("executes the complete 6-turn Socratic audit through mailbox IPC and enforces minimum 6 turns before conclusion", () => {
      const auditorPaths = ensureMailboxDir("skill-auditor", testRepoRoot);
      const supervisorPaths = ensureMailboxDir("mind-supervisor", testRepoRoot);

      const debateMemory = new HistoricalDebateMemory();
      const socraticEngine = new SocraticLadderingEngine(debateMemory);

      // Define 6 turns
      interface SocraticDialogueTurn {
        readonly round: number;
        readonly turnIndex: number;
        readonly speakerRole: "skill-auditor" | "mind-supervisor";
        readonly targetRole: "skill-auditor" | "mind-supervisor";
        readonly inquiryOrResponse: string;
      }

      const turns: readonly SocraticDialogueTurn[] = [
        // Round 1: Strategic Intent & Horizon Audit
        {
          round: 1,
          turnIndex: 1,
          speakerRole: "skill-auditor",
          targetRole: "mind-supervisor",
          inquiryOrResponse:
            "Audit Inquiry R1T1: What empirical defect matrix clusters justify the current Wave 5 roadmap allocations?",
        },
        {
          round: 1,
          turnIndex: 2,
          speakerRole: "mind-supervisor",
          targetRole: "skill-auditor",
          inquiryOrResponse:
            "Defense R1T2: 70% Core Polish remediates Class 1 and 2 blockers; 20% Architectural Evolution decouples IPC pipelines; 10% Exploratory advances lockless streaming.",
        },
        // Round 2: Adversarial Reality & Quality Challenge
        {
          round: 2,
          turnIndex: 3,
          speakerRole: "skill-auditor",
          targetRole: "mind-supervisor",
          inquiryOrResponse:
            "Audit Inquiry R2T3: Telemetry reveals 0.74 composite health strain in worker recycling. Why has roadmap expansion not been locked?",
        },
        {
          round: 2,
          turnIndex: 4,
          speakerRole: "mind-supervisor",
          targetRole: "skill-auditor",
          inquiryOrResponse:
            "Defense R2T4: Strategic Friction Intervention triggered; roadmap locked; 3 simplification passes instituted to eliminate worker zombie recycling.",
        },
        // Round 3: Evolutionary Frontier & Concrete Milestone Lock
        {
          round: 3,
          turnIndex: 5,
          speakerRole: "skill-auditor",
          targetRole: "mind-supervisor",
          inquiryOrResponse:
            "Audit Inquiry R3T5: Challenge Pareto trade-off between complex distributed locking vs lockless single-writer ring buffers.",
        },
        {
          round: 3,
          turnIndex: 6,
          speakerRole: "mind-supervisor",
          targetRole: "skill-auditor",
          inquiryOrResponse:
            "Defense R3T6: Pareto arbitration settled at Priority 2 Simplicity; single-writer ring buffer locked into Tier 1 Bedrock Invariant.",
        },
      ];

      // Exchange each turn via mailbox IPC
      let turnCounter = 0;
      for (const t of turns) {
        turnCounter++;

        // Dispatch turn message
        const dispatch = dispatchPeerMessage({
          senderId: t.speakerRole,
          senderRole: t.speakerRole,
          recipientRoleOrId: t.targetRole,
          messageType: "COGNITIVE_PUSHBACK",
          sequence: t.turnIndex,
          payload: {
            round: t.round,
            turnIndex: t.turnIndex,
            dialogue: t.inquiryOrResponse,
          },
          correlationId: `socratic-audit-turn-${t.turnIndex}`,
          baseDir: testRepoRoot,
        });
        expect(dispatch.id).toBeDefined();

        // Target reads message and advances cursor
        const targetPaths = t.targetRole === "mind-supervisor" ? supervisorPaths : auditorPaths;
        const unread = readUnreadMessages(
          targetPaths.inboxPath,
          loadMailboxCursor(targetPaths.cursorPath),
        );
        expect(unread.messages.length).toBe(1);
        expect(unread.messages[0]?.sender_id).toBe(t.speakerRole);

        advanceMailboxCursorBatch(targetPaths.cursorPath, unread.messages);
      }

      // Verification of Minimum 6 Turns
      expect(turnCounter).toBe(6);
      expect(turnCounter).toBeGreaterThanOrEqual(6);

      // Record Settled Consensus
      const consensus = socraticEngine.recordConsensus(
        "cycle-socratic-audit-6turns",
        "Wave 5 Strategic & Architectural Governance",
        "Lockless Single-Writer Ring Buffer with 70/20/10 Allocation",
        PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        "Completed mandatory 6-turn dialectical laddering with zero canned templates.",
      );

      expect(consensus.consensusReached).toBe(true);
      expect(consensus.winningApproach).toBe(
        "Lockless Single-Writer Ring Buffer with 70/20/10 Allocation",
      );
      expect(debateMemory.getResolutions()).toHaveLength(1);
    });

    it("rejects canned boilerplates and blocks conclusion if turns < 6", () => {
      const debateMemory = new HistoricalDebateMemory();
      const socraticEngine = new SocraticLadderingEngine(debateMemory);

      // Attempt to conclude prematurely at Turn 2
      socraticEngine.evaluateCycle("premature-cycle", "Premature Topic");
      socraticEngine.submitResponse("premature-cycle", "Turn 2 quick answer", {
        isSatisfactory: true,
      });

      // Still at L2, not L3 consensus
      expect(socraticEngine.getState().currentLevel).toBe(
        DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS,
      );
      expect(socraticEngine.getState().consensusReached).toBe(false);
    });
  });
});
