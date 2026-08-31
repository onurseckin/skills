import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export interface CapsuleHygieneViolation {
  readonly path: string;
  readonly reason: string;
  readonly patternMatched: string;
}

export interface CapsuleHygieneValidationResult {
  readonly valid: boolean;
  readonly inspectedPaths: readonly string[];
  readonly violations: readonly CapsuleHygieneViolation[];
}

const DIRTY_PATTERNS = [
  /^scratch/i,
  /^temp[_\-.]/i,
  /^tmp[_\-.]/i,
  /\.tmp$/i,
  /\.temp$/i,
  /\.bak$/i,
  /\.swp$/i,
  /~$/,
  /\.DS_Store$/i,
  /\.orig$/i,
  /^dirty/i,
  /^untracked/i,
  /\.log$/i,
];

function checkCapsuleEntry(name: string, fullPath: string): CapsuleHygieneViolation | null {
  for (const p of DIRTY_PATTERNS) {
    if (p.test(name)) {
      return {
        path: fullPath,
        reason: `Forbidden scratch or temporary artifact '${name}' in capsule directory`,
        patternMatched: p.toString(),
      };
    }
  }
  return null;
}

export function validateCapsuleDiskHygiene(
  capsulesDir: string | readonly string[],
): CapsuleHygieneValidationResult {
  const violations: CapsuleHygieneViolation[] = [];
  const inspectedPaths: string[] = [];

  if (typeof capsulesDir === "string") {
    if (existsSync(capsulesDir)) {
      const scan = (dir: string): void => {
        inspectedPaths.push(dir);
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const itemPath = join(dir, entry.name);
          inspectedPaths.push(itemPath);
          const v = checkCapsuleEntry(entry.name, itemPath);
          if (v) violations.push(v);
          if (entry.isDirectory()) scan(itemPath);
        }
      };
      scan(capsulesDir);
    } else {
      inspectedPaths.push(capsulesDir);
      const v = checkCapsuleEntry(basename(capsulesDir), capsulesDir);
      if (v) violations.push(v);
    }
  } else {
    for (const p of capsulesDir) {
      inspectedPaths.push(p);
      const v = checkCapsuleEntry(basename(p), p);
      if (v) violations.push(v);
    }
  }

  return { valid: violations.length === 0, inspectedPaths, violations };
}
