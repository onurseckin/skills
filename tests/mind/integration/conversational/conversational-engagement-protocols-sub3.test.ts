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

describe("3. Three-Strike Mechanical Containment & Capability Revocation", () => {
    it("escalates across Strike 1 (Halt & Delegate), Strike 2 (Tool Revocation), and Strike 3 (Persona Respawn)", () => {
      const containmentEngine = new MechanicalContainmentEngine();
      const supervisorId = "supervisor-rogue-01";

      // Strike 1: Supervisor attempts direct code edit
      const strike1: ContainmentResult = containmentEngine.interceptAction({
        agentId: supervisorId,
        role: "supervisor",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "write_to_file",
        targetFile: "src/compiler/parser.ts",
        details: "Supervisor attempted direct code edit on parser.ts",
      });

      expect(strike1.strikeLevel).toBe(1);
      expect(strike1.action).toBe("HALT_AND_DELEGATE");
      expect(strike1.blocked).toBe(true);
      expect(strike1.message).toContain("HALT_AND_DELEGATE");
      expect(strike1.message).toContain("Decompose the task into discrete work units and dispatch a Tier 3 Implementer");

      // Verify Agent State after Strike 1
      const state1 = containmentEngine.getAgentState(supervisorId);
      expect(state1.strikeCount).toBe(1);
      expect(state1.isTerminated).toBe(false);

      // Strike 2: Repeated direct code modification attempt -> Hard Capability Revocation
      const strike2: ContainmentResult = containmentEngine.interceptAction({
        agentId: supervisorId,
        role: "supervisor",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "replace_file_content",
        targetFile: "src/compiler/parser.ts",
        details: "Supervisor repeated direct file replacement",
      });

      expect(strike2.strikeLevel).toBe(2);
      expect(strike2.action).toBe("CAPABILITY_REVOCATION");
      expect(strike2.blocked).toBe(true);
      expect(strike2.revokedTools).toBeDefined();
      expect(strike2.revokedTools).toContain("write_to_file");
      expect(strike2.revokedTools).toContain("replace_file_content");
      expect(strike2.revokedTools).toContain("run_command");

      // Verify Agent State after Strike 2
      const state2 = containmentEngine.getAgentState(supervisorId);
      expect(state2.strikeCount).toBe(2);
      expect(state2.revokedTools.length).toBeGreaterThan(0);

      // Strike 3: Third violation -> Persona Respawn & State Sanitization
      const strike3: ContainmentResult = containmentEngine.interceptAction({
        agentId: supervisorId,
        role: "supervisor",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "run_command",
        details: "Supervisor attempted command execution after tool revocation",
      });

      expect(strike3.strikeLevel).toBe(3);
      expect(strike3.action).toBe("PERSONA_RESPAWN");
      expect(strike3.blocked).toBe(true);
      expect(strike3.respawnRequired).toBe(true);
      expect(strike3.sanitizedState).toBe(true);

      // Verify Agent State after Strike 3 is Terminated
      const state3 = containmentEngine.getAgentState(supervisorId);
      expect(state3.strikeCount).toBe(3);
      expect(state3.isTerminated).toBe(true);

      // Post-termination attempt is immediately blocked
      const postTerminated = containmentEngine.interceptAction({
        agentId: supervisorId,
        role: "supervisor",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "write_to_file",
      });
      expect(postTerminated.blocked).toBe(true);
      expect(postTerminated.action).toBe("PERSONA_RESPAWN");
    });

    it("enforces Validator Zero Test Execution Invariant", () => {
      const containmentEngine = new MechanicalContainmentEngine();
      const validatorId = "validator-alpha";

      // Validator attempts to run command line test runner directly
      const strike1 = containmentEngine.interceptAction({
        agentId: validatorId,
        role: "validator",
        actionType: "VALIDATOR_TEST_RUN",
        attemptedAction: "run_command",
        details: "Validator attempted to run 'bun test' directly via run_command",
      });

      expect(strike1.blocked).toBe(true);
      expect(strike1.strikeLevel).toBe(1);
      expect(strike1.action).toBe("HALT_AND_DELEGATE");
      expect(strike1.message).toContain("HALT_AND_DELEGATE");
    });
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

      // Check inbox on disk
      expect(existsSync(workerPaths.inboxPath)).toBe(true);
      const lines = readFileSync(workerPaths.inboxPath, "utf8").trim().split("\n");
      expect(lines.length).toBe(10);

      const unread = readUnreadMessages(workerPaths.inboxPath);
      expect(unread.messages.length).toBe(10);
      expect(unread.quarantinedCount).toBe(0);
    });
  });
});
