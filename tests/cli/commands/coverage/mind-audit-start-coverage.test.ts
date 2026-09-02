import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  formatMindAuditStartBrief,
  mindAuditStartCommand,
} from "../../../../olt/scripts/src/cli/commands/mind-audit-start.ts";
import { loadRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../fixtures/task-ops-fixture.ts";

const roots: string[] = [];

function grantAgentRole(run: string, agentId: string, role: string): void {
  transact(run, "coordinator", `grant-${agentId}`, {}, (draft) => {
    const agents = Array.isArray(draft.agents) ? [...draft.agents] : [];
    agents.push({
      id: agentId,
      role,
      parent_agent_id: null,
      parent_task_id: null,
      host: "local",
      granted_at: new Date().toISOString(),
      status: "active",
    });
    draft.agents = agents;
  });
}

describe("mind:audit-start CLI Command Coverage Suite", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(async () => {
    await cleanupRoots(roots);
    cleanupVirtualCliFS();
  });

  test("formatMindAuditStartBrief renders structured summary", () => {
    const brief = formatMindAuditStartBrief({
      auditId: "audit-1",
      runRoot: "/virtual/runs/audit-run",
      actor: "mind-auditor-1",
      windowStart: "2026-09-01T00:00:00.000Z",
      startedAt: "2026-09-01T12:00:00.000Z",
    });

    expect(brief).toContain("### Mind Audit Started: `audit-1`");
    expect(brief).toContain("- **Capsule Root**: `/virtual/runs/audit-run`");
    expect(brief).toContain("- **Auditor Agent**: `mind-auditor-1`");
    expect(brief).toContain("- **Window Start**: `2026-09-01T00:00:00.000Z`");
    expect(brief).toContain("- **Status**: in_progress (awaiting 8-question report)");
  });

  test("mindAuditStartCommand throws on invalid timestamp flag", async () => {
    const { run } = await setupCompiledRun("audit-time-err", roots);

    expect(() =>
      mindAuditStartCommand({
        run,
        actor: "mind-auditor",
        now: "not-a-timestamp",
      }),
    ).toThrow("invalid --now timestamp: not-a-timestamp");
  });

  test("mindAuditStartCommand validates agent authorization and auto-grants mind roles", async () => {
    const { run } = await setupCompiledRun("audit-auth", roots);

    expect(() =>
      mindAuditStartCommand({
        run,
        actor: "unregistered-custom-agent",
      }),
    ).toThrow("agent unregistered-custom-agent holds no grant");

    grantAgentRole(run, "worker-agent", "implementer");
    expect(() =>
      mindAuditStartCommand({
        run,
        actor: "worker-agent",
      }),
    ).toThrow("role 'mind-auditor' or 'mind' is required");

    // Auto-grant for mind-auditor actor
    const res = mindAuditStartCommand({
      run,
      actor: "mind-auditor-auto",
      now: "2026-09-01T12:00:00.000Z",
    });
    expect(res.status).toBe("in_progress");
    expect(res.actor).toBe("mind-auditor-auto");
  });

  test("mindAuditStartCommand throws when mind is halted (with and without reason)", async () => {
    const { run } = await setupCompiledRun("audit-halted", roots);

    transact(run, "coordinator", "halt-mind-with-reason", {}, (draft) => {
      draft.mind = { halted: true, halt_reason: "invariant failure" };
    });

    expect(() =>
      mindAuditStartCommand({
        run,
        actor: "mind-auditor",
      }),
    ).toThrow("mind is halted (invariant failure); cannot start audit. Outcome: halted.");

    transact(run, "coordinator", "halt-mind-no-reason", {}, (draft) => {
      draft.mind = { halted: true };
    });

    expect(() =>
      mindAuditStartCommand({
        run,
        actor: "mind-auditor",
      }),
    ).toThrow("mind is halted (unknown reason); cannot start audit. Outcome: halted.");
  });

  test("mindAuditStartCommand handles counter, explicit auditId, window aliases, and fallback start", async () => {
    const { run } = await setupCompiledRun("audit-counter", roots);
    grantAgentRole(run, "mind-auditor-custom", "mind-auditor");

    // 1. Initial run without existing audit state
    const res1 = mindAuditStartCommand({
      run,
      actor: "mind-auditor-custom",
      now: "2026-09-02T12:00:00.000Z",
    });
    expect(res1.audit_id).toBe("audit-1");
    expect(res1.status).toBe("in_progress");

    // 2. Subsequent run deriving window start from existing audit.last_started_at
    const res2 = mindAuditStartCommand({
      run,
      actor: "mind-auditor-custom",
      now: "2026-09-02T16:00:00.000Z",
    });
    expect(res2.audit_id).toBe("audit-2");
    expect(res2.window_start).toBe("2026-09-02T12:00:00.000Z");

    // 3. Explicit audit-id and window flags
    const res3 = mindAuditStartCommand({
      run,
      actor: "mind-auditor-custom",
      "audit-id": "audit-custom-99",
      window: "2026-09-01T08:00:00.000Z",
    });
    expect(res3.audit_id).toBe("audit-custom-99");
    expect(res3.window_start).toBe("2026-09-01T08:00:00.000Z");

    // 4. Test window-start flag precedence over window
    const res4 = mindAuditStartCommand({
      run,
      actor: "mind-auditor-custom",
      "window-start": "2026-09-01T09:00:00.000Z",
      window: "2026-09-01T08:00:00.000Z",
    });
    expect(res4.window_start).toBe("2026-09-01T09:00:00.000Z");

    // 5. Test fallback to state.audit_counter when audit.counter is absent
    transact(run, "coordinator", "set-audit-counter", {}, (draft) => {
      delete draft.audit;
      draft.audit_counter = 10;
    });
    const res5 = mindAuditStartCommand({
      run,
      actor: "mind-auditor-custom",
    });
    expect(res5.audit_id).toBe("audit-11");

    const loaded = loadRun(run, false);
    const audit = loaded.state.audit as Record<string, unknown>;
    expect(audit.status).toBe("in_progress");
    expect(audit.auditor).toBe("mind-auditor-custom");
    expect(Array.isArray(audit.open_findings)).toBe(true);
  });
});
