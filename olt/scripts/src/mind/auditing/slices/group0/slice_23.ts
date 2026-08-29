import { HarnessError } from "../../../../core/errors/index.ts";
import type { HarnessEvent, RunState } from "../../../../core/contracts/index.ts";
import {
  AUDIT_QUESTION_IDS,
  normalizeQuestionId,
  checkPulseGaps,
  type AuditAnswer,
  type AuditAnswerVerdict,
  type AuditQuestionId,
  type AuditRecord,
} from "./slice_20.ts";
import {
  checkAdmittedCandidateWitnesses,
  checkAdmittedCandidateGoals,
  checkValueConsistency,
} from "./slice_21.ts";
import {
  checkScopeViolations,
  checkNeverUnattendedActions,
  checkDeclinedCandidates,
  checkCharterDigestIntegrity,
} from "./slice_22.ts";
export function validateAuditAnswers(rawAnswers: unknown): readonly AuditAnswer[] {
  if (!rawAnswers || typeof rawAnswers !== "object") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "audit answers must be an object or an array containing all 8 question answers",
    );
  }

  const answerMap = new Map<AuditQuestionId, AuditAnswer>();

  if (Array.isArray(rawAnswers)) {
    for (const item of rawAnswers as unknown[]) {
      if (typeof item === "string") {
        const parts = item.split(":");
        const rawQ = parts[0] ?? "";
        const rawCmd = parts[1] ?? "";
        const rawVerdict = parts[2] ?? "pass";
        const rawDetail = parts.slice(3).join(":");

        const qId = normalizeQuestionId(rawQ);
        if (!qId) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `unrecognized question identifier '${rawQ}'; expected Q1 through Q8`,
          );
        }

        if (!rawCmd.trim()) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `audit answer for ${qId} must cite a non-empty command id`,
          );
        }

        const v = rawVerdict.trim().toLowerCase();
        const verdict: AuditAnswerVerdict =
          v === "fail" || v === "finding" || v === "failed" ? "fail" : "pass";

        const statementVal = rawDetail.trim() || undefined;
        answerMap.set(qId, {
          question_id: qId,
          command_id: rawCmd.trim(),
          verdict,
          ...(statementVal !== undefined ? { statement: statementVal } : {}),
        });
      } else if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const rawQ =
          typeof obj.question_id === "string"
            ? obj.question_id
            : typeof obj.question === "string"
              ? obj.question
              : typeof obj.id === "string"
                ? obj.id
                : "";
        const qId = normalizeQuestionId(rawQ);
        if (!qId) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `unrecognized question identifier '${rawQ}'; expected Q1 through Q8`,
          );
        }

        const cmdId =
          typeof obj.command_id === "string"
            ? obj.command_id
            : typeof obj.commandId === "string"
              ? obj.commandId
              : typeof obj.command === "string"
                ? obj.command
                : "";

        if (!cmdId.trim()) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `audit answer for ${qId} must cite a non-empty command id`,
          );
        }

        const rawV = typeof obj.verdict === "string" ? obj.verdict.trim().toLowerCase() : "pass";
        const verdict: AuditAnswerVerdict =
          rawV === "fail" || rawV === "finding" || rawV === "failed" ? "fail" : "pass";

        const findingsVal = Array.isArray(obj.findings) ? (obj.findings as string[]) : undefined;
        const statementVal = typeof obj.statement === "string" ? obj.statement : undefined;

        answerMap.set(qId, {
          question_id: qId,
          command_id: cmdId.trim(),
          verdict,
          ...(statementVal !== undefined ? { statement: statementVal } : {}),
          ...(findingsVal !== undefined ? { findings: findingsVal } : {}),
        });
      }
    }
  } else {
    // Record of question keys/IDs to answers
    const record = rawAnswers as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const qId = normalizeQuestionId(key);
      if (!qId) continue;

      if (typeof value === "string") {
        const parts = value.split(":");
        const cmdId = parts[0] ?? "";
        const rawV = parts[1] ?? "pass";
        if (!cmdId.trim()) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `audit answer for ${qId} must cite a non-empty command id`,
          );
        }
        const v = rawV.trim().toLowerCase();
        const verdict: AuditAnswerVerdict =
          v === "fail" || v === "finding" || v === "failed" ? "fail" : "pass";

        answerMap.set(qId, {
          question_id: qId,
          command_id: cmdId.trim(),
          verdict,
        });
      } else if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>;
        const cmdId =
          typeof obj.command_id === "string"
            ? obj.command_id
            : typeof obj.commandId === "string"
              ? obj.commandId
              : typeof obj.command === "string"
                ? obj.command
                : "";

        if (!cmdId.trim()) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `audit answer for ${qId} must cite a non-empty command id`,
          );
        }

        const rawV = typeof obj.verdict === "string" ? obj.verdict.trim().toLowerCase() : "pass";
        const verdict: AuditAnswerVerdict =
          rawV === "fail" || rawV === "finding" || rawV === "failed" ? "fail" : "pass";

        const findingsVal = Array.isArray(obj.findings) ? (obj.findings as string[]) : undefined;
        const statementVal = typeof obj.statement === "string" ? obj.statement : undefined;

        answerMap.set(qId, {
          question_id: qId,
          command_id: cmdId.trim(),
          verdict,
          ...(statementVal !== undefined ? { statement: statementVal } : {}),
          ...(findingsVal !== undefined ? { findings: findingsVal } : {}),
        });
      }
    }
  }

  // Ensure all 8 questions are answered
  const missing: AuditQuestionId[] = [];
  for (const q of AUDIT_QUESTION_IDS) {
    if (!answerMap.has(q)) {
      missing.push(q);
    }
  }

  if (missing.length > 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `missing answers for audit questionnaire: ${missing.join(", ")}; all 8 questions are mandatory`,
    );
  }

  return AUDIT_QUESTION_IDS.map((q) => answerMap.get(q)!);
}

