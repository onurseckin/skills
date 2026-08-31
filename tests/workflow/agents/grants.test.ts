import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimated, evidenced } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { initRun, loadRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  recordAgentReport,
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../../olt/scripts/src/workflow/agents/grants.ts";
import { readAgentLedger } from "../../../../olt/scripts/src/workflow/agents/ledger.ts";

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

const REGISTRATION_RACER = join(
  import.meta.dir,
  "../../../support/fixtures/agent-registration-racer.fixture.ts",
);

async function waitForBarrier(path: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (existsSync(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`registration racer did not reach start barrier: ${path}`);
}

async function raceConditionalGenesis(
  firstId: string,
  secondId: string,
): Promise<readonly { readonly ok: boolean; readonly code?: string }[]> {
  const repo = mkdtempSync(join(tmpdir(), "grants-race-"));
  try {
    const runRoot = initRun(repo, "test-run", new TextEncoder().encode("task"), "file", true);
    const barrier = join(repo, "registration-race");
    mkdirSync(barrier);
    const racers = [
      ["first", firstId],
      ["second", secondId],
    ].map(([label, agentId]) =>
      Bun.spawn(["bun", REGISTRATION_RACER, runRoot, barrier, label!, agentId!], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    await Promise.all(
      racers.map((_, index) =>
        waitForBarrier(join(barrier, `${index === 0 ? "first" : "second"}.ready`)),
      ),
    );
    writeFileSync(join(barrier, "start"), "go", "utf8");
    const results = await Promise.all(
      racers.map(async (racer) => {
        const [exit, stdout] = await Promise.all([racer.exited, new Response(racer.stdout).text()]);
        expect(exit).toBe(0);
        const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT::"));
        expect(line).toBeDefined();
        return JSON.parse(line!.slice("RESULT::".length)) as { ok: boolean; code?: string };
      }),
    );
    expect(
      readAgentLedger(loadRun(runRoot).state).filter((grant) => grant.status === "active"),
    ).toHaveLength(1);
    expect(
      loadRun(runRoot).events.filter((event) => event.kind === "agent-registered"),
    ).toHaveLength(1);
    return results;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe("workflow/agents/grants", () => {
  test("rejects an untyped registration request that omits transactional authority", () => {
    withRun((runRoot) => {
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "missing-authority",
          role: "coordinator",
          parentAgentId: null,
          parentTaskId: null,
          host: "local",
          maxAgents: 5,
          telemetry: {},
        } as unknown as Parameters<typeof registerAgentGrant>[0]),
      ).toThrow("registration authority is required");
      expect(readAgentLedger(loadRun(runRoot).state)).toHaveLength(0);
    });
  });

  test("serializes real same-run conditional-genesis racers for distinct and identical agent ids", async () => {
    for (const [firstId, secondId] of [
      ["genesis-distinct-a", "genesis-distinct-b"],
      ["genesis-same", "genesis-same"],
    ]) {
      const results = await raceConditionalGenesis(firstId, secondId);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)[0]?.code).toBe(
        firstId === secondId ? "INVALID_STATE" : "AUTHENTICATION_FAILURE",
      );
    }
  }, 15000);

  test("admits exactly one conditional-genesis grant under the transaction lock", () => {
    for (const [firstId, secondId] of [
      ["genesis-a", "genesis-b"],
      ["genesis-same", "genesis-same"],
    ]) {
      withRun((runRoot) => {
        const input = (agentId: string) => ({
          runRoot,
          agentId,
          role: "coordinator" as const,
          parentAgentId: null,
          parentTaskId: null,
          host: "local",
          authority: { kind: "conditional_genesis" as const },
          maxAgents: 5,
          telemetry: {},
        });
        expect(registerAgentGrant(input(firstId)).grant.id).toBe(firstId);
        expect(() => registerAgentGrant(input(secondId))).toThrow(
          firstId === secondId ? "already holds a grant" : "conditional agent genesis",
        );
        expect(
          loadRun(runRoot).events.filter((event) => event.kind === "agent-registered"),
        ).toHaveLength(1);
      });
    }
  });

  test("enforces verified-parent identity, active status, and tier checks in the locked mutator", () => {
    withRun((runRoot) => {
      const register = (
        agentId: string,
        role: "coordinator" | "implementer",
        parent: string | null,
        actor?: string,
      ) => {
        const base = {
          runRoot,
          agentId,
          role,
          parentTaskId: null,
          host: "local",
          maxAgents: 5,
          telemetry: {},
        };
        return parent === null
          ? registerAgentGrant({
              ...base,
              parentAgentId: null,
              authority: { kind: "conditional_genesis" },
            })
          : registerAgentGrant({
              ...base,
              parentAgentId: parent,
              authority: { kind: "verified_parent", actorId: actor ?? parent },
            });
      };

      register("coord-1", "coordinator", null);
      expect(() => register("impl-unrelated", "implementer", "coord-1", "other")).toThrow(
        "does not match parent agent",
      );
      releaseAgentGrant({ runRoot, agentId: "coord-1", actor: "coord-1", reason: "released" });
      expect(() => register("impl-released", "implementer", "coord-1", "coord-1")).toThrow(
        "holds a released grant",
      );
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
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "impl-tier-jump",
          role: "implementer",
          parentAgentId: "orch-1",
          parentTaskId: null,
          host: "local",
          authority: { kind: "verified_parent", actorId: "orch-1" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("may only dispatch Tier 2 Coordinators");
    });
  });

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
          authority: { kind: "verified_parent", actorId: "agent-self" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("an agent cannot be its own parent");
    });

    withRun((runRoot) => {
      registerAgentGrant({
        runRoot,
        agentId: "coordinator-1",
        role: "coordinator",
        parentAgentId: null,
        parentTaskId: null,
        host: "local",
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });
      // Non-existent parent agent throws INVALID_STATE
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-child",
          role: "implementer",
          parentAgentId: "nonexistent-parent",
          parentTaskId: null,
          host: "local",
          authority: { kind: "verified_parent", actorId: "nonexistent-parent" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("agent nonexistent-parent holds no grant");
    });

    withRun((runRoot) => {
      registerAgentGrant({
        runRoot,
        agentId: "coordinator-1",
        role: "coordinator",
        parentAgentId: null,
        parentTaskId: null,
        host: "local",
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });
      // Unknown parent task throws INVALID_STATE
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-task-child",
          role: "implementer",
          parentAgentId: "coordinator-1",
          parentTaskId: "unknown-task-99",
          host: "local",
          authority: { kind: "verified_parent", actorId: "coordinator-1" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("parent task unknown-task-99 does not exist in this run");
    });
  });

  test("registerAgentGrant enforces the parent's declared spawn allowlist directly, not only through the CLI gate", () => {
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

      // Registering again with same ID throws INVALID_STATE
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

      // Register child grant with explicitLevel unknown
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

      // Exceeding budget throws INVALID_STATE
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-3",
          role: "implementer",
          parentAgentId: "agent-root",
          parentTaskId: null,
          host: "local",
          authority: { kind: "verified_parent", actorId: "agent-root" },
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
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });

      // Missing all reporting metrics throws INVALID_ARGUMENT
      expect(() =>
        recordAgentReport({
          runRoot,
          agentId: "agent-1",
          actor: "agent-1",
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
        actor: "agent-1",
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
        actor: "agent-1",
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
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });

      // Empty reason throws INVALID_ARGUMENT
      expect(() =>
        releaseAgentGrant({
          runRoot,
          agentId: "agent-rel",
          actor: "agent-rel",
          reason: "   ",
        }),
      ).toThrow(HarnessError);

      // Successful release
      const rel = releaseAgentGrant({
        runRoot,
        agentId: "agent-rel",
        actor: "agent-rel",
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
          actor: "agent-rel",
          reason: "try releasing again",
        }),
      ).toThrow("already released its grant");

      // Reporting on released agent throws INVALID_STATE
      expect(() =>
        recordAgentReport({
          runRoot,
          agentId: "agent-rel",
          actor: "agent-rel",
          tools: [{ name: "view_file" }],
          tokensEstimated: false,
        }),
      ).toThrow("released its grant and can no longer report");

      // Reporting as different actor throws AUTHENTICATION_FAILURE
      expect(() =>
        recordAgentReport({
          runRoot,
          agentId: "agent-rel",
          actor: "other-actor",
          tools: [{ name: "view_file" }],
          tokensEstimated: false,
        }),
      ).toThrow(HarnessError);
    });
  });

  test("releaseAgentGrant and registerAgentGrant authorization error branches", () => {
    withRun((runRoot) => {
      // Register parent coordinator
      registerAgentGrant({
        runRoot,
        agentId: "coord-1",
        role: "coordinator",
        parentTaskId: null,
        parentAgentId: null,
        host: "antigravity",
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });

      // Register child worker under coord-1
      registerAgentGrant({
        runRoot,
        agentId: "worker-1",
        role: "implementer",
        parentTaskId: "T-1",
        parentAgentId: "coord-1",
        host: "antigravity",
        authority: { kind: "verified_parent", actorId: "coord-1" },
        maxAgents: 5,
        telemetry: {},
      });

      // Register worker-2 under coord-1
      registerAgentGrant({
        runRoot,
        agentId: "worker-2",
        role: "implementer",
        parentTaskId: "T-1",
        parentAgentId: "coord-1",
        host: "antigravity",
        authority: { kind: "verified_parent", actorId: "coord-1" },
        maxAgents: 5,
        telemetry: {},
      });

      // Releasing worker-1 as peer worker-2 throws AUTHENTICATION_FAILURE
      expect(() =>
        releaseAgentGrant({
          runRoot,
          agentId: "worker-1",
          actor: "worker-2",
          reason: "try release",
        }),
      ).toThrow("is not authenticated actor 'worker-2' or its active direct child");

      // Releasing child as parent succeeds
      const released = releaseAgentGrant({
        runRoot,
        agentId: "worker-1",
        actor: "coord-1",
        reason: "parent completed worker",
      });
      expect(released.grant.status).toBe("released");

      // verified_parent registration with empty parentAgentId throws AUTHENTICATION_FAILURE
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "worker-bad",
          role: "implementer",
          parentTaskId: "T-1",
          parentAgentId: null,
          host: "antigravity",
          authority: { kind: "verified_parent", actorId: "coord-1" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("verified parent registration requires a nonempty ledger and a named parent agent");

      // conditional_genesis on non-empty ledger throws AUTHENTICATION_FAILURE
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "worker-noparent",
          role: "implementer",
          parentTaskId: "T-1",
          parentAgentId: null,
          host: "antigravity",
          authority: { kind: "conditional_genesis" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("conditional agent genesis is valid only for the first grant in an empty ledger");
    });
  });
});
