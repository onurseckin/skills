import { describe, expect, test } from "bun:test";
import {
  computeBlunderDiscriminator,
  normalizeObservationSignature,
} from "../../../orchestrating-long-tasks/scripts/src/blunders/discriminator.ts";
import type { BlunderRecordInput } from "../../../orchestrating-long-tasks/scripts/src/blunders/types.ts";

describe("Blunder Discriminator & Signature Normalization", () => {
  describe("normalizeObservationSignature", () => {
    test("strips ISO timestamps and replaces with <TIME>", () => {
      const input = "Execution failed at 2026-08-22T09:15:00.000Z during processing";
      const sig = normalizeObservationSignature(input);
      expect(sig).toBe("execution failed at <time> during processing");
    });

    test("strips long hex hashes and replaces with <HASH>", () => {
      const input = "Failed commit a355b5ecb3a2bdd17e67b3f2036a33e6692666b0 in repository";
      const sig = normalizeObservationSignature(input);
      expect(sig).toBe("failed commit <hash> in repository");
    });

    test("strips PID and line number tokens", () => {
      const input = "Process pid=12345 crashed at line=88 in file.ts";
      const sig = normalizeObservationSignature(input);
      expect(sig).toBe("process pid=<pid> crashed at line=<num> in file.ts");
    });

    test("strips generated blunder IDs", () => {
      const input = "Violation tracked in blunder-1724318000-xyz123";
      const sig = normalizeObservationSignature(input);
      expect(sig).toBe("violation tracked in blunder-<id>");
    });

    test("handles empty and non-string inputs safely", () => {
      expect(normalizeObservationSignature("")).toBe("");
      expect(normalizeObservationSignature("   \n\t  ")).toBe("");
    });
  });

  describe("computeBlunderDiscriminator", () => {
    test("returns explicit dedup_key if provided", () => {
      const blunder: BlunderRecordInput = {
        type: "role_confinement_violation",
        dedup_key: "custom::explicit::key::123",
      };
      expect(computeBlunderDiscriminator(blunder)).toBe("custom::explicit::key::123");
    });

    test("derives canonical discriminator from category, type, agent, and normalized signature", () => {
      const b1: BlunderRecordInput = {
        type: "main_thread_direct_execution",
        category: "boundary_violation",
        agent_id: "agent-orch-01",
        observation: "Direct execution at 2026-08-22T10:00:00.000Z by pid=9999",
      };

      const b2: BlunderRecordInput = {
        type: "main_thread_direct_execution",
        category: "boundary_violation",
        agent_id: "agent-orch-01",
        observation: "Direct execution at 2026-08-22T10:05:00.000Z by pid=1111",
      };

      const key1 = computeBlunderDiscriminator(b1);
      const key2 = computeBlunderDiscriminator(b2);

      expect(key1).toBe("boundary_violation::main_thread_direct_execution::agent-orch-01::direct execution at <time> by pid=<pid>");
      expect(key1).toBe(key2);
    });

    test("supports custom discriminator callback", () => {
      const blunder: BlunderRecordInput = {
        type: "syntax_error",
        observation: "Missing semicolon",
      };
      const key = computeBlunderDiscriminator(blunder, {
        customDiscriminator: (b) => `custom::${b.type}`,
      });
      expect(key).toBe("custom::syntax_error");
    });

    test("supports disabling agent ID or category in discriminator", () => {
      const b1: BlunderRecordInput = {
        type: "syntax_error",
        category: "code_defect",
        agent_id: "agent-1",
        observation: "Unused variable",
      };
      const b2: BlunderRecordInput = {
        type: "syntax_error",
        category: "code_defect",
        agent_id: "agent-2",
        observation: "Unused variable",
      };

      const key1 = computeBlunderDiscriminator(b1, { includeAgentId: false });
      const key2 = computeBlunderDiscriminator(b2, { includeAgentId: false });
      expect(key1).toBe(key2);
    });
  });
});
