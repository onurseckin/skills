import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import {
  DEFAULT_PLANNING_POLICY,
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  detectRepoEcosystem,
  generateCanonicalDefaultPolicy,
  generateDefaultRepoPolicy,
} from "./generator.ts";
import {
  assertOwnedPrivateFile,
  checkExistingDir,
  ensureDir,
  readVerifiedFile,
  reqNoFollow,
  resolvePolicyLocation,
  safeMsg,
  withLock,
  type Location,
  type RepoPolicyReadDependencies,
} from "./io-safety.ts";
import { parseRepoPolicy } from "./schema.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  type PlanningPolicy,
  type RepoEcosystem,
  type RepoPolicy,
  type ReviewProtocolPolicy,
  type TestRunnerPolicy,
} from "./types.ts";

export {
  CURRENT_POLICY_SCHEMA_VERSION,
  DEFAULT_PLANNING_POLICY,
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  detectRepoEcosystem,
  generateCanonicalDefaultPolicy,
  generateDefaultRepoPolicy,
  type PlanningPolicy,
  type RepoEcosystem,
  type RepoPolicy,
  type RepoPolicyReadDependencies,
  type ReviewProtocolPolicy,
  type TestRunnerPolicy,
};

export interface PolicyInspectionResult {
  readonly status: "valid_custom" | "invalid_custom" | "auto_detected";
  readonly policy: RepoPolicy;
  readonly filePath?: string;
  readonly error?: string;
}

export interface RepoPolicyWriteDependencies {
  readonly open?: typeof openSync;
  readonly write?: typeof writeSync;
  readonly fsync?: typeof fsyncSync;
  readonly close?: typeof closeSync;
  readonly rename?: typeof renameSync;
  readonly fsyncDirectory?: (path: string) => void;
}

export function parseAuthorityRepoPolicy(raw: unknown): RepoPolicy {
  return parseRepoPolicy(raw);
}

