import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimated, evidenced } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  recordAgentReport,
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../../olt/scripts/src/workflow/agents/grants.ts";

function withRun<T>(body: (runRoot: string) => T): T {
  const repo = mkdtempSync(join(tmpdir(), "grants-lifecycle-"));
  try {
    const runRoot = initRun(repo, "test-run", new TextEncoder().encode("task"), "file", true);
    transact(runRoot, "setup", "add-task", {}, (draft) => {
      draft.tasks = { "T-1": { id: "T-1" } };
    });
    return body(runRoot);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe("workflow/agents/grants: lifecycle and reporting", () => {
  test("registerAgentGrant enforces the parent's declared spawn allowlist", () => {
    withRun((runRoot) => {
      registerAgentGrant({
        runRoot,
        agentId: "mind-auditor-1",
        role: "mind-auditor",
        parentAgentId: null,
        parentTaskId: null,
        host: "local",
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });

      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "orch-illegit",
          role: "orchestrator",
          parentAgentId: "mind-auditor-1",
          parentTaskId: null,
          host: "local",
          authority: { kind: "verified_parent", actorId: "mind-auditor-1" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("Declared spawn allowlist violation");
    });

    withRun((runRoot) => {
      registerAgentGrant({
        runRoot,
        agentId: "orch-1",
        role: "orchestrator",
        parentAgentId: null,
        parentTaskId: null,
        host: "local",
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });
      const legit = registerAgentGrant({
        runRoot,
        agentId: "coord-1",
        role: "coordinator",
        parentAgentId: "orch-1",
        parentTaskId: null,
        host: "local",
        authority: { kind: "verified_parent", actorId: "orch-1" },
        maxAgents: 5,
        telemetry: {},
      });
      expect(legit.grant.id).toBe("coord-1");
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
        authority: { kind: "conditional_genesis" },
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

      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-root",
          role: "coordinator",
          parentAgentId: null,
          parentTaskId: null,
          host: "local",
          authority: { kind: "conditional_genesis" },
          maxAgents: 3,
          telemetry: {},
        }),
      ).toThrow("agent agent-root already holds a grant");

      const childOutcome = registerAgentGrant({
        runRoot,
        agentId: "agent-child",
        role: "implementer",
        parentAgentId: "agent-root",
        parentTaskId: "T-1",
        host: "local",
        authority: { kind: "verified_parent", actorId: "agent-root" },
        maxAgents: 3,
        telemetry: {
          modelTier: "unknown" as const,
          thinkingLevel: "unknown" as const,
        },
      });
      expect(childOutcome.grant.model_tier).toEqual(evidenced("unknown", "unknown"));
      expect(childOutcome.grant.thinking_level).toEqual(evidenced("unknown", "unknown"));

      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-3",
          role: "implementer",
          parentAgentId: "agent-root",
          parentTaskId: null,
          host: "local",
          authority: { kind: "verified_parent", actorId: "agent-root" },
          maxAgents: 2,
          telemetry: {},
        }),
      ).toThrow("max_agents budget of 2 is exhausted");
    });
  });
});

