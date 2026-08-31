/**
 * @file audit-fixture.ts
 * Shared fixtures and test helpers for Mind Audit Scanner
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../../olt/scripts/src/cli/commands/agent-ops.ts";
import {
  mindAuditReportCommand,
  mindAuditStartCommand,
} from "../../../../olt/scripts/src/cli/commands/mind-audit.ts";
import { mindPulseOpenCommand } from "../../../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import type { HarnessEvent, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
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
import { initRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import { verifyIntegrity } from "../../../../olt/scripts/src/engine/store/index.ts";
import { loadRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";

export const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

interface MindFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

export function setupMindCapsule(
  name: string,
  overrides: {
    readonly charterContent?: string;
    readonly budget?: Record<string, unknown>;
    readonly registerAuditorAgent?: boolean;
    readonly registerMindAgent?: boolean;
  } = {},
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-audit-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    overrides.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test application for mind audit"\n  goals:\n    - id: "G1"\n      statement: "Ensure stability"\n    - id: "G2"\n      statement: "Performance improvements"\n  non_goals:\n    - "Out of scope items"\n  repo_roots:\n    - "src/"\n    - "docs/"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "olt/agents/mind.yaml",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "olt/agents/mind.yaml",
          pinned_sha256: charterSha,
          goals: ["G1", "G2"],
          repo_roots: ["src/", "docs/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };

      working.budget = {
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
        base_interval_ms: 900_000,
        max_interval_ms: 14_400_000,
        max_pause_interval_ms: 1_800_000,
        pulse_deadline_ms: 1_200_000,
        max_open_proposals: 5,
        quiet_hours: null,
        day_key: "2026-08-21",
        pulses_today: 0,
        wall_clock_ms_today: 0,
        ...overrides.budget,
      };
    },
  );

  transact(run, "register-test-agents", "agents-registered", {}, (working) => {
    working.agents = [
      {
        id: "mind-1",
        role: "mind",
        host: "antigravity",
        status: "active",
        granted_at: new Date().toISOString(),
        parent_agent_id: null,
        parent_task_id: null,
      },
      {
        id: "auditor-1",
        role: "mind-auditor",
        host: "antigravity",
        status: "active",
        granted_at: new Date().toISOString(),
        parent_agent_id: "mind-1",
        parent_task_id: null,
      },
    ];
  });

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



export { AUDIT_QUESTIONS, AUDIT_QUESTION_IDS, normalizeQuestionId, validateAuditAnswers };
