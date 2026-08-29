import { HarnessError } from "../../../core/errors/index.ts";
import {
  darwinPipeHandles,
  darwinPipeOwners,
  darwinTokenOwnerIdentities,
} from "../process/darwin/darwin-pipes.ts";
import {
  linuxPipeHandles,
  linuxPipeOwners,
  linuxTokenOwnerIdentities,
  OWNERSHIP_ENV,
} from "../process/linux-pipes.ts";
import type { ProcessIdentity } from "../process/process-identity.ts";

export { OWNERSHIP_ENV };

export function authenticatedOwnerPids(
  pipeOwners: ReadonlySet<number>,
  tokenOwners: ReadonlySet<number>,
): Set<number> {
  return new Set([...pipeOwners].filter((pid) => tokenOwners.has(pid)));
}

export function runnerPipeHandles(
  pid = process.pid,
  platform: string = process.platform,
): Set<bigint> {
  if (platform === "darwin") return darwinPipeHandles(pid);
  if (platform === "linux") return linuxPipeHandles(pid);
  throw new HarnessError("UNSUPPORTED_PLATFORM", "pipe ownership inspection is unavailable");
}

export function addedPipeHandles(before: ReadonlySet<bigint>): Set<bigint> {
  return new Set([...runnerPipeHandles()].filter((handle) => !before.has(handle)));
}

export function ownedProcessPids(
  anchors: ReadonlySet<bigint>,
  token: string,
  platform: string = process.platform,
): Set<number> {
  if (!token) return new Set();
  if (platform === "darwin") {
    const pipeOwners = darwinPipeOwners(anchors);
    return authenticatedOwnerPids(
      pipeOwners,
      new Set(darwinTokenOwnerIdentities(token).map(({ pid }) => pid)),
    );
  }
  if (platform === "linux") {
    const pipeOwners = linuxPipeOwners(anchors);
    return authenticatedOwnerPids(
      pipeOwners,
      new Set(linuxTokenOwnerIdentities(token).map(({ pid }) => pid)),
    );
  }
  throw new HarnessError("UNSUPPORTED_PLATFORM", "pipe ownership inspection is unavailable");
}

export function ownershipTokenIdentities(
  token: string,
  platform: string = process.platform,
): ProcessIdentity[] {
  if (!token) return [];
  if (platform === "darwin") return darwinTokenOwnerIdentities(token);
  if (platform === "linux") return linuxTokenOwnerIdentities(token);
  throw new HarnessError("UNSUPPORTED_PLATFORM", "ownership-token inspection is unavailable");
}
