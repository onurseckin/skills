import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimated, evidenced } from "../../../../olt/scripts/src/core/contracts/evidence.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/harness-error.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  recordAgentReport,
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../../olt/scripts/src/workflow/agents/grants.ts";

function withRun<T>(body: (runRoot: string) => T): T {
  const repo = mkdtempSync(join(tmpdir(), "grants-run-"));
  try {
    const runRoot = initRun(repo, "test-run", new TextEncoder().encode("task"), "file", true);
    // Add known task T-1
    transact(runRoot, "setup", "add-task", {}, (draft) => {
      draft.tasks = { "T-1": { id: "T-1" } };
    });
    return body(runRoot);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe("workflow/agents/grants", () => {
  test("registerAgentGrant validates parent agent and parent task constraints", () => {
    withRun((runRoot) => {
      // Self-parenting throws INVALID_ARGUMENT
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-self",
          role: "implementer",
          parentAgentId: "agent-self",
          parentTaskId: null,
          host: "local",
          actor: "user",
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("an agent cannot be its own parent");

      // Non-existent parent agent throws INVALID_STATE
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-child",
          role: "implementer",
          parentAgentId: "nonexistent-parent",
          parentTaskId: null,
          host: "local",
          actor: "user",
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("agent nonexistent-parent holds no grant");

      // Unknown parent task throws INVALID_STATE
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-task-child",
          role: "implementer",
          parentAgentId: null,
          parentTaskId: "unknown-task-99",
          host: "local",
          actor: "user",
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("parent task unknown-task-99 does not exist in this run");
    });
  });

  test("registerAgentGrant mints grant with full telemetry, derived capabilities, and transcript", () => {
    withRun((runRoot) => {
      const outcome = registerAgentGrant({
        runRoot,
        agentId: "agent-root",
        role: "coordinator",
        parentAgentId: null,
        parentTaskId: "T-1",
        host: "local",
        actor: "coordinator",
        maxAgents: 3,
        telemetry: {
          provider: "anthropic",
          model: "claude-3-7-sonnet",
          modelTier: "l",
          thinkingLevel: "high",
          contextWindow: 200000,
          toolsGranted: [{ name: "view_file" }, { name: "run_command" }],
        },
        derivedTelemetry: {
          hostTool: "test-tool",
          capabilities: { fs: true },
          transcript: {
            sourcePath: "/path/to/transcript.jsonl",
            agentType: "lead",
            spawnDepth: 0,
            tools: [],
          },
        },
        now: new Date("2026-08-20T00:00:00.000Z"),
      });

      expect(outcome.grant.id).toBe("agent-root");
      expect(outcome.grant.role).toBe("coordinator");
      expect(outcome.grant.status).toBe("active");
      expect(outcome.grant.provider).toEqual(evidenced("anthropic", "agent_reported"));
      expect(outcome.grant.model).toEqual(evidenced("claude-3-7-sonnet", "agent_reported"));
      expect(outcome.grant.model_tier).toEqual(evidenced("l", "agent_reported"));
      expect(outcome.grant.thinking_level).toEqual(evidenced("high", "agent_reported"));
      expect(outcome.grant.context_window).toEqual(evidenced(200000, "agent_reported"));
      expect(outcome.grant.tools_granted).toEqual(
        evidenced([{ name: "view_file" }, { name: "run_command" }], "agent_reported"),
      );
      expect(outcome.ledger).toHaveLength(1);

      // Registering again with same ID throws INVALID_STATE
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-root",
          role: "coordinator",
          parentAgentId: null,
          parentTaskId: null,
          host: "local",
          actor: "coordinator",
          maxAgents: 3,
          telemetry: {},
        }),
      ).toThrow("agent agent-root already holds a grant");

      // Register child grant with explicitLevel unknown
      const childOutcome = registerAgentGrant({
        runRoot,
        agentId: "agent-child",
        role: "implementer",
        parentAgentId: "agent-root",
        parentTaskId: "T-1",
        host: "local",
        actor: "agent-root",
        maxAgents: 3,
        telemetry: {
          modelTier: "unknown" as const,
          thinkingLevel: "unknown" as const,
        },
      });
      expect(childOutcome.grant.model_tier).toEqual(evidenced("unknown", "unknown"));
      expect(childOutcome.grant.thinking_level).toEqual(evidenced("unknown", "unknown"));

      // Exceeding budget throws INVALID_STATE
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-3",
          role: "worker",
          parentAgentId: "agent-root",
          parentTaskId: null,
          host: "local",
          actor: "agent-root",
          maxAgents: 2, // maxAgents is 2, but ledger already has 2
          telemetry: {},
        }),
      ).toThrow("max_agents budget of 2 is exhausted");
    });
  });

  test("recordAgentReport validates input arguments and records incremental reports", () => {
    withRun((runRoot) => {
      registerAgentGrant({
        runRoot,
        agentId: "agent-1",
        role: "implementer",
        parentAgentId: null,
        parentTaskId: null,
        host: "local",
        actor: "coordinator",
        maxAgents: 5,
        telemetry: {},
      });

      // Missing all reporting metrics throws INVALID_ARGUMENT
      expect(() =>
        recordAgentReport({
          runRoot,
          agentId: "agent-1",
          actor: "worker",
          tools: [],
          tokensEstimated: false,
        }),
      ).toThrow(
        "agent:report needs at least one of --tool, --tokens-in, --tokens-out or --token-extra",
      );

      // First report with tools and tokens
      const r1 = recordAgentReport({
        runRoot,
        agentId: "agent-1",
        actor: "worker",
        tools: [{ name: "view_file", category: "fs", extras: { count: 1 } }],
        tokensIn: 500,
        tokensOut: 100,
        tokenExtras: { cache_read: 200 },
        tokensEstimated: false,
        now: new Date("2026-08-20T10:00:00.000Z"),
      });

      expect(r1.grant.report_count).toBe(1);
      expect(r1.grant.tokens_in).toEqual(evidenced(500, "agent_reported"));
      expect(r1.grant.tokens_out).toEqual(evidenced(100, "agent_reported"));
      expect(r1.grant.token_extras).toEqual({ cache_read: evidenced(200, "agent_reported") });
      expect(r1.grant.tools_used).toHaveLength(1);
      expect(r1.grant.tools_used![0]).toEqual({
        name: "view_file",
        category: "fs",
        extras: { count: 1 },
        evidence_class: "agent_reported",
        first_reported_at: "2026-08-20T10:00:00.000Z",
      });

      // Second report updating existing tool and estimated tokens
      const r2 = recordAgentReport({
        runRoot,
        agentId: "agent-1",
        actor: "worker",
        tools: [{ name: "view_file", category: "fs_updated", extras: { extra_metric: 2 } }],
        tokensIn: 1000,
        tokensEstimated: true,
      });

      expect(r2.grant.report_count).toBe(2);
      expect(r2.grant.tokens_in).toEqual(estimated(1000));
      expect(r2.grant.tools_used![0]!.category).toBe("fs_updated");
      expect(r2.grant.tools_used![0]!.extras).toEqual({ count: 1, extra_metric: 2 });
    });
  });

  test("releaseAgentGrant and reporting on released agents", () => {
    withRun((runRoot) => {
      registerAgentGrant({
        runRoot,
        agentId: "agent-rel",
        role: "implementer",
        parentAgentId: null,
        parentTaskId: null,
        host: "local",
        actor: "coordinator",
        maxAgents: 5,
        telemetry: {},
      });

      // Empty reason throws INVALID_ARGUMENT
      expect(() =>
        releaseAgentGrant({
          runRoot,
          agentId: "agent-rel",
          actor: "worker",
          reason: "   ",
        }),
      ).toThrow(HarnessError);

      // Successful release
      const rel = releaseAgentGrant({
        runRoot,
        agentId: "agent-rel",
        actor: "worker",
        reason: "work completed successfully",
        now: new Date("2026-08-20T12:00:00.000Z"),
      });
      expect(rel.grant.status).toBe("released");
      expect(rel.grant.release_reason).toBe("work completed successfully");
      expect(rel.grant.released_at).toBe("2026-08-20T12:00:00.000Z");

      // Releasing again throws INVALID_STATE
      expect(() =>
        releaseAgentGrant({
          runRoot,
          agentId: "agent-rel",
          actor: "worker",
          reason: "try releasing again",
        }),
      ).toThrow("already released its grant");

      // Reporting on released agent throws INVALID_STATE
      expect(() =>
        recordAgentReport({
          runRoot,
          agentId: "agent-rel",
          actor: "worker",
          tools: [{ name: "view_file" }],
          tokensEstimated: false,
        }),
      ).toThrow("released its grant and can no longer report");
    });
  });
});
