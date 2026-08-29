import { join } from "node:path";
import { loadRun } from "../../../../engine/store/index.ts";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonObject } from "../../../../core/contracts/index.ts";
import { recoverProjection, transact, verifyIntegrity } from "../../../../engine/store/index.ts";
import { runDoctor } from "../../../../reporting/doctor.ts";
import { installedRuntimeFreshness } from "../../../../installer/runtime-freshness.ts";
import { validateSkillSource } from "../../../../installer/source-validation.ts";
import { resolveCharterPath } from "../../../lifecycle/charter/index.ts";
import type { RescueLaneOptions, Rung0Result } from "../types.ts";

export async function executeRung0(params: {
  readonly mindRunRoot: string;
  readonly loadedMind: ReturnType<typeof loadRun>;
  readonly repoRoot: string;
  readonly actor: string;
  readonly nowMs: number;
  readonly nowIso: string;
  readonly options: RescueLaneOptions;
  readonly actionsTaken: string[];
  readonly escalations: string[];
}): Promise<Rung0Result> {
  const {
    mindRunRoot,
    loadedMind,
    repoRoot,
    actor,
    nowMs,
    nowIso,
    options,
    actionsTaken,
    escalations,
  } = params;

  let charterDrifted = false;
  let runtimeDrifted = false;
  let integrityRepaired = false;
  let integrityFailed = false;
  let readRaceRetried = false;
  let rung0Halted = false;
  let rung0HaltReason: string | undefined;

  const mindState = (loadedMind.state.mind ?? {}) as Record<string, unknown>;
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;
  const charterSourceRel =
    typeof charterRecord.source_path === "string"
      ? charterRecord.source_path
      : "olt/agents/mind.yaml";
  const charterRepoRoots = Array.isArray(charterRecord.repo_roots)
    ? charterRecord.repo_roots.filter((r: unknown): r is string => typeof r === "string")
    : undefined;
  const charterFullPath = resolveCharterPath(repoRoot, charterSourceRel, charterRepoRoots);

  let charterStatus: "ok" | "DRIFTED" | "missing" = "missing";
  let charterSha: string | null = null;

  if (existsSync(charterFullPath) && lstatSync(charterFullPath).isFile()) {
    try {
      const fileBytes = readFileSync(charterFullPath);
      charterSha = createHash("sha256").update(fileBytes).digest("hex");
      const pinnedDigest =
        (typeof charterRecord.pinned_sha256 === "string" && charterRecord.pinned_sha256) ||
        loadedMind.manifest.prompt_sha256;
      if (charterSha === pinnedDigest) {
        charterStatus = "ok";
      } else {
        charterStatus = "DRIFTED";
      }
    } catch {
      charterStatus = "missing";
    }
  }

  if (charterStatus !== "ok") {
    charterDrifted = true;
    rung0Halted = true;
    rung0HaltReason =
      charterStatus === "DRIFTED" ? "charter drifted from pinned digest" : "charter file missing";
    actionsTaken.push(`Rung 0: HALT triggered due to ${rung0HaltReason}`);
    escalations.push(rung0HaltReason);

    transact(mindRunRoot, actor, "mind-halted", { reason: rung0HaltReason }, (working) => {
      const workingMind = (working.mind ?? {}) as Record<string, unknown>;
      workingMind.halted = true;
      workingMind.halt_reason = rung0HaltReason;
      working.mind = workingMind as unknown as JsonObject;

      const workingEscalations = Array.isArray(working.escalations) ? [...working.escalations] : [];
      workingEscalations.push({
        id: `esc-charter-${nowMs}`,
        reason: charterStatus === "DRIFTED" ? "charter_drift" : "charter_missing",
        detail: rung0HaltReason ?? "",
        escalated_at: nowIso,
        resolved_at: null,
      } as unknown as JsonObject);
      working.escalations = workingEscalations as unknown as JsonObject[];
    });
  }

  // Runtime freshness check
  if (!rung0Halted) {
    let runtimeStatus: "ok" | "drifted" | "unknown" = "ok";
    if (options.runtimeFreshnessOverride !== undefined) {
      if (options.runtimeFreshnessOverride.drifted) {
        runtimeStatus = "drifted";
      }
    } else {
      try {
        const scriptsRoot = resolve(import.meta.dirname, "..", "..", "..");
        const validated = await validateSkillSource(resolve(scriptsRoot, ".."));
        const freshness = await installedRuntimeFreshness(validated, options.home);
        if (freshness.drifted) {
          runtimeStatus = "drifted";
        }
      } catch {
        runtimeStatus = "unknown";
      }
    }

    if (runtimeStatus === "drifted") {
      runtimeDrifted = true;
      rung0Halted = true;
      rung0HaltReason = "runtime drifted";
      actionsTaken.push(`Rung 0: HALT triggered due to ${rung0HaltReason}`);
      escalations.push(rung0HaltReason);

      transact(mindRunRoot, actor, "mind-halted", { reason: rung0HaltReason }, (working) => {
        const workingMind = (working.mind ?? {}) as Record<string, unknown>;
        workingMind.halted = true;
        workingMind.halt_reason = rung0HaltReason;
        working.mind = workingMind as unknown as JsonObject;

        const workingEscalations = Array.isArray(working.escalations)
          ? [...working.escalations]
          : [];
        workingEscalations.push({
          id: `esc-runtime-${nowMs}`,
          reason: "runtime_drift",
          detail: rung0HaltReason ?? "",
          escalated_at: nowIso,
          resolved_at: null,
        } as unknown as JsonObject);
        working.escalations = workingEscalations as unknown as JsonObject[];
      });
    }
  }

  // Integrity checks
  if (!rung0Halted) {
    let integrityIssues = verifyIntegrity(mindRunRoot);
    if (integrityIssues.length > 0) {
      const allReadRace = integrityIssues.every((issue) => issue.subcode === "READ_RACE");
      if (allReadRace) {
        readRaceRetried = true;
        integrityIssues = verifyIntegrity(mindRunRoot);
      }

      if (integrityIssues.length > 0) {
        await runDoctor(mindRunRoot);
        try {
          recoverProjection(mindRunRoot, actor);
          integrityRepaired = true;
          actionsTaken.push("Rung 0: repaired mind capsule state projection via doctor:repair");
        } catch {
          integrityRepaired = false;
        }

        const remainingIssues = verifyIntegrity(mindRunRoot);
        if (remainingIssues.length > 0) {
          integrityFailed = true;
          rung0Halted = true;
          rung0HaltReason = `mind capsule integrity unrepairable: ${remainingIssues.map((i) => i.code).join(", ")}`;
          actionsTaken.push(`Rung 0: HALT triggered due to ${rung0HaltReason}`);
          escalations.push(rung0HaltReason);

          transact(mindRunRoot, actor, "mind-halted", { reason: rung0HaltReason }, (working) => {
            const workingMind = (working.mind ?? {}) as Record<string, unknown>;
            workingMind.halted = true;
            workingMind.halt_reason = rung0HaltReason;
            working.mind = workingMind as unknown as JsonObject;

            const workingEscalations = Array.isArray(working.escalations)
              ? [...working.escalations]
              : [];
            workingEscalations.push({
              id: `esc-integrity-${nowMs}`,
              reason: "integrity_failed",
              detail: rung0HaltReason ?? "",
              escalated_at: nowIso,
              resolved_at: null,
            } as unknown as JsonObject);
            working.escalations = workingEscalations as unknown as JsonObject[];
          });
        }
      }
    }
  }

  return {
    charterDrifted,
    runtimeDrifted,
    integrityRepaired,
    integrityFailed,
    readRaceRetried,
    halted: rung0Halted,
    ...(rung0HaltReason !== undefined ? { haltReason: rung0HaltReason } : {}),
  };
}
