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
  const repo = mkdtempSync(join(tmpdir(), "grants-report-"));
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

describe("workflow/agents/grants: reporting and releases", () => {
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

      expect(() =>
        releaseAgentGrant({
          runRoot,
          agentId: "agent-rel",
          actor: "agent-rel",
          reason: "   ",
        }),
      ).toThrow(HarnessError);

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

      expect(() =>
        releaseAgentGrant({
          runRoot,
          agentId: "agent-rel",
          actor: "agent-rel",
          reason: "try releasing again",
        }),
      ).toThrow("already released its grant");

      expect(() =>
        recordAgentReport({
          runRoot,
          agentId: "agent-rel",
          actor: "agent-rel",
          tools: [{ name: "view_file" }],
          tokensEstimated: false,
        }),
      ).toThrow("released its grant and can no longer report");

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

      expect(() =>
        releaseAgentGrant({
          runRoot,
          agentId: "worker-1",
          actor: "worker-2",
          reason: "try release",
        }),
      ).toThrow("is not authenticated actor 'worker-2' or its active direct child");

      const released = releaseAgentGrant({
        runRoot,
        agentId: "worker-1",
        actor: "coord-1",
        reason: "parent completed worker",
      });
      expect(released.grant.status).toBe("released");

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
