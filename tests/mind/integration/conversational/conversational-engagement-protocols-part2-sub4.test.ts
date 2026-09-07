import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  advanceMailboxCursorBatch,
  ensureMailboxDir,
  loadMailboxCursor,
  readUnreadMessages,
} from "../../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  MechanicalContainmentEngine,
  type ContainmentResult,
} from "../../../../olt/scripts/src/mind/containment/index.ts";
import {
  cleanupVirtualMindFS,
  scratchRoot,
  setupVirtualMindFS,
} from "../../fixtures/mind-fixture.ts";

describe("Conversational Engagement Protocols & Active Swarm Audit Suite - Mechanical Containment", () => {
  let testRepoRoot: string;

  beforeEach(() => {
    const vfs = setupVirtualMindFS();
    testRepoRoot = scratchRoot("conv-protocols", "sub4");
    vfs.mkdirSync(join(testRepoRoot, ".olt", "mailboxes"), { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("3. Three-Strike Mechanical Containment & Capability Revocation", () => {
    it("escalates across Strike 1 (Halt & Delegate), Strike 2 (Tool Revocation), and Strike 3 (Persona Respawn)", () => {
      const containmentEngine = new MechanicalContainmentEngine();
      const supervisorId = "supervisor-rogue-01";

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

      const state1 = containmentEngine.getAgentState(supervisorId);
      expect(state1.strikeCount).toBe(1);
      expect(state1.isTerminated).toBe(false);

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

      const state2 = containmentEngine.getAgentState(supervisorId);
      expect(state2.strikeCount).toBe(2);
      expect(state2.revokedTools.length).toBeGreaterThan(0);

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

      const state3 = containmentEngine.getAgentState(supervisorId);
      expect(state3.strikeCount).toBe(3);
      expect(state3.isTerminated).toBe(true);

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

    it("handles empty mailbox and idempotent cursor advances gracefully in RAM", () => {
      const paths = ensureMailboxDir("empty-agent", testRepoRoot);
      const cursor = loadMailboxCursor(paths.cursorPath);
      const unread = readUnreadMessages(paths.inboxPath, cursor);
      expect(unread.messages).toHaveLength(0);

      const advanced = advanceMailboxCursorBatch(paths.cursorPath, []);
      expect(advanced).toBeDefined();
    });

    it("enforces supervisory code edit blocks across orchestrators and coordinators with post-termination permanence", () => {
      const containmentEngine = new MechanicalContainmentEngine();
      const coordId = "coordinator-beta";

      const strike1 = containmentEngine.interceptAction({
        agentId: coordId,
        role: "coordinator",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "write_to_file",
        targetFile: "src/index.ts",
      });
      expect(strike1.blocked).toBe(true);
      expect(strike1.strikeLevel).toBe(1);
      expect(strike1.action).toBe("HALT_AND_DELEGATE");

      containmentEngine.interceptAction({
        agentId: coordId,
        role: "coordinator",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "replace_file_content",
      });
      containmentEngine.interceptAction({
        agentId: coordId,
        role: "coordinator",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "run_command",
      });

      const stateAfter3 = containmentEngine.getAgentState(coordId);
      expect(stateAfter3.isTerminated).toBe(true);

      const repeated = containmentEngine.interceptAction({
        agentId: coordId,
        role: "coordinator",
        actionType: "SUPERVISORY_CODE_EDIT",
        attemptedAction: "write_to_file",
      });
      expect(repeated.blocked).toBe(true);
      expect(repeated.action).toBe("PERSONA_RESPAWN");
      expect(containmentEngine.getAgentState(coordId).isTerminated).toBe(true);
    });
  });
});
