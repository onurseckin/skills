import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { validateResolutionProof, verifyResolutionProofEmpirical } from "./resolution.ts";
import {
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  isDefectEligibleForPromotion,
  type GeneratedRegressionTest,
} from "./regression-gen.ts";
import {
  appendCompletedDefectLogEntry,
  atomicWriteDefectLog,
  readExistingDefectLog,
  resolveCanonicalCompletedDefectsPath,
  resolveCanonicalDefectLogPath,
  resolveCompletedDefectsPath,
  resolveDefectLogPath,
} from "./ledger-ops.ts";
import type { DefectEntry, DefectResolutionProof } from "../core/types.ts";

export interface DefectPromotionOptions {
  readonly sourcePath?: string | undefined;
  readonly targetPath?: string | undefined;
  readonly capsuleRoot?: string | undefined;
  readonly requireResolutionProof?: boolean | undefined;
  readonly requireCommitSha?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly updateSourceFile?: boolean | undefined;
  readonly generateRegressionTests?: boolean | undefined;
}

export interface DefectPromotionResult {
  readonly promoted_count: number;
  readonly unpromoted_count: number;
  readonly total_evaluated: number;
  readonly promoted_defects: readonly DefectEntry[];
  readonly remaining_defects: readonly DefectEntry[];
  readonly source_path: string;
  readonly target_path: string;
  readonly generated_tests?: readonly GeneratedRegressionTest[] | undefined;
  readonly generated_test_suite?: string | undefined;
}

export function requireDistinctLedgerPaths(sourcePath: string, targetPath: string): void {
  const normSource = resolve(sourcePath);
  const normTarget = resolve(targetPath);
  if (normSource === normTarget) {
    throw new HarnessError("INTEGRITY", "source and target defect ledger paths must be distinct");
  }

  if (existsSync(normTarget)) {
    const statTarget = lstatSync(normTarget);
    if (statTarget.isDirectory()) {
      throw new HarnessError("INTEGRITY", "completed target path is a directory");
    }
  }

  if (existsSync(normSource) && existsSync(normTarget)) {
    try {
      const realSource = realpathSync(normSource);
      const realTarget = realpathSync(normTarget);
      if (realSource === realTarget) {
        throw new HarnessError(
          "INTEGRITY",
          "source and target defect ledgers point to the same physical file via symlink",
        );
      }
      const statSource = lstatSync(normSource);
      const statTarget = lstatSync(normTarget);
      if (statSource.dev === statTarget.dev && statSource.ino === statTarget.ino) {
        throw new HarnessError(
          "INTEGRITY",
          "source and target defect ledgers point to the same file via hardlink",
        );
      }
    } catch (e) {
      if (e instanceof HarnessError) throw e;
    }
  }
}

export function validateRegressionTest(testCode: string): {
  readonly isValid: boolean;
  readonly issues: readonly string[];
} {
  const issues: string[] = [];
  if (typeof testCode !== "string" || !testCode.trim()) {
    return { isValid: false, issues: ["Test code is empty or not a string"] };
  }
  if (!testCode.includes("describe(") && !testCode.includes("test(") && !testCode.includes("it(")) {
    issues.push("Test code must contain at least describe(), test(), or it()");
  }
  if (!testCode.includes("expect(")) {
    issues.push("Test code must contain expect() assertion");
  }
  let openBraces = 0;
  let openParens = 0;
  for (let i = 0; i < testCode.length; i += 1) {
    const ch = testCode[i];
    if (ch === "{") openBraces += 1;
    else if (ch === "}") openBraces -= 1;
    else if (ch === "(") openParens += 1;
    else if (ch === ")") openParens -= 1;
  }
  if (openBraces !== 0) issues.push(`Mismatched braces: balance is ${openBraces}`);
  if (openParens !== 0) issues.push(`Mismatched parentheses: balance is ${openParens}`);

  return { isValid: issues.length === 0, issues };
}

