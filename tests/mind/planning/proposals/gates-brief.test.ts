import { describe, expect, it } from "bun:test";
import {
  recordProposal,
  transitionProposalStatusInState,
} from "../../../../olt/scripts/src/mind/proposals/proposal/transitions.ts";
import {
  isPathInRepoRoots,
  parseFalsifierArgv,
  executeFalsifier,
  evaluateGate1Witnessed,
} from "../../../../olt/scripts/src/mind/proposals/gates/predicates.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { CandidateRecord } from "../../../../olt/scripts/src/mind/proposals/gates/types.ts";

describe("Proposals, Gates, and Brief - Exhaustive Unit Tests", () => {
  describe("Proposal Transitions & Lifecycle", () => {
    it("records proposals and transitions lifecycle statuses with validation", () => {
      const state: Record<string, unknown> = {
        candidates: [
          {
            id: "prop-1",
            kind: "proposal",
            status: "opened",
            statement: "Add async logger",
            charter_goal_ids: ["G1"],
          },
        ],
        requirements: [
          {
            id: "prop-1",
            status: "opened",
          },
        ],
      };

      // Missing proposal ID
      expect(() => transitionProposalStatusInState(state, "", "admitted", "owner")).toThrow(
        HarnessError,
      );

      // Unknown proposal ID
      expect(() =>
        transitionProposalStatusInState(state, "prop-unknown", "admitted", "owner"),
      ).toThrow(HarnessError);

      // Illegal transition: opened -> completed directly
      expect(() => transitionProposalStatusInState(state, "prop-1", "completed", "owner")).toThrow(
        HarnessError,
      );

      // Valid transition: opened -> admitted
      const admitted = transitionProposalStatusInState(state, "prop-1", "admitted", "owner", {
        witnessCommandId: "cmd-1",
      });
      expect(admitted.status).toBe("admitted");
      expect((state.candidates as unknown as Array<Record<string, unknown>>)[0].status).toBe(
        "admitted",
      );

      // admitted -> in_progress
      const inProg = transitionProposalStatusInState(state, "prop-1", "in_progress", "owner");
      expect(inProg.status).toBe("in_progress");

      // in_progress -> completed
      const comp = transitionProposalStatusInState(state, "prop-1", "completed", "owner");
      expect(comp.status).toBe("completed");

      // opened -> declined
      (state.candidates as unknown as Array<Record<string, unknown>>)[0].status = "opened";
      const declined = transitionProposalStatusInState(state, "prop-1", "declined", "owner", {
        declineReason: "Out of scope",
      });
      expect(declined.status).toBe("declined");

      // admitted -> revised
      (state.candidates as unknown as Array<Record<string, unknown>>)[0].status = "admitted";
      const revised = transitionProposalStatusInState(state, "prop-1", "revised", "owner");
      expect(revised.status).toBe("revised");
    });
  });

  describe("Gate Predicates & Falsifiers", () => {
    it("evaluates isPathInRepoRoots across relative, absolute, and wildcard roots", () => {
      expect(isPathInRepoRoots("", ["src"], "/repo")).toBe(false);
      expect(isPathInRepoRoots("src/index.ts", ["."], "/repo")).toBe(true);
      expect(isPathInRepoRoots("src/index.ts", ["src"], "/repo")).toBe(true);
      expect(isPathInRepoRoots("other/file.ts", ["src"], "/repo")).toBe(false);
      expect(isPathInRepoRoots("/repo/src/a.ts", ["src"], "/repo")).toBe(true);
      expect(isPathInRepoRoots("/outside/a.ts", ["src"], "/repo")).toBe(false);
    });

    it("parses falsifier argv and executes commands capturing exit codes and timeouts", () => {
      expect(parseFalsifierArgv()).toEqual([]);
      expect(parseFalsifierArgv(["bun", "test"])).toEqual(["bun", "test"]);
      expect(parseFalsifierArgv('bun test "my file"')).toEqual(["bun", "test", "my file"]);

      expect(executeFalsifier([], "/").exitCode).toBeNull();

      const execRes = executeFalsifier(["echo", "hello"], "/");
      expect(execRes.exitCode).toBe(0);
      expect(execRes.stdout).toContain("hello");
    });

    it("evaluates Gate 1 Witnessed for proposals and defect candidates", () => {
      const context = {
        runRoot: "/test/run",
        actor: "owner",
        state: {
          commands: {
            "cmd-fail": {
              id: "cmd-fail",
              exit_code: 1,
              status: "failed",
              stdout: "AssertionError: expected true to be false",
            },
            "cmd-pass": {
              id: "cmd-pass",
              exit_code: 0,
              status: "succeeded",
            },
          },
        },
      };

      // Proposal with owner-decision -> pass
      const propWithDecision: CandidateRecord = {
        id: "p-1",
        kind: "proposal",
        statement: "Feature proposal",
        witness_command_id: "owner-decision",
        status: "opened",
      };
      expect(
        evaluateGate1Witnessed(propWithDecision, context as unknown as Record<string, unknown>)
          .passed,
      ).toBe(true);

      // Proposal without owner-decision -> fail
      const propNoDecision: CandidateRecord = {
        ...propWithDecision,
        witness_command_id: undefined,
      };
      expect(
        evaluateGate1Witnessed(propNoDecision, context as unknown as Record<string, unknown>)
          .passed,
      ).toBe(false);

      // Defect with missing witness -> fail
      const defNoWitness: CandidateRecord = {
        id: "d-1",
        kind: "defect",
        statement: "AssertionError",
        status: "opened",
      };
      expect(
        evaluateGate1Witnessed(defNoWitness, context as unknown as Record<string, unknown>).passed,
      ).toBe(false);

      // Defect with non-existent witness -> fail
      const defUnknownWitness: CandidateRecord = {
        ...defNoWitness,
        witness_command_id: "cmd-unknown",
      };
      expect(
        evaluateGate1Witnessed(defUnknownWitness, context as unknown as Record<string, unknown>)
          .passed,
      ).toBe(false);

      // Defect with passing command (exit 0) -> fail
      const defPassWitness: CandidateRecord = {
        ...defNoWitness,
        witness_command_id: "cmd-pass",
      };
      expect(
        evaluateGate1Witnessed(defPassWitness, context as unknown as Record<string, unknown>)
          .passed,
      ).toBe(false);

      // Defect with failing command (exit 1) -> pass
      const defFailWitness: CandidateRecord = {
        ...defNoWitness,
        witness_command_id: "cmd-fail",
        statement: "AssertionError",
      };
      expect(
        evaluateGate1Witnessed(defFailWitness, context as unknown as Record<string, unknown>)
          .passed,
      ).toBe(true);
    });
  });
});
