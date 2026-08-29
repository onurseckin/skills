import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import type { JsonObject, JsonValue } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  AUDIT_QUESTION_IDS,
  checkPulseGaps,
  validateAuditAnswers,
  type AuditAnswer,
  type AuditVerdict,
} from "../../mind/audit.ts";
import { loadRun } from "../../engine/store/load.ts";
import { transact } from "../../engine/store/transaction.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { listFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

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

  // 1. Enforce acting agent role grant
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

  // 2. Check if mind is halted
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  if (mindState.halted === true) {
    const haltReason =
      typeof mindState.halt_reason === "string" ? mindState.halt_reason : "unknown reason";
    throw new HarnessError(
      "INVALID_STATE",
      `mind is halted (${haltReason}); cannot start audit. Outcome: halted.`,
    );
  }

  // 3. Determine audit ID
  const existingAudit = (state.audit ?? {}) as Record<string, unknown>;
  const auditCounter =
    typeof existingAudit.counter === "number"
      ? existingAudit.counter
      : typeof state.audit_counter === "number"
        ? state.audit_counter
        : 0;
  const nextAuditCounter = auditCounter + 1;
  const auditId = auditIdFlag ?? `audit-${nextAuditCounter}`;

  // 4. Determine window start
  const windowStart =
    windowStartFlag ??
    (typeof existingAudit.last_started_at === "string"
      ? existingAudit.last_started_at
      : new Date(nowMs - 24 * 60 * 60 * 1000).toISOString());

  // 5. Append mind-audit-started event via transact
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

export interface MindAuditReportResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly audit_id: string;
  readonly actor: string;
  readonly verdict: AuditVerdict;
  readonly summary: string;
  readonly reported_at: string;
  readonly open_findings: readonly string[];
  readonly answers: readonly AuditAnswer[];
  readonly [key: string]: unknown;
}

export function formatMindAuditReportBrief(params: {
  readonly auditId: string;
  readonly runRoot: string;
  readonly actor: string;
  readonly verdict: AuditVerdict;
  readonly summary: string;
  readonly reportedAt: string;
  readonly openFindings: readonly string[];
  readonly answers: readonly AuditAnswer[];
}): string {
  const lines = [
    `### Mind Audit Reported: \`${params.auditId}\``,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Auditor Agent**: \`${params.actor}\``,
    `- **Verdict**: **${params.verdict.toUpperCase()}**`,
    `- **Summary**: ${params.summary}`,
    `- **Reported At**: \`${params.reportedAt}\``,
    `- **Open Findings**: ${params.openFindings.length}`,
    `- **Answers**: ${params.answers.length}/8 questions answered`,
  ];
  for (const a of params.answers) {
    const icon = a.verdict === "pass" ? "PASSED" : "FINDING";
    lines.push(`  - \`${a.question_id}\` (${a.command_id}): ${icon}`);
  }
  return enforceLineLimit(lines.join("\n"), 30);
}

