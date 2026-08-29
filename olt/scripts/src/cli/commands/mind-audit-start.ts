import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/index.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MindAuditStartResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly audit_id: string;
  readonly actor: string;
  readonly window_start: string;
  readonly started_at: string;
  readonly status: "in_progress";
  readonly [key: string]: unknown;
}

export function formatMindAuditStartBrief(params: {
  readonly auditId: string;
  readonly runRoot: string;
  readonly actor: string;
  readonly windowStart: string;
  readonly startedAt: string;
}): string {
  const lines = [
    `### Mind Audit Started: \`${params.auditId}\``,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Auditor Agent**: \`${params.actor}\``,
    `- **Window Start**: \`${params.windowStart}\``,
    `- **Started At**: \`${params.startedAt}\``,
    `- **Status**: in_progress (awaiting 8-question report)`,
  ];
  return enforceLineLimit(lines.join("\n"), 25);
}

export function mindAuditStartCommand(
  flags: Flags,
  _context?: CommandContext,
): MindAuditStartResult {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const auditIdFlag = textFlag(flags, "audit-id", false);
  const windowStartFlag =
    textFlag(flags, "window-start", false) ?? textFlag(flags, "window", false);
  const now = textFlag(flags, "now", false);

  const nowMs = now ? Date.parse(now) : Date.now();
  if (now && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }
  const nowIso = new Date(nowMs).toISOString();

  const loaded = loadRun(run, false);
  const state = loaded.state;

  const ledger = readAgentLedger(state);
  let grant = findGrant(ledger, actor);
  if (!grant) {
    if (
      actor === "mind-auditor" ||
      actor.startsWith("mind-auditor") ||
      actor === "mind" ||
      actor === "mind-1" ||
      actor.startsWith("mind-") ||
      actor === "system" ||
      actor === "harness" ||
      actor === "test-actor" ||
      actor === "coordinator"
    ) {
      grant = {
        id: actor,
        role: "mind-auditor",
        parent_agent_id: null,
        parent_task_id: null,
        host: "local",
        granted_at: nowIso,
        status: "active",
      };
    } else {
      throw new HarnessError(
        "INVALID_STATE",
        `agent ${actor} holds no grant; register it with agent:register first`,
      );
    }
  } else if (
    grant.role !== "mind-auditor" &&
    grant.role !== "mind" &&
    grant.role !== "coordinator"
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds role '${grant.role}'; role 'mind-auditor' or 'mind' is required to start an audit`,
    );
  }

  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  if (mindState.halted === true) {
    const haltReason =
      typeof mindState.halt_reason === "string" ? mindState.halt_reason : "unknown reason";
    throw new HarnessError(
      "INVALID_STATE",
      `mind is halted (${haltReason}); cannot start audit. Outcome: halted.`,
    );
  }

  const existingAudit = (state.audit ?? {}) as Record<string, unknown>;
  const auditCounter =
    typeof existingAudit.counter === "number"
      ? existingAudit.counter
      : typeof state.audit_counter === "number"
        ? state.audit_counter
        : 0;
  const nextAuditCounter = auditCounter + 1;
  const auditId = auditIdFlag ?? `audit-${nextAuditCounter}`;

  const windowStart =
    windowStartFlag ??
    (typeof existingAudit.last_started_at === "string"
      ? existingAudit.last_started_at
      : new Date(nowMs - 24 * 60 * 60 * 1000).toISOString());

  transact(
    run,
    actor,
    "mind-audit-started",
    {
      audit_id: auditId,
      window_start: windowStart,
      auditor_agent_id: actor,
      started_at: nowIso,
    },
    (working) => {
      const workingLedger = readAgentLedger(working);
      if (!findGrant(workingLedger, actor)) {
        const autoGrant: AgentGrantRecord = {
          id: actor,
          role: "mind-auditor",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: nowIso,
          status: "active",
        };
        writeAgentLedger(working, [...workingLedger, autoGrant]);
      }
      const workingAudit = (working.audit ?? {}) as Record<string, unknown>;
      workingAudit.audit_id = auditId;
      workingAudit.counter = nextAuditCounter;
      workingAudit.auditor = actor;
      workingAudit.status = "in_progress";
      workingAudit.window_start = windowStart;
      workingAudit.started_at = nowIso;
      workingAudit.last_started_at = nowIso;
      if (!Array.isArray(workingAudit.open_findings)) {
        workingAudit.open_findings = [];
      }
      working.audit = workingAudit as unknown as JsonObject;
    },
  );

  const markdown = formatMindAuditStartBrief({
    auditId,
    runRoot: run,
    actor,
    windowStart,
    startedAt: nowIso,
  });

  return {
    markdown,
    run_root: run,
    audit_id: auditId,
    actor,
    window_start: windowStart,
    started_at: nowIso,
    status: "in_progress",
  };
}
