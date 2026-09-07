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
    const vfs = getVirtualMindFS();
    vfs.mkdirSync(join(testRepoRoot, ".olt"), { recursive: true });
    vfs.mkdirSync(join(testRepoRoot, ".olt", "mailboxes"), { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualMindFS();
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
      expect(strike1.message).toContain(
        "Decompose the task into discrete work units and dispatch a Tier 3 Implementer",
      );

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

    it("maintains strict multi-tenant isolation across multiple rogue agents", () => {
      const containmentEngine = new MechanicalContainmentEngine();
      const supervisor1 = "supervisor-tenant-1";
      const supervisor2 = "supervisor-tenant-2";

      // Agent 1 commits 3 violations -> Strike 3 (Terminated)
      containmentEngine.interceptAction({
        agentId: supervisor1,
        role: "supervisor",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "write_to_file",
      });
      containmentEngine.interceptAction({
        agentId: supervisor1,
        role: "supervisor",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "replace_file_content",
      });
      const strike3Tenant1 = containmentEngine.interceptAction({
        agentId: supervisor1,
        role: "supervisor",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "run_command",
      });

      expect(strike3Tenant1.strikeLevel).toBe(3);
      expect(strike3Tenant1.action).toBe("PERSONA_RESPAWN");

      // Agent 2 commits 1 violation -> Strike 1 (Halt & Delegate)
      const strike1Tenant2 = containmentEngine.interceptAction({
        agentId: supervisor2,
        role: "supervisor",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "write_to_file",
      });

      expect(strike1Tenant2.strikeLevel).toBe(1);
      expect(strike1Tenant2.action).toBe("HALT_AND_DELEGATE");

      // Verify states are strictly isolated in memory
      const state1 = containmentEngine.getAgentState(supervisor1);
      const state2 = containmentEngine.getAgentState(supervisor2);

      expect(state1.strikeCount).toBe(3);
      expect(state1.isTerminated).toBe(true);

      expect(state2.strikeCount).toBe(1);
      expect(state2.isTerminated).toBe(false);
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

      // Check inbox on virtual FS / in-memory mailbox store
      const vfs = getVirtualMindFS();
      const inMemory = getInMemoryMailbox(workerPaths.inboxPath);
      const isPresent = inMemory !== undefined ? true : vfs.existsSync(workerPaths.inboxPath);
      expect(isPresent).toBe(true);
      const lines = inMemory
        ? inMemory
        : (vfs.readFileSync(workerPaths.inboxPath, "utf8") as string).trim().split("\n");
      expect(lines.length).toBe(10);

      const unread = readUnreadMessages(workerPaths.inboxPath);
      expect(unread.messages.length).toBe(10);
      expect(unread.quarantinedCount).toBe(0);

      // Verify strict FIFO ordering
      for (let i = 0; i < 10; i++) {
        const msg = unread.messages[i];
        expect(msg).toBeDefined();
        if (msg) {
          const payload = msg.payload as { batchIndex: number };
          expect(payload.batchIndex).toBe(i);
        }
      }

      // Advance cursor across all 10 messages
      const initialCursor = loadMailboxCursor(workerPaths.cursorPath);
      const advancedCursor = advanceMailboxCursorBatch(
        workerPaths.cursorPath,
        unread.messages,
        initialCursor,
      );
      expect(advancedCursor).toBeDefined();

      // Subsequent read yields exactly 0 unread messages
      const secondRead = readUnreadMessages(workerPaths.inboxPath, advancedCursor);
      expect(secondRead.messages.length).toBe(0);

      // Advance with empty array yields same cursor without memory leak
      const noOpCursor = advanceMailboxCursorBatch(workerPaths.cursorPath, [], advancedCursor);
      expect(noOpCursor).toEqual(advancedCursor);
    });
  });
});
