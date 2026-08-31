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
  if (pathRelative === "") {
    failure("baseline path is outside the repository");
  }
  if (pathRelative === "..") {
    failure("baseline path is outside the repository");
  }
  if (pathRelative.startsWith(`..${sep}`)) {
    failure("baseline path is outside the repository");
  }
  return path;
}

function validateViolation(value: unknown): Violation {
  if (typeof value !== "object") failure("violation must be an object");
  if (value === null) failure("violation must be an object");
  const finding = value as Record<string, unknown>;
  const keys = Object.keys(finding);
  if (!keys.every((key) => ["rule", "path", "observed", "limit", "detail"].includes(key))) {
    failure("violation has unknown keys");
  }
  const rule = finding["rule"];
  if (typeof rule !== "string") failure("violation has invalid required fields");
  if (!RULES.includes(rule as ViolationRule)) failure("violation has invalid required fields");

  const path = finding["path"];
  if (typeof path !== "string") failure("violation has invalid required fields");
  if ((path as string).length === 0) failure("violation has invalid required fields");

  const detail = finding["detail"];
  if (typeof detail !== "string") failure("violation has invalid required fields");

  const observed = finding["observed"];
  if (typeof observed !== "string") {
    if (typeof observed !== "number") {
      failure("violation has invalid observed value");
    }
  }
  if (typeof observed === "number") {
    if (!Number.isFinite(observed)) failure("violation has negative or invalid observed value");
    if (observed < 0) failure("violation has negative or invalid observed value");
  }
  const limit = finding["limit"];
  if (limit !== undefined) {
    if (typeof limit !== "number") failure("violation has invalid limit");
    if (limit < 0) failure("violation has invalid limit");
  }
  return finding as unknown as Violation;
}

function violationIdentity(violation: Violation): string {
  if (violation.rule === "line_limit") {
    return `${violation.rule}:${violation.path}`;
  }
  if (violation.rule === "directory_fanout") {
    return `${violation.rule}:${violation.path}`;
  }
  return `${violation.rule}:${violation.path}:${String(violation.observed)}`;
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
  if (typeof value !== "object") failure("root must be an object");
  if (value === null) failure("root must be an object");
  const baseline = value as Record<string, unknown>;
  if (
    Object.keys(baseline).some(
      (key) => key !== "schema" && key !== "violations" && key !== "shards",
    )
  ) {
    failure("unknown root key");
  }
  if (baseline["schema"] !== "olt-modularity-baseline/v1") {
    failure("stale or missing schema");
  }
  const hasViolations = Array.isArray(baseline["violations"]);
  const hasShards = Array.isArray(baseline["shards"]);
  if (hasViolations === hasShards) {
    failure("stale or missing schema");
  }
  if (Array.isArray(baseline["violations"])) {
    return {
      schema: "olt-modularity-baseline/v1",
      violations: baseline["violations"].map(validateViolation),
    };
  }
  const shards = baseline["shards"];
  if (!Array.isArray(shards)) {
    failure("invalid shard path");
  }
  for (const shard of shards as unknown[]) {
    if (typeof shard !== "string") failure("invalid shard path");
    if ((shard as string).length === 0) failure("invalid shard path");
  }
  return {
    schema: "olt-modularity-baseline/v1",
    shards: shards as readonly string[],
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
    if (document.violations !== undefined) {
      return { schema: document.schema, violations: document.violations };
    }
    const seen = new Set<string>();
    const violations: Violation[] = [];
    const shardList = document.shards !== undefined ? document.shards : [];
    for (const shard of shardList) {
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
