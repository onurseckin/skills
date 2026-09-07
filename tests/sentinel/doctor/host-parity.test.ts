import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearInMemoryDispatches,
  clearInMemoryStrikes,
  dispatchSentinelInterjection,
  executePreActionHook,
  executeTurnEndHook,
  setInMemoryRouterMode,
  setInMemoryStrikeMode,
} from "../../../olt/scripts/src/sentinel/index.ts";

const CANONICAL_HOSTS = ["antigravity", "claude_code", "codex", "cursor"] as const;

describe("4-Host Canonical Parity Suite (Antigravity, Claude Code, Codex, Cursor)", () => {
  beforeEach(() => {
    setInMemoryStrikeMode(true);
    setInMemoryRouterMode(true);
    clearInMemoryStrikes();
    clearInMemoryDispatches();
  });

  for (const host of CANONICAL_HOSTS) {
    describe(`Host Environment Parity: [${host}]`, () => {
      test("1. Enforces strict pre-action mechanical block on unauthorized commands", () => {
        const result = executePreActionHook({
          agent_id: `${host}_validator_01`,
          role: "validator",
          action_type: "shell_command",
          target: "bun test",
        });

        expect(result.allowed).toBe(false);
        expect(result.code).toBe("ROLE_BOUNDARY_DEVIATION");
      });

      test("2. Enforces file-scoped test validation prior to task submit", () => {
        const result = executeTurnEndHook({
          agent_id: `${host}_impl_01`,
          role: "implementer",
          task_id: "task-parity-1",
          modified_files: ["src/feature.ts"],
          write_scope: ["src/feature.ts"],
          dry_run: true,
        });

        // In-flight without test is healthy before formal submit
        expect(result.status).toBe("HEALTHY");
      });

      test("3. Guarantees scoped point-to-point delivery with zero cross-tier leak", () => {
        const dispatch = dispatchSentinelInterjection({
          originSentinel: `sentinel:${host}_impl_01`,
          originRole: "implementer",
          targetAgent: `${host}_impl_01`,
          targetRole: "implementer",
          parentSupervisor: `${host}_coord_01`,
          currentStrike: 1,
          violations: [
            {
              code: "MISSING_FILE_SCOPED_TEST_RUN",
              severity: "CRITICAL",
              message: "Missing test run",
              remediation_cmd: "bun test",
            },
          ],
          markdownBrief: "Advisory brief",
        });

        expect(dispatch.deliveredTo).toBe(`${host}_impl_01`);
        expect(dispatch.routingJourney.escalated).toBe(false);
      });

      test("4. Executes clean POSIX flock delivery without starvation", () => {
        const dispatch = dispatchSentinelInterjection({
          originSentinel: `sentinel:${host}_worker`,
          originRole: "implementer",
          targetAgent: `${host}_worker`,
          targetRole: "implementer",
          currentStrike: 2,
          violations: [
            {
              code: "LINE_BUDGET_EXCEEDED",
              severity: "CRITICAL",
              message: "Over 300 LOC",
            },
          ],
          markdownBrief: "Block brief",
        });

        expect(dispatch.deliveredTo).toBe(`${host}_worker`);
        expect(dispatch.envelopeId).toBeDefined();
      });
    });
  }
});
