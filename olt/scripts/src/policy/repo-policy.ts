import { scanRepositoryToolchain } from "./generator/index.ts";

export interface DiscoveredToolchainPolicy {
  readonly commands: {
    readonly typecheck?: string | undefined;
    readonly lint?: string | undefined;
    readonly test?: string | undefined;
    readonly build?: string | undefined;
  };
  readonly toolchain: string;
}

export function discoverToolchainPolicy(repoRoot: string): DiscoveredToolchainPolicy {
  const analysis = scanRepositoryToolchain(repoRoot);
  return {
    commands: {
      typecheck: analysis.typecheckCommand ?? "bun run typecheck",
      lint: analysis.lintCommand ?? "bun run lint",
      test: analysis.testRunner.default_command ?? "bun test",
      build: analysis.buildCommand ?? "bun run build",
    },
    toolchain: analysis.ecosystem,
  };
}
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
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
} from "./generator/index.ts";
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
import { parseRepoPolicy, validateRepoPolicy } from "./schema/index.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  type PlanningPolicy,
  type RepoEcosystem,
  type RepoPolicy,
  type ReviewProtocolPolicy,
  type TestRunnerPolicy,
} from "./types/index.ts";

export {
  CURRENT_POLICY_SCHEMA_VERSION,
  DEFAULT_PLANNING_POLICY,
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  detectRepoEcosystem,
  generateCanonicalDefaultPolicy,
  generateDefaultRepoPolicy,
  validateRepoPolicy,
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
  readonly provenance?: "explicit_custom" | "auto_detected" | "default";
}

export interface RepoPolicyWriteDependencies {
  readonly open?: typeof openSync;
  readonly write?: typeof writeSync;
  readonly fsync?: typeof fsyncSync;
  readonly close?: typeof closeSync;
  readonly rename?: typeof renameSync;
  readonly fsyncDirectory?: (path: string) => void;
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
      provenance: "default",
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
        provenance: "default",
      };
    }
  }
  if (!existsSync(loc.filePath)) {
    const policy = { ...generateDefaultRepoPolicy(repoRoot), provenance: "auto_detected" };
    return { status: "auto_detected", policy, provenance: "auto_detected" };
  }
  try {

    ensureDir(loc.root, loc.parent);
    const raw = readVerifiedFile(loc, deps);
    if (raw === undefined) {
      const policy = { ...generateDefaultRepoPolicy(repoRoot), provenance: "auto_detected" };
      return { status: "auto_detected", policy, provenance: "auto_detected" };
    }


    const parsed = parseRepoPolicy(JSON.parse(raw) as unknown);
    const prov = parsed.provenance !== undefined ? parsed.provenance : "explicit_custom";
    const policy = { ...parsed, provenance: prov };
    return {
      status: "valid_custom",
      policy,
      filePath: loc.filePath,
      provenance: "explicit_custom",
    };
  } catch (err) {
    return {
      status: "invalid_custom",
      policy: generateDefaultRepoPolicy(repoRoot),
      filePath: loc.filePath,
      error: safeMsg(err),
      provenance: "default",
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
    const errText = res.error !== undefined ? res.error : "unknown error";
    throw new HarnessError(
      "INTEGRITY",
      `Repository policy at '${res.filePath}' is invalid: ${errText}`,
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
  const validated = parseRepoPolicy(policy);
  const loc = resolvePolicyLocation(repoRoot, customPath, true);
  const open = deps.open !== undefined ? deps.open : openSync;
  const write = deps.write !== undefined ? deps.write : writeSync;
  const sync = deps.fsync !== undefined ? deps.fsync : fsyncSync;
  const close = deps.close !== undefined ? deps.close : closeSync;
  const rename = deps.rename !== undefined ? deps.rename : renameSync;
  const dirFlag = constants.O_DIRECTORY !== undefined ? constants.O_DIRECTORY : 0;
  const syncDir =
    deps.fsyncDirectory !== undefined
      ? deps.fsyncDirectory
      : (p: string) => {
          const fd = openSync(p, constants.O_RDONLY | dirFlag | reqNoFollow());
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        };

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
      return loc.filePath;
    } catch (err) {
      const isUncertain = renamed ? true : !existsSync(tmp);
      if (isUncertain) {
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
