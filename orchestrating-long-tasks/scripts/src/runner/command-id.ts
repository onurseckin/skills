import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

export function commandId(): string {
  return `C-${randomUUID()}`;
}

export function canonicalCommandFingerprint(cwd: string, argv: readonly string[]): string {
  const identity = JSON.stringify({ argv: [...argv], cwd: resolve(cwd) });
  return createHash("sha256").update(identity).digest("hex");
}

export const commandFingerprint = canonicalCommandFingerprint;
