import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { JsonObject, JsonValue } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { resolveCapsulesDir, resolveCompletedDefectsPath } from "../../../core/shared/paths.ts";
import { loadRun, transact } from "../../../engine/store/index.ts";
import {
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  promoteResolvedDefects,
  type DefectCategory,
  type DefectEntry,
  type GeneratedRegressionTest,
} from "../../../mind/defects/index.ts";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../../options.ts";
import { getApcaBadgeInfo } from "./apca.ts";
import { discoverDefectFiles, parseDefectsFromFile } from "./discovery.ts";
import { formatDefectAuditReport } from "./formatter.ts";
import type {
  ApcaBadgeInfo,
  ApcaContrastCompliance,
  AuditedDefect,
  DefectAuditCommandResult,
  DefectAuditSummary,
} from "./types.ts";

export function defectAuditCommand(
  flags: Flags,
  _context?: CommandContext,
): DefectAuditCommandResult {
  assertFlags(flags, [
    "run",
    "capsules-dir",
    "filter-status",
    "filter-category",
    "filter-type",
    "auto-admit",
    "actor",
    "all",
    "now",
    "json",
    "auto-promote",
    "promote",
    "generate-tests",
    "output-tests",
    "completed-file",
    "dry-run",
  ]);

  const run = textFlag(flags, "run", false);
  const capsulesDirFlag = textFlag(flags, "capsules-dir", false);
  const filterStatusRaw = textFlag(flags, "filter-status", false);
  const filterCategoryRaw =
    textFlag(flags, "filter-category", false) ?? textFlag(flags, "filter-type", false);
  const autoAdmit = boolFlag(flags, "auto-admit");
  const actorFlag = textFlag(flags, "actor", false);
  const isAll = boolFlag(flags, "all");
  const now = textFlag(flags, "now", false);
  const autoPromote = boolFlag(flags, "auto-promote");
  const promoteFlag = textFlag(flags, "promote", false);
  const generateTests = boolFlag(flags, "generate-tests");
  const outputTests = textFlag(flags, "output-tests", false);
  const completedFileFlag = textFlag(flags, "completed-file", false);
  const dryRun = boolFlag(flags, "dry-run");

  const nowMs = now !== undefined ? Date.parse(now) : Date.now();
  if (now !== undefined && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }
  const nowIso = new Date(nowMs).toISOString();

  let resolvedCapsulesDir: string;
  if (capsulesDirFlag !== undefined) {
    resolvedCapsulesDir = resolve(capsulesDirFlag);
    if (!existsSync(resolvedCapsulesDir)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `capsules directory not found: ${capsulesDirFlag}`,
      );
    }
  } else if (run !== undefined) {
    const resolvedRun = resolve(run);
    const parentDir = dirname(resolvedRun);
    if (basename(parentDir) === ".olt/capsules") {
      resolvedCapsulesDir = parentDir;
    } else if (existsSync(join(resolvedRun, ".olt/capsules"))) {
      resolvedCapsulesDir = join(resolvedRun, ".olt/capsules");
    } else {
      resolvedCapsulesDir = parentDir;
    }
  } else {
    resolvedCapsulesDir = resolveCapsulesDir(process.cwd());
  }

  const discoveredFiles = discoverDefectFiles(resolvedCapsulesDir, run);
  const defectMap = new Map<string, AuditedDefect>();
  for (const fileInfo of discoveredFiles) {
    const parsedList = parseDefectsFromFile(fileInfo, resolvedCapsulesDir);
    for (const b of parsedList) {
      if (!defectMap.has(b.id)) {
        defectMap.set(b.id, b);
      } else {
        const existing = defectMap.get(b.id)!;
        if (existing.status === "open" && b.status !== "open") {
          defectMap.set(b.id, b);
        }
      }
    }
  }

  let allDefects = Array.from(defectMap.values());

  if (filterStatusRaw !== undefined) {
    const normalizedStatus = filterStatusRaw.trim().toLowerCase();
    const validStatuses = ["open", "admitted", "resolved", "declined", "ignored", "all"];
    if (!validStatuses.includes(normalizedStatus)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `invalid --filter-status: ${filterStatusRaw}; must be one of: ${validStatuses.join(", ")}`,
      );
    }
    if (normalizedStatus !== "all") {
      allDefects = allDefects.filter((b) => b.status === normalizedStatus);
    }
  }

  if (filterCategoryRaw !== undefined) {
    const normalizedCategory = filterCategoryRaw.trim().toLowerCase();
    if (normalizedCategory !== "all") {
      allDefects = allDefects.filter((b) => {
        const typeMatch = b.type.toLowerCase().includes(normalizedCategory);
        const catMatch =
          typeof (b.context as Record<string, unknown>)?.category === "string"
            ? String((b.context as Record<string, unknown>).category)
                .toLowerCase()
                .includes(normalizedCategory)
            : false;
        return typeMatch ? true : catMatch;
      });
    }
  }

  let autoAdmittedCount = 0;
  const autoAdmittedCandidates: string[] = [];

  if (autoAdmit) {
    if (run === undefined) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "--run is required when using --auto-admit to record candidate proposals",
      );
    }

    loadRun(run, false);
    const actor = actorFlag !== undefined ? actorFlag : "mind-auditor";
    const openDefects = allDefects.filter((b) => b.status === "open");

    for (const defect of openDefects) {
      const candId = `cand-defect-${defect.id}`;
      const statement = `Auto-remediate defect [${defect.type}]: ${defect.observation}`;
      const rationale = `Auto-admitted by defect-audit CLI for ${defect.id}. Remediation: ${defect.remediation}`;

      const candidateObj: JsonObject = {
        id: candId,
        kind: "defect",
        statement,
        witness: defect.id,
        witness_command_id: defect.id,
        charter_goal_ids: ["G1", "G2"],
        falsifier_argv: null,
        falsifier_exit: null,
        write_scope: ["olt/scripts/src/authority/thread/index.ts"],
        rationale,
        status: "admitted",
        created_at: nowIso,
        decided_at: nowIso,
        decided_by: actor,
        decline_reason: null,
        disposition: "actionable",
        gate_failed: null,
        objective_run_id: null,
      };

      try {
        transact(
          run,
          actor,
          "mind-candidate-admitted",
          {
            candidate_id: candId,
            statement,
            defect_id: defect.id,
            admitted_at: nowIso,
          },
          (working) => {
            const existingCandidates = Array.isArray(working.candidates)
              ? (working.candidates as JsonValue[])
              : [];
            const alreadyExists = existingCandidates.some(
              (c) =>
                typeof c === "object" &&
                c !== null &&
                ((c as Record<string, unknown>).id === candId
                  ? true
                  : (c as Record<string, unknown>).witness === defect.id),
            );
            if (!alreadyExists) {
              working.candidates = [...existingCandidates, candidateObj];
            }
          },
        );

        autoAdmittedCount += 1;
        autoAdmittedCandidates.push(candId);

        const updatedDefect: AuditedDefect = {
          ...defect,
          status: "admitted",
          candidate_id: candId,
        };
        const index = allDefects.findIndex((b) => b.id === defect.id);
        if (index !== -1) {
          allDefects[index] = updatedDefect;
        }
      } catch {
        void 0;
      }
    }
  }

  let promotedCount = 0;
  const promotedDefects: string[] = [];

  if (autoPromote || promoteFlag !== undefined) {
    const targetCompletedFile = completedFileFlag
      ? resolve(completedFileFlag)
      : resolveCompletedDefectsPath();

    const toPromoteList: DefectEntry[] = [];
    for (const b of allDefects) {
      const matchesTarget =
        promoteFlag === undefined || promoteFlag === "all" || b.id === promoteFlag;
      if (matchesTarget && b.status === "resolved") {
        const resolution =
          typeof b.resolution === "object" && b.resolution !== null
            ? (b.resolution as unknown as DefectEntry["resolution"])
            : undefined;

        const bEntry: DefectEntry = {
          id: b.id,
          type: b.type,
          severity: b.severity as DefectEntry["severity"],
          timestamp: b.timestamp,
          pid: b.pid,
          agent_id: b.agent_id ?? undefined,
          observation: b.observation,
          remediation: b.remediation,
          context: b.context as DefectEntry["context"],
          status: b.status,
          ...(resolution !== undefined ? { resolution } : {}),
        };
        toPromoteList.push(bEntry);
      }
    }

    if (toPromoteList.length > 0 && !dryRun) {
      const promotionResult = promoteResolvedDefects(toPromoteList, {
        targetPath: targetCompletedFile,
      });
      promotedCount = promotionResult.promoted_count;
      promotedDefects.push(...promotionResult.promoted_defects.map((b) => b.id));
    } else if (toPromoteList.length > 0 && dryRun) {
      promotedCount = toPromoteList.length;
      promotedDefects.push(...toPromoteList.map((b) => b.id));
    }
  }

  let generatedTestsList: GeneratedRegressionTest[] | undefined = undefined;
  let generatedTestSuite: string | undefined = undefined;

  if (generateTests) {
    generatedTestsList = [];
    const defectEntries: DefectEntry[] = [];
    for (const b of allDefects) {
      const defectEntry: DefectEntry = {
        id: b.id,
        type: b.type,
        severity: b.severity as DefectEntry["severity"],
        timestamp: b.timestamp,
        pid: b.pid,
        agent_id: b.agent_id ?? undefined,
        observation: b.observation,
        remediation: b.remediation,
        context: b.context as DefectEntry["context"],
        status: b.status,
      };

      const generated = generateDefectRegressionTest(defectEntry);
      generatedTestsList.push(generated);
      defectEntries.push(defectEntry);
    }

    generatedTestSuite = generateRegressionTestSuite(defectEntries);

    if (outputTests !== undefined && !dryRun) {
      const targetPath = resolve(outputTests);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, generatedTestSuite, "utf-8");
    }
  }

  const byCategory: Record<string, number> = {};
  const byCapsule: Record<string, number> = {};
  let openCount = 0;
  let admittedCount = 0;
  let resolvedCount = 0;
  let declinedCount = 0;
  let criticalCount = 0;
  let warningCount = 0;

  for (const b of allDefects) {
    const cat =
      typeof (b.context as Record<string, unknown>)?.category === "string"
        ? String((b.context as Record<string, unknown>).category)
        : b.type;
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byCapsule[b.source_capsule] = (byCapsule[b.source_capsule] ?? 0) + 1;

    if (b.status === "open") openCount += 1;
    else if (b.status === "admitted") admittedCount += 1;
    else if (b.status === "resolved") resolvedCount += 1;
    else if (b.status === "declined") declinedCount += 1;

    if (b.severity === "critical") criticalCount += 1;
    else if (b.severity === "warning") warningCount += 1;
  }

  const statusesToTest = [
    "critical",
    "warning",
    "open",
    "admitted",
    "resolved",
    "declined",
    "ignored",
  ];
  const badgeDetails: ApcaBadgeInfo[] = statusesToTest.map((s) => getApcaBadgeInfo(s));
  const compliantCount = badgeDetails.filter((b) => b.passes_apca).length;
  const minLc = Math.min(...badgeDetails.map((b) => b.lc));

  const apcaCompliance: ApcaContrastCompliance = {
    compliant_badges: compliantCount,
    total_badges: badgeDetails.length,
    min_lc_observed: minLc,
    passes_apca: compliantCount === badgeDetails.length,
    badge_details: badgeDetails,
  };

  const summary: DefectAuditSummary = {
    total_defects: allDefects.length,
    open_count: openCount,
    admitted_count: admittedCount,
    resolved_count: resolvedCount,
    declined_count: declinedCount,
    critical_count: criticalCount,
    warning_count: warningCount,
    by_category: byCategory,
    by_capsule: byCapsule,
    apca_contrast_compliance: apcaCompliance,
  };

  const markdown = formatDefectAuditReport({
    capsulesDir: resolvedCapsulesDir,
    runRoot: run ?? null,
    defects: allDefects,
    summary,
    autoAdmittedCount,
    autoAdmittedCandidates,
    isAll,
    promotedCount: promotedCount > 0 ? promotedCount : undefined,
    promotedDefects: promotedDefects.length > 0 ? promotedDefects : undefined,
    generatedTestsCount: generatedTestsList ? generatedTestsList.length : undefined,
  });

  return {
    markdown,
    capsules_dir: resolvedCapsulesDir,
    run_root: run ?? null,
    total_defects: allDefects.length,
    filtered_defects: allDefects,
    summary,
    auto_admitted_count: autoAdmittedCount,
    auto_admitted_candidates: autoAdmittedCandidates,
    ...(promotedCount > 0
      ? { promoted_count: promotedCount, promoted_defects: promotedDefects }
      : {}),
    ...(generatedTestsList !== undefined ? { generated_tests: generatedTestsList } : {}),
    ...(generatedTestSuite !== undefined ? { generated_test_suite: generatedTestSuite } : {}),
  };
}
