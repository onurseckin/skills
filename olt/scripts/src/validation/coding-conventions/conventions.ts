import { basename } from "node:path";
import { validateCapsuleDiskHygiene, type CapsuleHygieneValidationResult } from "./capsule.ts";
import {
  validateZeroCommentsInCode,
  type CommentViolation,
  type ZeroCommentsValidationResult,
} from "./comments.ts";
import { validateDensityBudgets, type DensityValidationResult } from "./density.ts";
import { validateFacadeExports, type FacadeValidationResult } from "./facades.ts";
import { validateNoBackwardsCompatibilityShims, type ShimValidationResult } from "./shims.ts";

export interface RepoConventionsCheckOptions {
  readonly targetFiles?: readonly { readonly path: string; readonly content: string }[] | undefined;
  readonly directories?:
    | readonly {
        readonly path: string;
        readonly fileCount?: number | undefined;
        readonly filePaths?: readonly string[] | undefined;
      }[]
    | undefined;
  readonly capsulesDir?: string | readonly string[] | undefined;
  readonly maxLinesPerFile?: number | undefined;
  readonly maxFilesPerDirectory?: number | undefined;
}

export interface RepoConventionsValidationResult {
  readonly valid: boolean;
  readonly commentsResult: ZeroCommentsValidationResult;
  readonly densityResult: DensityValidationResult;
  readonly facadeResults: readonly FacadeValidationResult[];
  readonly shimResults: readonly ShimValidationResult[];
  readonly capsuleHygieneResult: CapsuleHygieneValidationResult;
  readonly allViolations: readonly string[];
}

export function validateRepositoryCodingConventions(
  options: RepoConventionsCheckOptions,
): RepoConventionsValidationResult {
  const allViolations: string[] = [];
  let commentsValid = true;
  const commentViolations: CommentViolation[] = [];

  if (options.targetFiles) {
    for (const f of options.targetFiles) {
      const res = validateZeroCommentsInCode(f.content, f.path);
      if (!res.valid) {
        commentsValid = false;
        commentViolations.push(...res.violations);
        for (const v of res.violations) {
          allViolations.push(
            `Comment violation in ${f.path}:${v.line}:${v.column} (${v.type}): ${v.snippet}`,
          );
        }
      }
    }
  }

  const densityResult = validateDensityBudgets({
    ...(options.targetFiles
      ? { files: options.targetFiles.map((f) => ({ path: f.path, content: f.content })) }
      : {}),
    ...(options.directories !== undefined ? { directories: options.directories } : {}),
    ...(options.maxLinesPerFile !== undefined ? { maxLinesPerFile: options.maxLinesPerFile } : {}),
    ...(options.maxFilesPerDirectory !== undefined
      ? { maxFilesPerDirectory: options.maxFilesPerDirectory }
      : {}),
  });

  if (!densityResult.valid) {
    for (const fv of densityResult.fileViolations) {
      allViolations.push(`File density exceeded: ${fv.filePath} (${fv.lineCount} > ${fv.limit})`);
    }
    for (const dv of densityResult.directoryViolations) {
      allViolations.push(
        `Directory density exceeded: ${dv.directoryPath} (${dv.fileCount} > ${dv.limit})`,
      );
    }
  }

  const facadeResults: FacadeValidationResult[] = [];
  const shimResults: ShimValidationResult[] = [];

  if (options.targetFiles) {
    for (const f of options.targetFiles) {
      if (basename(f.path) === "index.ts") {
        const res = validateFacadeExports(f.content, f.path);
        facadeResults.push(res);
        if (!res.valid) {
          for (const v of res.violations) {
            allViolations.push(`Facade violation in ${f.path}:${v.line}: ${v.reason}`);
          }
        }
      }
      const sRes = validateNoBackwardsCompatibilityShims(f.content, f.path);
      shimResults.push(sRes);
      if (!sRes.valid) {
        for (const v of sRes.violations) {
          allViolations.push(`Shim violation in ${f.path}:${v.line}: ${v.reason}`);
        }
      }
    }
  }

  const capsuleHygieneResult = options.capsulesDir
    ? validateCapsuleDiskHygiene(options.capsulesDir)
    : { valid: true, inspectedPaths: [], violations: [] };

  if (!capsuleHygieneResult.valid) {
    for (const v of capsuleHygieneResult.violations) {
      allViolations.push(`Capsule hygiene violation: ${v.path} - ${v.reason}`);
    }
  }

  const valid =
    commentsValid &&
    densityResult.valid &&
    facadeResults.every((r) => r.valid) &&
    shimResults.every((r) => r.valid) &&
    capsuleHygieneResult.valid;

  return {
    valid,
    commentsResult: { valid: commentsValid, violations: commentViolations },
    densityResult,
    facadeResults,
    shimResults,
    capsuleHygieneResult,
    allViolations,
  };
}
