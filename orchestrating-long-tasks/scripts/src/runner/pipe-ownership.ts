import { HarnessError } from "../errors/harness-error.ts";
import { darwinPipeHandles, darwinPipeOwners, darwinTokenOwnerIdentities } from "./darwin-pipes.ts";
import {
  linuxPipeHandles,
  linuxPipeOwners,
  linuxTokenOwnerIdentities,
  OWNERSHIP_ENV,
} from "./linux-pipes.ts";
import type { ProcessIdentity } from "./process-identity.ts";

export { OWNERSHIP_ENV };

export function authenticatedOwnerPids(
  pipeOwners: ReadonlySet<number>,
  tokenOwners: ReadonlySet<number>,
): Set<number> {
  return new Set([...pipeOwners].filter((pid) => tokenOwners.has(pid)));
}

export function runnerPipeHandles(pid = process.pid): Set<bigint> {
  if (process.platform === "darwin") return darwinPipeHandles(pid);
  if (process.platform === "linux") return linuxPipeHandles(pid);
  throw new HarnessError("UNSUPPORTED_PLATFORM", "pipe ownership inspection is unavailable");
}

export function addedPipeHandles(before: ReadonlySet<bigint>): Set<bigint> {
  return new Set([...runnerPipeHandles()].filter((handle) => !before.has(handle)));
}

export function ownedProcessPids(anchors: ReadonlySet<bigint>, token: string): Set<number> {
  if (!token) return new Set();
  if (process.platform === "darwin") {
    const pipeOwners = darwinPipeOwners(anchors);
    return authenticatedOwnerPids(
      pipeOwners,
      new Set(darwinTokenOwnerIdentities(token).map(({ pid }) => pid)),
    );
  }
  if (process.platform === "linux") {
    const pipeOwners = linuxPipeOwners(anchors);
    return authenticatedOwnerPids(
      pipeOwners,
      new Set(linuxTokenOwnerIdentities(token).map(({ pid }) => pid)),
    );
  }
  throw new HarnessError("UNSUPPORTED_PLATFORM", "pipe ownership inspection is unavailable");
}

export function ownershipTokenIdentities(token: string): ProcessIdentity[] {
  if (!token) return [];
  if (process.platform === "darwin") return darwinTokenOwnerIdentities(token);
  if (process.platform === "linux") return linuxTokenOwnerIdentities(token);
  throw new HarnessError("UNSUPPORTED_PLATFORM", "ownership-token inspection is unavailable");
}