export function promoteResolvedDefects(
  entriesOrOptions?: readonly DefectEntry[] | DefectPromotionOptions,
  maybeOptions?: DefectPromotionOptions,
): DefectPromotionResult {
  let entries: readonly DefectEntry[] | undefined;
  let options: DefectPromotionOptions;

  if (Array.isArray(entriesOrOptions)) {
    entries = entriesOrOptions;
    options = maybeOptions ?? {};
  } else {
    options = (entriesOrOptions as DefectPromotionOptions) ?? {};
    entries = undefined;
  }

  const sourcePath = options.sourcePath
    ? resolve(options.sourcePath)
    : options.capsuleRoot
      ? resolveCanonicalDefectLogPath(options.capsuleRoot)
      : resolveDefectLogPath();

  const targetPath = options.targetPath
    ? resolve(options.targetPath)
    : options.capsuleRoot
      ? resolveCanonicalCompletedDefectsPath(options.capsuleRoot)
      : resolveCompletedDefectsPath();

  requireDistinctLedgerPaths(sourcePath, targetPath);

  let activeDefects: DefectEntry[] = [];
  if (entries !== undefined) {
    activeDefects = [...entries];
  } else if (existsSync(sourcePath)) {
    activeDefects = readExistingDefectLog(sourcePath, "Read active defects log");
  }

  const requireProof = options.requireResolutionProof !== false;
  const eligibleToPromote: DefectEntry[] = [];
  const remaining: DefectEntry[] = [];

  for (const b of activeDefects) {
    if (b.status === "resolved" || b.status === "completed") {
      if (b.resolution && typeof b.resolution === "object") {
        const proof = verifyResolutionProofEmpirical(b.resolution, {
          requireCommitSha: options.requireCommitSha,
        });
        if (!proof.isValid) {
          throw new HarnessError(
            "INTEGRITY",
            `resolved defect '${b.id}' has invalid resolution: ${proof.reason ?? "unknown error"}`,
          );
        }
      }
      if (requireProof) {
        if (isDefectEligibleForPromotion(b, { requireCommitSha: options.requireCommitSha })) {
          eligibleToPromote.push(b);
        } else {
          remaining.push(b);
        }
      } else {
        eligibleToPromote.push(b);
      }
    } else {
      remaining.push(b);
    }
  }

  let generatedTests: GeneratedRegressionTest[] | undefined = undefined;
  let generatedTestSuite: string | undefined = undefined;
  if (options.generateRegressionTests && eligibleToPromote.length > 0) {
    generatedTests = eligibleToPromote.map((b) => generateDefectRegressionTest(b));
    generatedTestSuite = generateRegressionTestSuite(eligibleToPromote);
  }

  if (!options.dryRun && eligibleToPromote.length > 0) {
    for (const entry of eligibleToPromote) {
      appendCompletedDefectLogEntry(entry, targetPath);
    }
    if (entries === undefined && options.updateSourceFile !== false && existsSync(sourcePath)) {
      atomicWriteDefectLog(remaining, sourcePath, "Write active defects log");
    }
  }

  return {
    promoted_count: eligibleToPromote.length,
    unpromoted_count: remaining.length,
    total_evaluated: activeDefects.length,
    promoted_defects: eligibleToPromote,
    remaining_defects: remaining,
    source_path: sourcePath,
    target_path: targetPath,
    ...(generatedTests !== undefined ? { generated_tests: generatedTests } : {}),
    ...(generatedTestSuite !== undefined ? { generated_test_suite: generatedTestSuite } : {}),
  };
}

export function autoPromoteDefect(params: {
  readonly id: string;
  readonly proof: DefectResolutionProof;
  readonly options?: DefectPromotionOptions | undefined;
}): {
  readonly promoted: boolean;
  readonly defect: DefectEntry;
  readonly targetPath: string;
} {
  const validatedProof = validateResolutionProof(params.proof, {
    requireCommitSha: params.options?.requireCommitSha,
  });
  const sourcePath = params.options?.sourcePath
    ? resolve(params.options.sourcePath)
    : params.options?.capsuleRoot
      ? resolveCanonicalDefectLogPath(params.options.capsuleRoot)
      : resolveDefectLogPath();

  const targetPath = params.options?.targetPath
    ? resolve(params.options.targetPath)
    : params.options?.capsuleRoot
      ? resolveCanonicalCompletedDefectsPath(params.options.capsuleRoot)
      : resolveCompletedDefectsPath();

  requireDistinctLedgerPaths(sourcePath, targetPath);

  let existingActive: DefectEntry[] = [];
  if (existsSync(sourcePath)) {
    existingActive = readExistingDefectLog(sourcePath, "Read active defects log");
  }

  const foundDefect = existingActive.find((b) => b.id === params.id);
  if (!foundDefect) {
    throw new HarnessError("INTEGRITY", `active defect '${params.id}' is absent`);
  }

  const resolved: DefectEntry = {
    ...foundDefect,
    status: "resolved",
    resolution: validatedProof,
  };

  if (!params.options?.dryRun) {
    appendCompletedDefectLogEntry(resolved, targetPath);
    if (params.options?.updateSourceFile !== false && existsSync(sourcePath)) {
      const remaining = existingActive.filter((b) => b.id !== params.id);
      atomicWriteDefectLog(remaining, sourcePath, "Write active defects log");
    }
  }

  return {
    promoted: true,
    defect: resolved,
    targetPath,
  };
}
