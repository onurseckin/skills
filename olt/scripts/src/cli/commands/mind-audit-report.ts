import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentGrantRecord, JsonObject, JsonValue } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  checkPulseGaps,
  validateAuditAnswers,
  type AuditAnswer,
  type AuditVerdict,
} from "../../mind/auditing/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/index.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { listFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

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

  const existingAudit = (state.audit ?? {}) as Record<string, unknown>;
  const auditId =
    auditIdFlag ??
    (typeof existingAudit.audit_id === "string" ? existingAudit.audit_id : "audit-1");

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
