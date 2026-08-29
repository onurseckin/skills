import { normalize, resolve } from "node:path";
import type { SandboxPolicyConfig } from "./types.ts";

export const DANGEROUS_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "sudo",
  "su",
  "doas",
  "chown",
  "chmod",
  "mkfs",
  "dd",
  "fdisk",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init",
]);

const SECRET_ENV_REGEX = /(?:SECRET|TOKEN|PASSWORD|API_KEY|AUTH_KEY|PRIVATE_KEY)/i;

export function isPathAllowed(
  targetPath: string,
  policy: SandboxPolicyConfig,
  isWrite = false,
): boolean {
  const normalized = normalize(resolve(targetPath));
  const blockedDirs = policy.blockedDirectories ?? [];
  const readOnlyDirs = policy.readOnlyDirectories ?? [];
  const allowedDirs = policy.allowedDirectories ?? [];

  for (const blocked of blockedDirs) {
    const normalizedBlocked = normalize(resolve(blocked));
    if (normalized === normalizedBlocked || normalized.startsWith(normalizedBlocked + "/")) {
      return false;
    }
  }

  if (isWrite) {
    for (const ro of readOnlyDirs) {
      const normalizedRo = normalize(resolve(ro));
      if (
        normalizedRo === "/" ||
        normalized === normalizedRo ||
        normalized.startsWith(normalizedRo + "/")
      ) {
        return false;
      }
    }
  }

  if (allowedDirs.length > 0) {
    const isInsideAllowed = allowedDirs.some((allowed) => {
      const normalizedAllowed = normalize(resolve(allowed));
      return normalized === normalizedAllowed || normalized.startsWith(normalizedAllowed + "/");
    });
    if (!isInsideAllowed) return false;
  }

  return true;
}

export function assertPathWithinBoundaries(
  targetPath: string,
  policy: SandboxPolicyConfig,
  isWrite = false,
): void {
  if (!isPathAllowed(targetPath, policy, isWrite)) {
    throw new Error(
      `Filesystem access violation: path '${targetPath}' is restricted under ${policy.isolationLevel} isolation policy (write=${isWrite})`,
    );
  }
}

export function sanitizeEnvironmentVariables(
  rawEnv: Record<string, string | undefined>,
  policy: SandboxPolicyConfig,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const allowedKeys = policy.allowedEnvironmentKeys ?? [];
  const blockedKeys = policy.blockedEnvironmentKeys ?? [];
  const hasAllowedKeys = allowedKeys.length > 0;
  const allowedSet = new Set(allowedKeys);
  const blockedSet = new Set(blockedKeys);

  for (const [key, value] of Object.entries(rawEnv)) {
    if (value === undefined) continue;
    if (blockedSet.has(key)) continue;

    if (hasAllowedKeys) {
      if (allowedSet.has(key)) {
        sanitized[key] = value;
      }
    } else {
      if (SECRET_ENV_REGEX.test(key) && !allowedSet.has(key)) {
        continue;
      }
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function isCommandSafe(
  command: string,
  args: readonly string[],
  policy: SandboxPolicyConfig,
): boolean {
  if (!policy.allowSubprocess) return false;

  const baseCommand = command.trim().split(/[/\\]/).pop() ?? command.trim();
  if (DANGEROUS_COMMAND_NAMES.has(baseCommand.toLowerCase())) {
    return false;
  }

  if (baseCommand === "rm" && args.some((a) => a === "-rf" || a === "-fr" || a === "-r")) {
    if (args.some((a) => a === "/" || a === "/*" || a === "~" || a === "/root")) {
      return false;
    }
  }

  return true;
}
