import {
  ABSTRACT_PROFILES,
  ROLE_PROFILE_MAP,
  resolveAgentProfile,
  resolveProfile,
  type AbstractProfile,
} from "../../roles/index.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export function roleProfileCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const role = textFlag(flags, "role", false);
  const profile = textFlag(flags, "profile", false);
  const rawHost = textFlag(flags, "host", false);
  const host = rawHost !== undefined ? rawHost : "local";

  if (role !== undefined) {
    const resolution = resolveAgentProfile(role, host);
    return {
      role,
      profile: resolution.profile,
      supportedOnHost: resolution.supportedOnHost,
      limitation: resolution.limitation,
      resolution,
    };
  }

  if (profile !== undefined) {
    const resolved = resolveProfile(profile as AbstractProfile);
    return {
      profile,
      resolved,
      bound: resolved.bound,
      model: resolved.model,
      model_tier: resolved.model_tier,
      thinking_level: resolved.thinking_level,
    };
  }

  return {
    abstractProfiles: ABSTRACT_PROFILES,
    roleProfileMap: ROLE_PROFILE_MAP,
  };
}

export async function executeRoleProfile(argv: readonly string[]): Promise<number> {
  const result = roleProfileCommand({});
  process.stdout.write(JSON.stringify(result) + "\n");
  return 0;
}
