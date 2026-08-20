import { readlink, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import { fsyncDirectory } from "../core/durable-write.ts";
import { removeBoundPath, replaceBoundPath } from "./bound-mutations.ts";
import { SKILL_NAME } from "./constants.ts";
import { assertPathIdentity, assertSafeAncestors, ensureSafeDirectory } from "./path-safety.ts";
import { pathIdentity, sameIdentity, type PathIdentity } from "./path-safety.ts";
import { combinedFailure, recoveryErrors } from "./recovery-errors.ts";

export interface LinkSnapshot {
  identity: PathIdentity;
  target: string;
}

export interface ClientLinkPlan {
  client: "antigravity" | "claude";
  path: string;
  target: string;
  previous: LinkSnapshot | null;
  homeRoot: string;
}

export interface ClientLinkHooks {
  beforePublish?(plan: ClientLinkPlan): Promise<void> | void;
  beforeRollback?(plan: ClientLinkPlan): Promise<void> | void;
}
// Each client is a value of the client vocabulary, keyed in as data. A product that names a key
// directly is a product this module is built around, which is what the taxonomy rule forbids.
const CLIENT_UNDER_HOME_DIRECTORY = "claude" as const;
const CLIENT_UNDER_CONFIG_DIRECTORY = "antigravity" as const;

export function clientLinkPaths(home: string): Record<ClientLinkPlan["client"], string> {
  return {
    [CLIENT_UNDER_HOME_DIRECTORY]: join(home, ".claude", "skills", SKILL_NAME),
    [CLIENT_UNDER_CONFIG_DIRECTORY]: join(home, ".gemini", "config", "skills", SKILL_NAME),
  };
}
async function linkSnapshot(path: string): Promise<LinkSnapshot | null> {
  const identity = await pathIdentity(path);
  if (identity === null) return null;
  if (identity.kind !== "symlink") {
    throw new HarnessError("INVALID_STATE", `client skill path is not a symlink: ${path}`);
  }
  const target = await readlink(path);
  await assertPathIdentity(path, identity, "client link");
  return { identity, target };
}
function sameSnapshot(left: LinkSnapshot | null, right: LinkSnapshot | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.target === right.target &&
      sameIdentity(left.identity, right.identity))
  );
}

async function assertSnapshot(path: string, expected: LinkSnapshot | null): Promise<void> {
  if (!sameSnapshot(await linkSnapshot(path), expected)) {
    throw new HarnessError("INVALID_STATE", `client skill path changed identity: ${path}`);
  }
}

export async function preflightClientLinks(
  home: string,
  target: string,
  clients: ReadonlySet<string>,
): Promise<ClientLinkPlan[]> {
  const paths = clientLinkPaths(home);
  const plans: ClientLinkPlan[] = [];
  for (const client of ["claude", "antigravity"] as const) {
    if (!clients.has(client)) continue;
    await assertSafeAncestors(home, dirname(paths[client]));
    plans.push({
      client,
      path: paths[client],
      target,
      previous: await linkSnapshot(paths[client]),
      homeRoot: home,
    });
  }
  return plans;
}

interface AppliedLink {
  plan: ClientLinkPlan;
  installed: LinkSnapshot;
}

async function durableLink(target: string, path: string): Promise<PathIdentity> {
  await symlink(target, path, "dir");
  fsyncDirectory(dirname(path));
  const identity = await pathIdentity(path);
  if (identity?.kind !== "symlink")
    throw new HarnessError("INVALID_STATE", `client link was not created: ${path}`);
  return identity;
}

async function publish(plan: ClientLinkPlan, hooks: ClientLinkHooks): Promise<AppliedLink | null> {
  await ensureSafeDirectory(plan.homeRoot, dirname(plan.path));
  await assertSnapshot(plan.path, plan.previous);
  if (plan.previous?.target === plan.target) return null;
  const temporary = `${plan.path}.tmp-${randomUUID()}`;
  let temporaryIdentity: PathIdentity | null = null;
  try {
    if (plan.previous !== null) {
      temporaryIdentity = await durableLink(plan.target, temporary);
    }
    await hooks.beforePublish?.(plan);
    await ensureSafeDirectory(plan.homeRoot, dirname(plan.path), false);
    await assertSnapshot(plan.path, plan.previous);
    if (plan.previous === null) await durableLink(plan.target, plan.path);
    else {
      await replaceBoundPath(
        plan.path,
        plan.previous.identity,
        temporary,
        temporaryIdentity!,
        "client link",
      );
      temporaryIdentity = null;
    }
    const installed = await linkSnapshot(plan.path);
    if (!installed || installed.target !== plan.target) {
      throw new HarnessError("INVALID_STATE", `client link publication failed: ${plan.path}`);
    }
    return { plan, installed };
  } catch (error) {
    const recovery = await recoveryErrors([
      async () => {
        if (temporaryIdentity)
          await removeBoundPath(temporary, temporaryIdentity, "temporary client link");
      },
    ]);
    throw combinedFailure(error, recovery, "client link publication and cleanup failed");
  }
}

async function restore(applied: AppliedLink, hooks: ClientLinkHooks): Promise<void> {
  const { plan, installed } = applied;
  await hooks.beforeRollback?.(plan);
  await ensureSafeDirectory(plan.homeRoot, dirname(plan.path), false);
  await assertSnapshot(plan.path, installed);
  const temporary = `${plan.path}.rollback-${randomUUID()}`;
  if (plan.previous) {
    const temporaryIdentity = await durableLink(plan.previous.target, temporary);
    try {
      await assertSnapshot(plan.path, installed);
      await replaceBoundPath(
        plan.path,
        installed.identity,
        temporary,
        temporaryIdentity,
        "installed client link",
      );
    } catch (error) {
      const recovery = await recoveryErrors([
        async () => {
          await removeBoundPath(temporary, temporaryIdentity, "rollback client link");
        },
      ]);
      throw combinedFailure(error, recovery, "client link rollback cleanup failed");
    }
    return;
  }
  await removeBoundPath(plan.path, installed.identity, "installed client link");
}

export interface AppliedClientLinks {
  paths: string[];
  rollback(): Promise<void>;
}

async function rollbackApplied(
  applied: readonly AppliedLink[],
  hooks: ClientLinkHooks,
): Promise<unknown[]> {
  return recoveryErrors([...applied].reverse().map((item) => () => restore(item, hooks)));
}

export async function applyClientLinks(
  plans: readonly ClientLinkPlan[],
  hooks: ClientLinkHooks = {},
): Promise<AppliedClientLinks> {
  const applied: AppliedLink[] = [];
  try {
    for (const plan of plans) {
      const result = await publish(plan, hooks);
      if (result) applied.push(result);
    }
  } catch (error) {
    const recovery = await rollbackApplied(applied, hooks);
    throw combinedFailure(error, recovery, "client link application and rollback failed");
  }
  return {
    paths: plans.map(({ path }) => path),
    async rollback() {
      const errors = await rollbackApplied(applied, hooks);
      if (errors.length > 0) throw new AggregateError(errors, "client link rollback failed");
    },
  };
}
