import { homedir } from "node:os";
import { lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { JsonValue } from "../core/contracts/json.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { clientLinkPaths } from "./client-links.ts";
import { SKILL_NAME } from "./constants.ts";
import { validateSkillSource, type ValidatedSkillSource } from "./source-validation.ts";

export type InstallRootKind = "primary" | "claude" | "antigravity";

export interface InstallRootFreshness {
  kind: InstallRootKind;
  path: string;
  present: boolean;
  resolvedPath: string | null;
  digest: string | null;
  runtimeVersion: string | null;
  fresh: boolean;
  issue: string | null;
}

export interface RuntimeFreshnessReport {
  referenceRoot: string;
  referenceDigest: string;
  referenceRuntimeVersion: string;
  roots: readonly InstallRootFreshness[];
  drifted: boolean;
}

function candidateRoots(home: string): ReadonlyArray<{ kind: InstallRootKind; path: string }> {
  const clients = clientLinkPaths(home);
  return [
    { kind: "primary", path: join(home, ".agents", "skills", SKILL_NAME) },
    { kind: "claude", path: clients.claude },
    { kind: "antigravity", path: clients.antigravity },
  ];
}

async function rootFreshness(
  kind: InstallRootKind,
  path: string,
  reference: ValidatedSkillSource,
): Promise<InstallRootFreshness> {
  const stat = await lstat(path).catch(() => null);
  if (!stat) {
    return {
      kind,
      path,
      present: false,
      resolvedPath: null,
      digest: null,
      runtimeVersion: null,
      fresh: true,
      issue: null,
    };
  }
  try {
    const resolvedPath = await realpath(path);
    const installed = await validateSkillSource(resolvedPath);
    const fresh =
      installed.digest === reference.digest &&
      installed.runtimeVersion === reference.runtimeVersion;
    return {
      kind,
      path,
      present: true,
      resolvedPath,
      digest: installed.digest,
      runtimeVersion: installed.runtimeVersion,
      fresh,
      issue: fresh
        ? null
        : `installed content (${installed.runtimeVersion} @ ${installed.digest.slice(0, 12)}) ` +
          `disagrees with the running source (${reference.runtimeVersion} @ ${reference.digest.slice(0, 12)})`,
    };
  } catch (error) {
    return {
      kind,
      path,
      present: true,
      resolvedPath: null,
      digest: null,
      runtimeVersion: null,
      fresh: false,
      issue: error instanceof Error ? error.message : "install root could not be verified",
    };
  }
}

export async function installedRuntimeFreshness(
  reference: ValidatedSkillSource,
  home: string = homedir(),
): Promise<RuntimeFreshnessReport> {
  const roots = await Promise.all(
    candidateRoots(home).map((candidate) =>
      rootFreshness(candidate.kind, candidate.path, reference),
    ),
  );
  return {
    referenceRoot: reference.root,
    referenceDigest: reference.digest,
    referenceRuntimeVersion: reference.runtimeVersion,
    roots,
    drifted: roots.some((root) => root.present && !root.fresh),
  };
}

export function freshnessFindings(report: RuntimeFreshnessReport): JsonValue[] {
  return report.roots
    .filter((root) => root.present && !root.fresh)
    .map((root) => ({
      severity: "blocking",
      kind: root.kind,
      path: root.path,
      resolved_path: root.resolvedPath,
      digest: root.digest,
      runtime_version: root.runtimeVersion,
      reference_root: report.referenceRoot,
      reference_digest: report.referenceDigest,
      reference_runtime_version: report.referenceRuntimeVersion,
      issue: root.issue,
    }));
}

function describeReport(report: RuntimeFreshnessReport): string {
  const bad = report.roots.filter((root) => root.present && !root.fresh);
  const summary = bad.map((root) => `${root.kind} (${root.path}): ${root.issue}`).join("; ");
  return (
    `installed-runtime freshness check failed: ${bad.length} of ${report.roots.length} ` +
    `discoverable install root(s) have drifted from the running source ` +
    `${report.referenceRuntimeVersion} @ ${report.referenceDigest.slice(0, 12)} — ${summary}`
  );
}

async function isKnownInstallRoot(root: string, home: string): Promise<boolean> {
  const resolved = await Promise.all(
    candidateRoots(home).map((candidate) => realpath(candidate.path).catch(() => null)),
  );
  return resolved.some((path) => path === root);
}

export async function assertInstalledRuntimeFresh(
  executingRuntime: string,
  home: string = homedir(),
): Promise<RuntimeFreshnessReport | null> {
  let reference: ValidatedSkillSource;
  try {
    reference = await validateSkillSource(resolve(executingRuntime, ".."));
  } catch {
    return null;
  }
  if (!(await isKnownInstallRoot(reference.root, home))) return null;
  const report = await installedRuntimeFreshness(reference, home);
  if (report.drifted) {
    throw new HarnessError("INTEGRITY", describeReport(report), freshnessFindings(report));
  }
  return report;
}
