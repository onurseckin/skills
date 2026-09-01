/**
 * @file audit-fixture.ts
 * In-memory virtual fixtures and test helpers for Mind Audit Scanner
 */

import {
  assertAuditAllowsPulseOpen,
  AUDIT_QUESTION_IDS,
  AUDIT_QUESTIONS,
  checkAdmittedCandidateGoals,
  checkAuditBlocksPulse,
  checkCharterDigestIntegrity,
  checkDeclinedCandidates,
  checkNeverUnattendedActions,
  checkPulseGaps,
  checkValueConsistency,
  normalizeQuestionId,
  validateAuditAnswers,
} from "../../../../olt/scripts/src/mind/auditing/index.ts";

export const roots: string[] = [];

interface MindFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

export function setupMindCapsule(
  name: string,
  _overrides: {
    readonly charterContent?: string;
    readonly budget?: Record<string, unknown>;
    readonly registerAuditorAgent?: boolean;
    readonly registerMindAgent?: boolean;
  } = {},
): MindFixture {
  const repo = `${process.cwd()}/.olt/virtual-mind-audit-test-${name}`;
  const run = `${repo}/.olt/capsules/mind-gen-${name}`;
  const charterPath = `${repo}/olt/agents/mind.yaml`;
  const charterSha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  return { repo, run, charterPath, charterSha };
}

export function generateCleanAnswers(): string[] {
  return [
    "Q1:cmd-101:pass:Every pulse in the window has exactly one open and one close",
    "Q2:cmd-102:pass:All admitted candidate defect witnesses re-verified and valid",
    "Q3:cmd-103:pass:All admitted candidates cite existing charter goals",
    "Q4:cmd-104:pass:Trailing value series is consistent with ledger metrics",
    "Q5:cmd-105:pass:No out-of-band scope modifications detected",
    "Q6:cmd-106:pass:No prohibited never-unattended actions executed",
    "Q7:cmd-107:pass:Declined candidates have valid recorded reasons",
    "Q8:cmd-108:pass:Charter digest matches pinned sha256 with no drift",
  ];
}

export {
  assertAuditAllowsPulseOpen,
  AUDIT_QUESTIONS,
  AUDIT_QUESTION_IDS,
  checkAdmittedCandidateGoals,
  checkAuditBlocksPulse,
  checkCharterDigestIntegrity,
  checkDeclinedCandidates,
  checkNeverUnattendedActions,
  checkPulseGaps,
  checkValueConsistency,
  normalizeQuestionId,
  validateAuditAnswers,
};
