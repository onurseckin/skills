/**
 * @file meta-fixture.ts
 * Shared fixtures and test helpers for Meta Auditor & Planted Audit Suites
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentGrantRecord, CommandRecord, HarnessEvent, Manifest, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";

export interface MindPlantedFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

export class PlantedAuditHarness {
  private readonly roots: string[] = [];

  public createCapsule(
    name: string,
    overrides: {
      readonly charterGoals?: string[];
      readonly charterContent?: string;
      readonly budget?: Record<string, unknown>;
      readonly registerAuditorAgent?: boolean;
      readonly registerMindAgent?: boolean;
    } = {},
  ): MindPlantedFixture {
    const repo = mkdtempSync(join(tmpdir(), `mind-planted-audit-${name}-`));
    this.roots.push(repo);

    const charterDir = join(repo, "olt", "agents");
    mkdirSync(charterDir, { recursive: true });
    const charterPath = join(charterDir, "mind.yaml");
    const goals = overrides.charterGoals ?? ["G1", "G2"];
    const goalsYaml = goals
      .map((g) => `    - id: "${g}"\n      statement: "Goal description"`)
      .join("\n");
    const charterContent =
      overrides.charterContent ??
      `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Application under planted ledger audit verification"\n  goals:\n${goalsYaml}\n  non_goals:\n    - "Modifying production credentials"\n  repo_roots:\n    - "src/"\n    - "tests/"\n`;
    writeFileSync(charterPath, charterContent, "utf-8");

    const charterBytes = readFileSync(charterPath);
    const charterSha = createHash("sha256").update(charterBytes).digest("hex");

    const run = initRun(repo, `planted-run-${name}`, charterBytes, "file", true);

    transact(
      run,
      "mind-init",
      "mind-initialized",
      {
        generation: 1,
        charter_source_path: "olt/agents/mind.yaml",
        pinned_sha256: charterSha,
        goals,
        repo_roots: ["src/", "tests/"],
      },
      (draft) => {
        const working = draft as Record<string, unknown>;
        working.mind = {
          generation: 1,
          opened_at: new Date().toISOString(),
          charter: {
            source_path: "olt/agents/mind.yaml",
            pinned_sha256: charterSha,
            goals,
            repo_roots: ["src/", "tests/"],
            evidence_class: "harness_observed",
          },
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

        working.candidates = [];
        working.audit = {
          counter: 0,
          open_findings: [],
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
        } as AgentGrantRecord,
        {
          id: "auditor-1",
          role: "auditor",
          host: "antigravity",
          status: "active",
          granted_at: new Date().toISOString(),
        } as AgentGrantRecord,
      ];
    });

    return { repo, run, charterPath, charterSha };
  }

  public cleanup(): void {
    for (const root of this.roots) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    this.roots.length = 0;
  }
}