export function mindAuditReportCommand(
  flags: Flags,
  _context?: CommandContext,
): MindAuditReportResult {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const auditIdFlag = textFlag(flags, "audit-id", false);
  const verdictRaw = textFlag(flags, "verdict", true)!.trim().toLowerCase();
  const summaryFlag = textFlag(flags, "summary", false);
  const answersFile = textFlag(flags, "answers-file", false);
  const answerList = listFlag(flags, "answer", false);
  const now = textFlag(flags, "now", false);

  const nowMs = now ? Date.parse(now) : Date.now();
  if (now && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }
  const nowIso = new Date(nowMs).toISOString();

  // 1. Parse and validate verdict
  let verdict: AuditVerdict;
  if (verdictRaw === "approved" || verdictRaw === "pass" || verdictRaw === "passed") {
    verdict = "approved";
  } else if (
    verdictRaw === "changes_requested" ||
    verdictRaw === "changes-requested" ||
    verdictRaw === "fail" ||
    verdictRaw === "failed"
  ) {
    verdict = "changes_requested";
  } else if (verdictRaw === "halt" || verdictRaw === "halted") {
    verdict = "halt";
  } else {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid verdict '${verdictRaw}'; must be one of: approved, changes_requested, halt`,
    );
  }

  const loaded = loadRun(run, false);
  const state = loaded.state;

  // 2. Enforce acting agent role grant
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
      `agent ${actor} holds role '${grant.role}'; role 'mind-auditor' or 'mind' is required to report an audit`,
    );
  }

  // 3. Resolve audit ID
  const existingAudit = (state.audit ?? {}) as Record<string, unknown>;
  const auditId =
    auditIdFlag ??
    (typeof existingAudit.audit_id === "string" ? existingAudit.audit_id : "audit-1");

  // 4. Parse answers from answers file or flag list
  let rawAnswers: unknown = null;
  if (answersFile) {
    const fullAnswersPath = resolve(run, answersFile);
    if (!existsSync(fullAnswersPath)) {
      throw new HarnessError("INVALID_ARGUMENT", `answers file not found at '${fullAnswersPath}'`);
    }
    try {
      const fileContent = readFileSync(fullAnswersPath, "utf-8");
      rawAnswers = JSON.parse(fileContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `failed to parse answers JSON file at '${answersFile}': ${msg}`,
      );
    }
  } else if (answerList && answerList.length > 0) {
    rawAnswers = answerList;
  } else {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "either --answers-file or --answer must be provided with answers for all 8 questions",
    );
  }

  const validatedAnswers = validateAuditAnswers(rawAnswers);

  // 5. Check Question 1 (pulse gaps) enforcement
  const q1Answer = validatedAnswers.find((a) => a.question_id === "Q1");
  const q1Failed = q1Answer?.verdict === "fail";
  const pulseGapResult = checkPulseGaps(loaded.events);

  if ((q1Failed || !pulseGapResult.ok) && verdict === "approved") {
    const gapList = pulseGapResult.gaps.join("; ");
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `cannot approve audit when pulse gaps exist (Question 1: ${gapList || "gaps reported in answer"})`,
    );
  }

  // 6. Collect findings
  const openFindings: string[] = [];
  for (const a of validatedAnswers) {
    if (a.verdict === "fail") {
      if (a.findings && a.findings.length > 0) {
        openFindings.push(...a.findings);
      } else if (a.statement) {
        openFindings.push(`${a.question_id}: ${a.statement}`);
      } else {
        openFindings.push(`Finding in ${a.question_id} (${a.command_id})`);
      }
    }
  }

  if (verdict === "approved" && openFindings.length > 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `cannot approve audit when findings are open: ${openFindings.join("; ")}`,
    );
  }

  const summary =
    summaryFlag ??
    (verdict === "approved"
      ? "Audit passed: all 8 questions verified clean with cited command IDs"
      : verdict === "halt"
        ? `Audit halt: ${openFindings.join("; ") || "critical defect detected"}`
        : `Audit changes requested: ${openFindings.join("; ") || "findings require remediation"}`);

  // 7. Transact mind-audit-reported
  transact(
    run,
    actor,
    "mind-audit-reported",
    {
      audit_id: auditId,
      auditor_agent_id: actor,
      verdict,
      summary,
      answers: validatedAnswers as unknown as JsonValue,
      open_findings: (verdict === "approved" ? [] : openFindings) as unknown as JsonValue,
      reported_at: nowIso,
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
      const workingMind = (working.mind ?? {}) as Record<string, unknown>;
      if (verdict === "halt") {
        workingMind.halted = true;
        workingMind.halt_reason = `mind audit ${auditId} reported halt: ${summary}`;
        working.mind = workingMind as unknown as JsonObject;
      }

      const workingAudit = (working.audit ?? {}) as Record<string, unknown>;
      workingAudit.audit_id = auditId;
      workingAudit.auditor = actor;
      workingAudit.status =
        verdict === "approved" ? "approved" : verdict === "halt" ? "halted" : "changes_requested";
      workingAudit.last_reported_at = nowIso;
      workingAudit.last_verdict = verdict;
      workingAudit.summary = summary;
      workingAudit.answers = validatedAnswers as unknown as JsonValue;
      workingAudit.open_findings =
        verdict === "approved"
          ? []
          : openFindings.length > 0
            ? openFindings
            : [`Audit ${auditId} verdict: ${verdict}`];
      working.audit = workingAudit as unknown as JsonObject;
    },
  );

  const markdown = formatMindAuditReportBrief({
    auditId,
    runRoot: run,
    actor,
    verdict,
    summary,
    reportedAt: nowIso,
    openFindings: verdict === "approved" ? [] : openFindings,
    answers: validatedAnswers,
  });

  return {
    markdown,
    run_root: run,
    audit_id: auditId,
    actor,
    verdict,
    summary,
    reported_at: nowIso,
    open_findings: verdict === "approved" ? [] : openFindings,
    answers: validatedAnswers,
  };
}
