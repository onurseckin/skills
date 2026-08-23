import { lstat, readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { clientLinkPaths } from "./client-links.ts";
import { CLIENT_NAMES, SKILL_NAME } from "./constants.ts";
import { readInstallationManifest } from "./identity.ts";
import { treeDigest } from "./tree-digest.ts";
import { validateSkillSource } from "./source-validation.ts";
import { assertInstallerPlatform } from "./platform.ts";

export interface InstallationStatusOptions {
  platform?: NodeJS.Platform;
}

async function linkIssues(
  home: string,
  destination: string,
  requested: ReadonlySet<string>,
  links: Record<string, string | null>,
): Promise<string[]> {
  const issues: string[] = [];
  const paths = clientLinkPaths(home);
  for (const client of ["claude", "antigravity"] as const) {
    if (!requested.has(client)) continue;
    const path = paths[client];
    const linkStat = await lstat(path).catch(() => null);
    if (!linkStat) {
      links[client] = null;
      issues.push(`${client} link is missing`);
      continue;
    }
    if (!linkStat.isSymbolicLink()) {
      links[client] = null;
      issues.push(`${client} client path is not a symlink`);
      continue;
    }
    const target = await readlink(path);
    links[client] = target;
    if (target !== destination) issues.push(`${client} link has wrong target`);
    const resolvedTarget = isAbsolute(target) ? target : resolve(dirname(path), target);
    if (!(await stat(resolvedTarget).catch(() => null))) issues.push(`${client} link is broken`);
  }
  for (const client of ["codex", "chatgpt"] as const) {
    if (requested.has(client)) links[client] = destination;
  }
  return issues;
}

export async function installationStatus(
  source: string,
  home: string,
  requestedClients?: readonly string[],
  options: InstallationStatusOptions = {},
) {
  assertInstallerPlatform(options.platform);
  const expected = await validateSkillSource(source);
  const homeRoot = await realpath(resolve(home)).catch(() => resolve(home));
  const destination = join(homeRoot, ".agents", "skills", SKILL_NAME);
  const issues: string[] = [];
  const destinationStat = await lstat(destination).catch(() => null);
  const installed = destinationStat?.isDirectory() === true && !destinationStat.isSymbolicLink();
  const manifest = installed ? await readInstallationManifest(destination) : null;
  if (!installed) issues.push("not installed");
  else if (!manifest) issues.push("installation manifest is missing, invalid, or untrusted");
  if (installed) {
    const actual = await treeDigest(destination, new Set(["installation.json"])).catch(
      () => "invalid",
    );
    if (
      actual !== expected.digest ||
      manifest?.source_sha256 !== expected.digest ||
      manifest?.runtime_version !== expected.runtimeVersion
    ) {
      issues.push("installed release has drifted");
    }
  }
  const requested = new Set(requestedClients ?? manifest?.clients ?? []);
  if ([...requested].some((client) => !CLIENT_NAMES.has(client)))
    issues.push("unknown requested client");
  const links: Record<string, string | null> = {};
  issues.push(...(await linkIssues(homeRoot, destination, requested, links)));
  return { installed, drifted: issues.length > 0, destination, links, issues };
}
