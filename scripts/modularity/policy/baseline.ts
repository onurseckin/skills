import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { Violation, ViolationRule } from "../core/index.ts";

export interface ModularityBaseline {
  readonly schema: "olt-modularity-baseline/v1";
  readonly violations: readonly Violation[];
}

interface BaselineDocument {
  readonly schema: "olt-modularity-baseline/v1";
  readonly violations?: readonly Violation[];
  readonly shards?: readonly string[];
}

const RULES: readonly ViolationRule[] = [
  "line_limit",
  "directory_fanout",
  "missing_facade",
  "export_star",
  "facade_bypass",
  "dependency_cycle",
  "root_no_growth",
  "generated_catalog",
];

function failure(message: string): never {
  throw new Error(`Invalid modularity baseline: ${message}`);
}

function assertInsideRepository(repoRoot: string, baselinePath: string): string {
  const root = resolve(repoRoot);
  const path = resolve(root, baselinePath);
  const pathRelative = relative(root, path);
  if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || pathRelative === "") {
    failure("baseline path is outside the repository");
  }
  return path;
}

function validateViolation(value: unknown): Violation {
  if (typeof value !== "object" || value === null) failure("violation must be an object");
  const finding = value as Record<string, unknown>;
  const keys = Object.keys(finding);
  if (!keys.every((key) => ["rule", "path", "observed", "limit", "detail"].includes(key))) {
    failure("violation has unknown keys");
  }
  if (
    typeof finding.rule !== "string" ||
    !RULES.includes(finding.rule as ViolationRule) ||
    typeof finding.path !== "string" ||
    finding.path.length === 0 ||
    typeof finding.detail !== "string"
  ) {
    failure("violation has invalid required fields");
  }
  if (typeof finding.observed !== "string" && typeof finding.observed !== "number") {
    failure("violation has invalid observed value");
  }
  if (
    typeof finding.observed === "number" &&
    (!Number.isFinite(finding.observed) || finding.observed < 0)
  ) {
    failure("violation has negative or invalid observed value");
  }
  if (finding.limit !== undefined && (typeof finding.limit !== "number" || finding.limit < 0)) {
    failure("violation has invalid limit");
  }
  return finding as Violation;
}

function violationIdentity(violation: Violation): string {
  return violation.rule === "line_limit" || violation.rule === "directory_fanout"
    ? `${violation.rule}:${violation.path}`
    : `${violation.rule}:${violation.path}:${String(violation.observed)}`;
}

function assertUnique(violations: readonly Violation[]): void {
  const identities = new Set<string>();
  for (const violation of violations) {
    const identity = violationIdentity(violation);
    if (identities.has(identity)) failure(`duplicate identity ${identity}`);
    identities.add(identity);
  }
}

function validateDocument(value: unknown): BaselineDocument {
  if (typeof value !== "object" || value === null) failure("root must be an object");
  const baseline = value as Record<string, unknown>;
  if (
    Object.keys(baseline).some(
      (key) => key !== "schema" && key !== "violations" && key !== "shards",
    )
  ) {
    failure("unknown root key");
  }
  if (
    baseline.schema !== "olt-modularity-baseline/v1" ||
    Array.isArray(baseline.violations) === Array.isArray(baseline.shards)
  ) {
    failure("stale or missing schema");
  }
  if (Array.isArray(baseline.violations)) {
    return {
      schema: baseline.schema,
      violations: baseline.violations.map(validateViolation),
    };
  }
  if (!baseline.shards?.every((shard) => typeof shard === "string" && shard.length > 0)) {
    failure("invalid shard path");
  }
  return {
    schema: baseline.schema,
    shards: baseline.shards as readonly string[],
  };
}

export async function loadBaseline(
  repoRoot: string,
  baselinePath: string,
): Promise<ModularityBaseline> {
  const path = assertInsideRepository(repoRoot, baselinePath);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    failure("missing baseline file");
  }
  try {
    const document = validateDocument(JSON.parse(text));
    if (document.violations) return { schema: document.schema, violations: document.violations };
    const seen = new Set<string>();
    const violations: Violation[] = [];
    for (const shard of document.shards ?? []) {
      const shardPath = assertInsideRepository(repoRoot, resolve(dirname(path), shard));
      if (seen.has(shardPath)) failure(`duplicate shard ${shard}`);
      seen.add(shardPath);
      let shardText: string;
      try {
        shardText = await readFile(shardPath, "utf8");
      } catch {
        failure(`missing baseline shard ${shard}`);
      }
      const parsed = JSON.parse(shardText);
      if (!Array.isArray(parsed)) failure(`baseline shard ${shard} must be an array`);
      violations.push(...parsed.map(validateViolation));
    }
    assertUnique(violations);
    return { schema: document.schema, violations };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid modularity baseline:"))
      throw error;
    failure("invalid JSON");
  }
}
