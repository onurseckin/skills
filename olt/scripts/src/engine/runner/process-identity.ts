import { HarnessError } from "../../errors/harness-error.ts";
import { darwinProcessIdentity } from "./darwin-pipes.ts";
import { linuxProcessIdentity } from "./linux-pipes.ts";

export interface ProcessTopology {
  pid: number;
  parent: number;
  group: number;
}

export interface ProcessIdentity extends ProcessTopology {
  birth: string;
}

export function readProcessIdentity(
  pid: number,
  platform: string = process.platform,
): ProcessIdentity | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  if (platform === "darwin") return darwinProcessIdentity(pid);
  if (platform === "linux") return linuxProcessIdentity(pid);
  throw new HarnessError("UNSUPPORTED_PLATFORM", "strong process identity is unavailable");
}

export function sameProcessIdentity(
  left: ProcessIdentity | undefined,
  right: ProcessIdentity | undefined,
): boolean {
  return Boolean(left && right && left.pid === right.pid && left.birth === right.birth);
}
