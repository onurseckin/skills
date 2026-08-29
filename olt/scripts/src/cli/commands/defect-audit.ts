import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { JsonObject, JsonValue } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  promoteResolvedDefects,
  type DefectCategory,
  type DefectEntry,
  type GeneratedRegressionTest,
} from "../../mind/defects/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/index.ts";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import {
  resolveCapsulesDir,
  resolveCompletedDefectsPath,
} from "../../core/shared/paths.ts";
import {
  getApcaBadgeInfo,
  type ApcaBadgeInfo,
  type ApcaContrastCompliance,
  type AuditedDefect,
  type DefectAuditCommandResult,
  type DefectAuditSummary,
  type DefectStatus,
  type RGBColor,
} from "./defect-audit-types.ts";
import { discoverDefectFiles, parseDefectsFromFile } from "./defect-audit-scanner.ts";
import { formatDefectAuditReport } from "./defect-audit-formatter.ts";

export type {
  ApcaBadgeInfo,
  ApcaContrastCompliance,
  AuditedDefect,
  DefectAuditCommandResult,
  DefectAuditSummary,
  DefectStatus,
  RGBColor,
};

export {
  calculateApcaLightnessContrast,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
} from "./defect-audit-types.ts";
export { discoverDefectFiles } from "./defect-audit-scanner.ts";
export { formatDefectAuditReport, renderAsciiDefectTable } from "./defect-audit-formatter.ts";

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
    textFlag(flags, "filter-category", false) !== undefined
      ? textFlag(flags, "filter-category", false)
      : textFlag(flags, "filter-type", false);
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

    const loaded = loadRun(run, false);
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

        autoAdmittedCount = autoAdmittedCount + 1;
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
          severity: b.severity,
          timestamp: b.timestamp,
          category: (b.context as Record<string, unknown>)?.category
            ? ((b.context as Record<string, unknown>).category as DefectCategory)
            : "code_defect",
          status: "resolved",
          observation: b.observation,
          remediation: b.remediation,
          ...(b.pid ? { pid: b.pid } : {}),
          ...(b.ppid ? { ppid: b.ppid } : {}),
          ...(b.agent_id ? { agent_id: b.agent_id } : {}),
          context: b.context,
          ...(resolution !== undefined ? { resolution } : {}),
        };
        toPromoteList.push(bEntry);
      }
    }

    if (toPromoteList.length > 0) {
      const promotionResult = promoteResolvedDefects(toPromoteList, {
        targetPath: targetCompletedFile,
        dryRun,
        updateSourceFile: false,
      });
      promotedCount = promotionResult.promoted_count;
      for (const pb of promotionResult.promoted_defects) {
        promotedDefects.push(pb.id);
      }
    }
  }

  let generatedTestsList: GeneratedRegressionTest[] | undefined = undefined;
  let generatedTestSuiteStr: string | undefined = undefined;

  if (generateTests || outputTests !== undefined) {
    const defectEntries: DefectEntry[] = allDefects.map((b) => ({
      id: b.id,
      type: b.type,
      severity: b.severity,
      timestamp: b.timestamp,
      category: (b.context as Record<string, unknown>)?.category
        ? ((b.context as Record<string, unknown>).category as DefectCategory)
        : "code_defect",
      status: b.status === "resolved" ? "resolved" : b.status === "open" ? "open" : "wontfix",
      observation: b.observation,
      remediation: b.remediation,
      ...(b.pid ? { pid: b.pid } : {}),
      ...(b.ppid ? { ppid: b.ppid } : {}),
      ...(b.agent_id ? { agent_id: b.agent_id } : {}),
      context: b.context,
      ...(b.resolution ? { resolution: b.resolution as unknown as DefectEntry["resolution"] } : {}),
    }));

    generatedTestsList = defectEntries.map((b) => generateDefectRegressionTest(b));
    generatedTestSuiteStr = generateRegressionTestSuite(defectEntries);

    if (outputTests !== undefined) {
      try {
        const outPath = resolve(outputTests);
        const parent = dirname(outPath);
        if (!existsSync(parent)) {
          mkdirSync(parent, { recursive: true });
        }
        writeFileSync(outPath, generatedTestSuiteStr, "utf8");
      } catch {
      }
    }
  }

  let openCount = 0;
  let admittedCount = 0;
  let resolvedCount = 0;
  let declinedCount = 0;
  let criticalCount = 0;
  let warningCount = 0;
  const byCategory: Record<string, number> = {};
  const byCapsule: Record<string, number> = {};

  for (const b of allDefects) {
    if (b.status === "open") openCount = openCount + 1;
    else if (b.status === "admitted") admittedCount = admittedCount + 1;
    else if (b.status === "resolved") resolvedCount = resolvedCount + 1;
    else if (b.status === "declined" ? true : b.status === "ignored")
      declinedCount = declinedCount + 1;

    if (b.severity === "critical") criticalCount = criticalCount + 1;
    else warningCount = warningCount + 1;

    const cat = b.type;
    byCategory[cat] = (byCategory[cat] !== undefined ? byCategory[cat] : 0) + 1;

    const cap = b.source_capsule;
    byCapsule[cap] = (byCapsule[cap] !== undefined ? byCapsule[cap] : 0) + 1;
  }

  const badgeKeys = ["critical", "warning", "open", "admitted", "resolved", "declined"];
  const badgeDetails: ApcaBadgeInfo[] = badgeKeys.map((k) => getApcaBadgeInfo(k));
  const minLcObserved = badgeDetails.reduce(
    (min, b) => (b.lc < min ? b.lc : min),
    badgeDetails.length > 0 && badgeDetails[0] !== undefined ? badgeDetails[0].lc : 100,
  );
  const compliantBadges = badgeDetails.filter((b) => b.passes_apca).length;

  const apcaCompliance: ApcaContrastCompliance = {
    compliant_badges: compliantBadges,
    total_badges: badgeDetails.length,
    min_lc_observed: minLcObserved,
    passes_apca: compliantBadges === badgeDetails.length,
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
    runRoot: run !== undefined ? resolve(run) : null,
    defects: allDefects,
    summary,
    autoAdmittedCount,
    autoAdmittedCandidates,
    isAll,
    promotedCount,
    promotedDefects,
    generatedTestsCount: generatedTestsList ? generatedTestsList.length : undefined,
  });

  return {
    markdown,
    capsules_dir: resolvedCapsulesDir,
    run_root: run !== undefined ? resolve(run) : null,
    total_defects: allDefects.length,
    filtered_defects: allDefects,
    summary,
    auto_admitted_count: autoAdmittedCount,
    auto_admitted_candidates: autoAdmittedCandidates,
    ...(promotedCount > 0
      ? { promoted_count: promotedCount, promoted_defects: promotedDefects }
      : {}),
    ...(generatedTestsList !== undefined ? { generated_tests: generatedTestsList } : {}),
    ...(generatedTestSuiteStr !== undefined ? { generated_test_suite: generatedTestSuiteStr } : {}),
  };
}