export interface AuditBlockCheckResult {
  readonly blocked: boolean;
  readonly reason?: string | undefined;
  readonly outcome?: "halted" | "blocked" | undefined;
}

export function checkAuditBlocksPulse(state: RunState): AuditBlockCheckResult {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const auditRecord = (state.audit ?? mindState.audit ?? {}) as Record<string, unknown>;

  // 1. Mind halted check
  if (
    mindState.halted === true ||
    auditRecord.status === "halted" ||
    auditRecord.last_verdict === "halt"
  ) {
    const reason =
      typeof mindState.halt_reason === "string"
        ? mindState.halt_reason
        : typeof auditRecord.summary === "string"
          ? auditRecord.summary
          : "mind halted by audit verdict";
    return {
      blocked: true,
      reason: `mind is halted (${reason}); cannot proceed past WAKE. Outcome: halted.`,
      outcome: "halted",
    };
  }

  // 2. Open findings check
  const openFindings = Array.isArray(auditRecord.open_findings)
    ? (auditRecord.open_findings as string[])
    : [];

  if (openFindings.length > 0) {
    const findingsList = openFindings.join("; ");
    return {
      blocked: true,
      reason: `open audit finding(s) block next pulse from proceeding past WAKE: ${findingsList}. Outcome: blocked.`,
      outcome: "blocked",
    };
  }

  // 3. Status changes_requested check
  if (
    auditRecord.status === "changes_requested" ||
    auditRecord.last_verdict === "changes_requested"
  ) {
    return {
      blocked: true,
      reason:
        "audit verdict requested changes; cannot proceed past WAKE until findings are resolved. Outcome: blocked.",
      outcome: "blocked",
    };
  }

  return { blocked: false };
}

export function assertAuditAllowsPulseOpen(state: RunState): void {
  const check = checkAuditBlocksPulse(state);
  if (check.blocked) {
    throw new HarnessError("INVALID_STATE", check.reason ?? "pulse blocked by open audit findings");
  }
}