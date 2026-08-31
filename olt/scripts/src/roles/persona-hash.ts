import { createHash } from "node:crypto";
import type {
  PersonaIntegrityReport,
  PersonaSignatureDigest,
  PersonaSignatureInput,
  RoleExecutionTier,
} from "./types.ts";

function sortedUnique(items: readonly string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

export function canonicalizePersonaInput(input: PersonaSignatureInput): string {
  const normalized = {
    name: input.name.trim(),
    role: input.role.trim(),
    tier: input.tier,
    domain: input.domain?.trim() ?? "",
    writeToolsEnabled: input.writeToolsEnabled ?? false,
    subagentToolsEnabled: input.subagentToolsEnabled ?? false,
    may: sortedUnique(input.may.map((s) => s.trim())),
    mustNot: sortedUnique(input.mustNot.map((s) => s.trim())),
    commands: sortedUnique(input.commands.map((s) => s.trim())),
    spawns: sortedUnique(input.spawns.map((s) => s.trim())),
    invariants: sortedUnique(input.invariants.map((s) => s.trim())),
  };

  return JSON.stringify(normalized, Object.keys(normalized).sort());
}

export function computePersonaSignatureHash(input: PersonaSignatureInput): PersonaSignatureDigest {
  const canonicalJson = canonicalizePersonaInput(input);
  const signatureHash = createHash("sha256").update(canonicalJson).digest("hex");

  return {
    role: input.role,
    tier: input.tier,
    canonicalJson,
    signatureHash,
    computedAt: new Date().toISOString(),
  };
}

export function hashRoleContract(
  role: string,
  tier: RoleExecutionTier,
  may: readonly string[],
  mustNot: readonly string[],
  commands: readonly string[],
  spawns: readonly string[],
  invariants: readonly string[] = [],
): string {
  return computePersonaSignatureHash({
    name: role,
    role,
    tier,
    may,
    mustNot,
    commands,
    spawns,
    invariants,
  }).signatureHash;
}

export function hashManifestSpec(
  name: string,
  role: string,
  tier: RoleExecutionTier,
  may: readonly string[],
  mustNot: readonly string[],
  commands: readonly string[],
  spawns: readonly string[],
  invariants: readonly string[],
  writeToolsEnabled = false,
  subagentToolsEnabled = false,
  domain?: string,
): string {
  return computePersonaSignatureHash({
    name,
    role,
    tier,
    may,
    mustNot,
    commands,
    spawns,
    invariants,
    writeToolsEnabled,
    subagentToolsEnabled,
    domain,
  }).signatureHash;
}

export function verifyPersonaIntegrity(
  input: PersonaSignatureInput,
  expectedHash: string,
): PersonaIntegrityReport {
  const digest = computePersonaSignatureHash(input);
  const matches = digest.signatureHash.toLowerCase() === expectedHash.toLowerCase().trim();
  const mismatches: string[] = [];

  if (!matches) {
    mismatches.push(
      `Hash mismatch for role '${input.role}' (tier ${input.tier}): expected '${expectedHash}', got '${digest.signatureHash}'`,
    );
  }

  return {
    valid: matches,
    role: input.role,
    expectedHash,
    actualHash: digest.signatureHash,
    mismatches,
  };
}
