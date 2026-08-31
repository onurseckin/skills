import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  CumulativePhaseInvariantEngine,
  DeductiveStateMachine,
} from "../../../../olt/scripts/src/cli/phase-invariants.ts";
import type { CommandSpec } from "../../../../olt/scripts/src/cli/registry/index.ts";

describe("CumulativePhaseInvariantEngine & DeductiveStateMachine", () => {
  describe("DeductiveStateMachine", () => {
    it("verifies plan phase with requirements, plan_compiled, graph, review, or tasks", () => {
      expect(new DeductiveStateMachine({}).isPhaseVerified("plan")).toBe(false);
      expect(
        new DeductiveStateMachine({ requirements: { reqs: [] } }).isPhaseVerified("plan"),
      ).toBe(true);
      expect(new DeductiveStateMachine({ plan_compiled: true }).isPhaseVerified("plan")).toBe(true);
      expect(new DeductiveStateMachine({ graph: { revision: 1 } }).isPhaseVerified("plan")).toBe(
        true,
      );
      expect(
        new DeductiveStateMachine({ completion_review: { status: "approved" } }).isPhaseVerified(
          "plan",
        ),
      ).toBe(true);
      expect(new DeductiveStateMachine({ tasks: { "t-1": {} } }).isPhaseVerified("plan")).toBe(
        true,
      );
      expect(new DeductiveStateMachine({ tasks: {} }).isPhaseVerified("plan")).toBe(false);
    });

    it("verifies queue and task phases with graph, review, critic, or non-empty tasks", () => {
      expect(new DeductiveStateMachine({}).isPhaseVerified("queue")).toBe(false);
      expect(new DeductiveStateMachine({}).isPhaseVerified("task")).toBe(false);
      expect(new DeductiveStateMachine({ graph: {} }).isPhaseVerified("queue")).toBe(true);
      expect(new DeductiveStateMachine({ completion_review: {} }).isPhaseVerified("task")).toBe(
        true,
      );
      expect(new DeductiveStateMachine({ completion_critic: {} }).isPhaseVerified("task")).toBe(
        true,
      );
      expect(new DeductiveStateMachine({ tasks: { "t-1": {} } }).isPhaseVerified("queue")).toBe(
        true,
      );
    });

    it("verifies critic phase with verdict, review, completion_review, or reviewed critic status", () => {
      expect(new DeductiveStateMachine({}).isPhaseVerified("critic")).toBe(false);
      expect(
        new DeductiveStateMachine({ critic_verdict: "approved" }).isPhaseVerified("critic"),
      ).toBe(true);
      expect(new DeductiveStateMachine({ critic_review: {} }).isPhaseVerified("critic")).toBe(true);
      expect(new DeductiveStateMachine({ completion_review: {} }).isPhaseVerified("critic")).toBe(
        true,
      );
      expect(
        new DeductiveStateMachine({ completion_critic: { status: "reviewed" } }).isPhaseVerified(
          "critic",
        ),
      ).toBe(true);
      expect(
        new DeductiveStateMachine({ completion_critic: { status: "in_progress" } }).isPhaseVerified(
          "critic",
        ),
      ).toBe(false);
    });

    it("verifies run phase with completion_result and passes unknown phases by default", () => {
      expect(new DeductiveStateMachine({}).isPhaseVerified("run")).toBe(false);
      expect(
        new DeductiveStateMachine({ completion_result: { ok: true } }).isPhaseVerified("run"),
      ).toBe(true);
      expect(new DeductiveStateMachine({}).isPhaseVerified("unknown_phase")).toBe(true);
    });
  });

  describe("CumulativePhaseInvariantEngine", () => {
    const makeSpec = (name: string, domain?: string): CommandSpec => ({
      name,
      domain: (domain ?? "default") as CommandSpec["domain"],
      description: `Command ${name}`,
      handler: async () => ({}),
      flags: {},
    });

    it("allows read-only inspector commands without prerequisites", () => {
      const spec = makeSpec("run:status", "run");
      expect(() => CumulativePhaseInvariantEngine.verify(spec, {})).not.toThrow();
    });

    it("enforces plan prerequisite for queue commands and suggests remedial action", () => {
      const queueSpec = makeSpec("queue:pop", "queue");
      expect(() => CumulativePhaseInvariantEngine.verify(queueSpec, {})).toThrow(HarnessError);
      try {
        CumulativePhaseInvariantEngine.verify(queueSpec, {});
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.fix).toContain("plan:compile");
      }

      expect(() =>
        CumulativePhaseInvariantEngine.verify(queueSpec, { graph: { revision: 1 } }),
      ).not.toThrow();
    });

    it("enforces plan and queue prerequisites for task commands", () => {
      const taskSpec = makeSpec("task:claim", "task");
      expect(() => CumulativePhaseInvariantEngine.verify(taskSpec, {})).toThrow(HarnessError);
      expect(() =>
        CumulativePhaseInvariantEngine.verify(taskSpec, { graph: { revision: 1 } }),
      ).not.toThrow();
    });

    it("enforces plan, queue, and task prerequisites for critic, run:exec, and shell commands", () => {
      const criticSpec = makeSpec("critic:start", "critic");
      const shellSpec = makeSpec("shell", "core");
      const runExecSpec = makeSpec("run:exec", "run");

      expect(() => CumulativePhaseInvariantEngine.verify(criticSpec, {})).toThrow(HarnessError);
      expect(() => CumulativePhaseInvariantEngine.verify(shellSpec, {})).toThrow(HarnessError);
      expect(() => CumulativePhaseInvariantEngine.verify(runExecSpec, {})).toThrow(HarnessError);

      const verifiedState = { graph: { revision: 1 }, tasks: { "t-1": {} } };
      expect(() => CumulativePhaseInvariantEngine.verify(criticSpec, verifiedState)).not.toThrow();
      expect(() => CumulativePhaseInvariantEngine.verify(shellSpec, verifiedState)).not.toThrow();
      expect(() => CumulativePhaseInvariantEngine.verify(runExecSpec, verifiedState)).not.toThrow();
    });

    it("enforces plan, queue, task, and critic prerequisites for run:complete", () => {
      const completeSpec = makeSpec("run:complete", "run");
      const partialState = { graph: { revision: 1 }, tasks: { "t-1": {} } };
      expect(() => CumulativePhaseInvariantEngine.verify(completeSpec, partialState)).toThrow(
        HarnessError,
      );

      const fullState = {
        graph: { revision: 1 },
        tasks: { "t-1": {} },
        critic_verdict: "approved",
      };
      expect(() => CumulativePhaseInvariantEngine.verify(completeSpec, fullState)).not.toThrow();
    });
  });
});
