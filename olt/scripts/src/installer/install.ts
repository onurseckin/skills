import { join } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import {
  applyClientLinks,
  preflightClientLinks,
  type AppliedClientLinks,
  type ClientLinkHooks,
} from "./client-links.ts";
import { CLIENT_NAMES, INSTALL_SCHEMA, INSTALL_VERSION, SKILL_NAME } from "./constants.ts";
import { validatedHome } from "./install-roots.ts";
import { ensureSafeDirectory } from "./path-safety.ts";
import { assertInstallerPlatform } from "./platform.ts";
import { combinedFailure, recoveryErrors } from "./recovery-errors.ts";
import { prepareReleaseCopy, type ReleaseCopyHooks } from "./release-copy.ts";
import { validateSkillSource } from "./source-validation.ts";

export interface InstallOptions {
  platform?: NodeJS.Platform;
  linkHooks?: ClientLinkHooks;
  releaseHooks?: ReleaseCopyHooks;
}

export async function installSkill(
  source: string,
  home: string,
  clientNames: readonly string[],
  options: InstallOptions = {},
) {
  assertInstallerPlatform(options.platform);
  const clients = new Set(clientNames);
  if ([...clients].some((client) => !CLIENT_NAMES.has(client))) {
    throw new HarnessError("INVALID_ARGUMENT", "unknown client");
  }
  const validated = await validateSkillSource(source);
  const homeRoot = await validatedHome(validated.root, home);
  const destination = join(homeRoot, ".agents", "skills", SKILL_NAME);
  await ensureSafeDirectory(homeRoot, join(homeRoot, ".agents", "skills"));
  const linkPlans = await preflightClientLinks(homeRoot, destination, clients);
  const manifest = {
    schema: INSTALL_SCHEMA,
    version: INSTALL_VERSION,
    skill_name: SKILL_NAME,
    runtime_version: validated.runtimeVersion,
    source_sha256: validated.digest,
    installed_at: new Date().toISOString(),
    clients: [...clients].sort(),
  };
  const release = await prepareReleaseCopy(validated.root, destination, manifest, {
    containmentRoot: homeRoot,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.releaseHooks === undefined ? {} : { hooks: options.releaseHooks }),
  });
  let applied: AppliedClientLinks | undefined;
  let failure: unknown;
  let result: { destination: string; digest: string; links: string[] } | undefined;
  try {
    await release.commit();
    applied = await applyClientLinks(linkPlans, options.linkHooks);
    await release.finalize();
    result = { destination, digest: validated.digest, links: applied.paths };
  } catch (error) {
    failure = combinedFailure(
      error,
      await recoveryErrors([async () => applied?.rollback(), () => release.rollback()]),
      "installation and rollback failed",
    );
  }
  const cleanup = await recoveryErrors([() => release.cleanup()]);
  if (failure !== undefined) throw combinedFailure(failure, cleanup, "installation cleanup failed");
  if (cleanup.length > 0) throw new AggregateError(cleanup, "installation cleanup failed");
  return result!;
}
