import type { BunCompatibility } from "../../contracts/capsule.ts";

export const BUN_COMPATIBILITY: BunCompatibility = "same-major-not-older";

function version(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compatibleBunVersion(creator: string, actual: string, policy: unknown): boolean {
  if (policy !== BUN_COMPATIBILITY) return false;
  const created = version(creator);
  const running = version(actual);
  if (!created || !running || created[0] !== running[0]) return false;
  for (let index = 1; index < created.length; index += 1) {
    if (running[index]! !== created[index]!) return running[index]! > created[index]!;
  }
  return true;
}