export function validateRepoPolicy(raw: unknown): RepoPolicy {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HarnessError("INVALID_ARGUMENT", "Repo policy must be an object");
  }
  const rec = raw as Record<string, unknown>;
  const allowedKeys = new Set([
    "schema_version",
    "ecosystem",
    "package_manager",
    "skill_home_repo_root",
    "test_runner",
    "typecheck_command",
    "lint_command",
    "allowed_commands",
    "forbidden_commands",
    "read_scope_neighborhood_depth",
    "review_protocol",
    "planning",
    "agents",
    "docker_environment",
  ]);
  for (const k of Object.keys(rec)) {
    if (!allowedKeys.has(k))
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Repo policy contains unknown top-level key '${k}'`,
      );
  }
  const defaultPolicy = generateDefaultRepoPolicy();
  const rawEco = typeof rec["ecosystem"] === "string" ? rec["ecosystem"].toLowerCase() : "unknown";
  const eco: RepoEcosystem = ["bun", "node", "python", "cargo", "unknown"].includes(rawEco)
    ? (rawEco as RepoEcosystem)
    : "unknown";

  const tr =
    typeof rec["test_runner"] === "object" && rec["test_runner"] !== null
      ? (rec["test_runner"] as Record<string, unknown>)
      : {};
  const testRunner: TestRunnerPolicy = {
    default_command:
      typeof tr["default_command"] === "string" && tr["default_command"].trim()
        ? tr["default_command"].trim()
        : defaultPolicy.test_runner.default_command,
    targeted_pattern:
      typeof tr["targeted_pattern"] === "string" && tr["targeted_pattern"].trim()
        ? tr["targeted_pattern"].trim()
        : defaultPolicy.test_runner.targeted_pattern,
    full_suite_command:
      typeof tr["full_suite_command"] === "string" && tr["full_suite_command"].trim()
        ? tr["full_suite_command"].trim()
        : defaultPolicy.test_runner.full_suite_command,
  };

  const pl =
    typeof rec["planning"] === "object" && rec["planning"] !== null
      ? (rec["planning"] as Record<string, unknown>)
      : {};
  const planning: PlanningPolicy = {
    mandatory_brainstorming_rounds:
      typeof pl["mandatory_brainstorming_rounds"] === "number" &&
      Number.isSafeInteger(pl["mandatory_brainstorming_rounds"]) &&
      pl["mandatory_brainstorming_rounds"] >= 0
        ? pl["mandatory_brainstorming_rounds"]
        : DEFAULT_PLANNING_POLICY.mandatory_brainstorming_rounds,
    socratic_expansion_depth:
      typeof pl["socratic_expansion_depth"] === "number" &&
      Number.isSafeInteger(pl["socratic_expansion_depth"]) &&
      pl["socratic_expansion_depth"] >= 0
        ? pl["socratic_expansion_depth"]
        : DEFAULT_PLANNING_POLICY.socratic_expansion_depth,
    enforce_edge_case_matrix:
      typeof pl["enforce_edge_case_matrix"] === "boolean"
        ? pl["enforce_edge_case_matrix"]
        : DEFAULT_PLANNING_POLICY.enforce_edge_case_matrix,
    min_tasks_per_complex_prompt:
      typeof pl["min_tasks_per_complex_prompt"] === "number" &&
      Number.isSafeInteger(pl["min_tasks_per_complex_prompt"]) &&
      pl["min_tasks_per_complex_prompt"] >= 1
        ? pl["min_tasks_per_complex_prompt"]
        : DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt,
    max_files_per_task:
      typeof pl["max_files_per_task"] === "number" &&
      Number.isSafeInteger(pl["max_files_per_task"]) &&
      pl["max_files_per_task"] >= 1
        ? pl["max_files_per_task"]
        : DEFAULT_PLANNING_POLICY.max_files_per_task,
    reject_shallow_umbrella_compression:
      typeof pl["reject_shallow_umbrella_compression"] === "boolean"
        ? pl["reject_shallow_umbrella_compression"]
        : DEFAULT_PLANNING_POLICY.reject_shallow_umbrella_compression,
  };

  const rp =
    typeof rec["review_protocol"] === "object" && rec["review_protocol"] !== null
      ? (rec["review_protocol"] as Record<string, unknown>)
      : {};
  const maxAdv =
    typeof rp["max_adversarial_pushes"] === "number" &&
    Number.isSafeInteger(rp["max_adversarial_pushes"]) &&
    rp["max_adversarial_pushes"] >= 1
      ? rp["max_adversarial_pushes"]
      : DEFAULT_REVIEW_PROTOCOL_POLICY.max_adversarial_pushes;
  const cog =
    typeof rp["cognitive_pushes"] === "number" &&
    Number.isSafeInteger(rp["cognitive_pushes"]) &&
    rp["cognitive_pushes"] >= 0
      ? rp["cognitive_pushes"]
      : DEFAULT_REVIEW_PROTOCOL_POLICY.cognitive_pushes;
  const reviewProtocol: ReviewProtocolPolicy = {
    max_adversarial_pushes: maxAdv,
    cognitive_pushes: cog,
    escalate_on_exhausted_adversarial:
      typeof rp["escalate_on_exhausted_adversarial"] === "boolean"
        ? rp["escalate_on_exhausted_adversarial"]
        : (DEFAULT_REVIEW_PROTOCOL_POLICY.escalate_on_exhausted_adversarial ?? true),
  };

  return {
    schema_version:
      typeof rec["schema_version"] === "number"
        ? rec["schema_version"]
        : CURRENT_POLICY_SCHEMA_VERSION,
    ecosystem: eco,
    ...(typeof rec["package_manager"] === "string"
      ? { package_manager: rec["package_manager"] as RepoPolicy["package_manager"] }
      : {}),
    ...(typeof rec["skill_home_repo_root"] === "string"
      ? { skill_home_repo_root: rec["skill_home_repo_root"].trim() }
      : {}),
    test_runner: testRunner,
    ...(typeof rec["typecheck_command"] === "string"
      ? { typecheck_command: rec["typecheck_command"].trim() }
      : {}),
    ...(typeof rec["lint_command"] === "string"
      ? { lint_command: rec["lint_command"].trim() }
      : {}),
    ...(Array.isArray(rec["allowed_commands"])
      ? {
          allowed_commands: rec["allowed_commands"].filter(
            (c): c is string => typeof c === "string" && c.trim().length > 0,
          ),
        }
      : {}),
    ...(Array.isArray(rec["forbidden_commands"])
      ? {
          forbidden_commands: rec["forbidden_commands"].filter(
            (c): c is string => typeof c === "string" && c.trim().length > 0,
          ),
        }
      : {}),
    read_scope_neighborhood_depth:
      typeof rec["read_scope_neighborhood_depth"] === "number" &&
      rec["read_scope_neighborhood_depth"] >= 0
        ? rec["read_scope_neighborhood_depth"]
        : 2,
    review_protocol: reviewProtocol,
    planning,
  };
}

export function inspectRepoPolicy(
  repoRoot?: string,
  customPath?: string,
  deps: RepoPolicyReadDependencies = {},
): PolicyInspectionResult {
  let loc: Location;
  try {
    loc = resolvePolicyLocation(repoRoot, customPath);
  } catch (err) {
    return {
      status: "invalid_custom",
      policy: generateDefaultRepoPolicy(repoRoot),
      ...(customPath ? { filePath: customPath } : {}),
      error: safeMsg(err),
    };
  }
  if (existsSync(loc.root)) {
    try {
      checkExistingDir(loc.root, loc.parent);
    } catch (err) {
      return {
        status: "invalid_custom",
        policy: generateDefaultRepoPolicy(repoRoot),
        filePath: loc.filePath,
        error: safeMsg(err),
      };
    }
  }
  if (!existsSync(loc.filePath))
    return { status: "auto_detected", policy: generateDefaultRepoPolicy(repoRoot) };
  try {
    ensureDir(loc.root, loc.parent);
    const raw = readVerifiedFile(loc, deps);
    if (raw === undefined)
      return { status: "auto_detected", policy: generateDefaultRepoPolicy(repoRoot) };
    const policy = parseAuthorityRepoPolicy(JSON.parse(raw) as unknown);
    return { status: "valid_custom", policy, filePath: loc.filePath };
  } catch (err) {
    return {
      status: "invalid_custom",
      policy: generateDefaultRepoPolicy(repoRoot),
      filePath: loc.filePath,
      error: safeMsg(err),
    };
  }
}

export function loadRepoPolicy(
  repoRoot?: string,
  customPath?: string,
  deps: RepoPolicyReadDependencies = {},
): RepoPolicy {
  const res = inspectRepoPolicy(repoRoot, customPath, deps);
  if (res.status === "invalid_custom") {
    throw new HarnessError(
      "INTEGRITY",
      `Repository policy at '${res.filePath}' is invalid: ${res.error ?? "unknown error"}`,
    );
  }
  return res.policy;
}

export function saveRepoPolicy(
  policy: RepoPolicy,
  repoRoot?: string,
  customPath?: string,
  deps: RepoPolicyWriteDependencies = {},
): string {
  const validated = parseAuthorityRepoPolicy(policy);
  const loc = resolvePolicyLocation(repoRoot, customPath, true);
  const open = deps.open ?? openSync;
  const write = deps.write ?? writeSync;
  const sync = deps.fsync ?? fsyncSync;
  const close = deps.close ?? closeSync;
  const rename = deps.rename ?? renameSync;
  const syncDir =
    deps.fsyncDirectory ??
    ((p: string) => {
      const fd = openSync(p, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | reqNoFollow());
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    });

  const serialized = JSON.stringify(validated, null, 2) + "\n";
  const bytes = Buffer.from(serialized, "utf8");

  return withLock(loc, () => {
    ensureDir(loc.root, loc.parent);
    if (existsSync(loc.filePath)) assertOwnedPrivateFile(lstatSync(loc.filePath), loc.filePath);
    const tmp = join(
      loc.parent,
      `.${loc.filePath.slice(loc.parent.length + 1)}.${randomUUID()}.tmp`,
    );
    let fd: number | undefined;
    let renamed = false;
    try {
      fd = open(
        tmp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | reqNoFollow(),
        0o600,
      );
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = write(fd, bytes, offset, bytes.byteLength - offset);
        if (written <= 0 || written > bytes.byteLength - offset) {
          throw new HarnessError(
            "INTEGRITY",
            `Repository policy write made no progress: ${loc.filePath}`,
          );
        }
        offset += written;
      }
      sync(fd);
      close(fd);
      fd = undefined;
      ensureDir(loc.root, loc.parent);
      if (existsSync(loc.filePath)) assertOwnedPrivateFile(lstatSync(loc.filePath), loc.filePath);
      rename(tmp, loc.filePath);
      renamed = true;
      syncDir(loc.parent);
      ensureDir(loc.root, loc.parent);
      if (existsSync(loc.filePath)) assertOwnedPrivateFile(lstatSync(loc.filePath), loc.filePath);

      if (!customPath && loc.filePath === join(loc.root, ".olt", "policy.json")) {
        const altDir = join(loc.root, "olt");
        if (existsSync(altDir) && lstatSync(altDir).isDirectory()) {
          try {
            copyFileSync(loc.filePath, join(altDir, "policy.json"));
          } catch {
            /* best effort */
          }
        }
      }
      return loc.filePath;
    } catch (err) {
      if (renamed || !existsSync(tmp)) {
        throw new HarnessError(
          "INTEGRITY",
          `Repository policy write outcome is uncertain after rename: ${loc.filePath}: ${safeMsg(err)}`,
        );
      }
      throw err;
    } finally {
      if (fd !== undefined) close(fd);
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    }
  });
}

export function initRepoPolicy(repoRoot?: string): RepoPolicy {
  const policy = generateDefaultRepoPolicy(repoRoot);
  saveRepoPolicy(policy, repoRoot);
  return policy;
}
