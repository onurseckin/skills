import { createHash } from "node:crypto";
import type { DynamicRoleContract, DynamicRoleSpec } from "../../roles/dynamic/types.ts";
import type { PersonaSignature, PersonaSimilarityMetrics } from "./types.ts";

export function getRoleName(role: DynamicRoleContract | DynamicRoleSpec): string {
  if ("role" in role && typeof role.role === "string") {
    return role.role;
  }
  if ("spec" in role && role.spec && typeof role.spec.name === "string") {
    return role.spec.name;
  }
  if ("name" in role && typeof role.name === "string") {
    return role.name;
  }
  return "";
}

export function computePersonaSignature(
  contractOrSpec: DynamicRoleContract | DynamicRoleSpec,
): PersonaSignature {
  const spec: DynamicRoleSpec = "spec" in contractOrSpec ? contractOrSpec.spec : contractOrSpec;
  const roleName = getRoleName(contractOrSpec);
  const sortedCmds = [...(spec.grantedCommands ?? [])].sort();
  const sortedInvariants = [...(spec.invariants ?? [])].sort();
  const sortedPillars = [...(spec.cognitivePillars ?? [])].sort();

  const commandsSig = sortedCmds.join(",");
  const invariantsHash = createHash("sha256")
    .update(sortedInvariants.join("\n"))
    .digest("hex")
    .slice(0, 16);
  const pillarsHash = createHash("sha256")
    .update(sortedPillars.join("\n"))
    .digest("hex")
    .slice(0, 16);
  const policy = spec.writeScopePolicy ?? "lease_bounded";

  const fullSigData = `${roleName}|${spec.tier}|${spec.domain ?? ""}|${spec.archetype}|${commandsSig}|${policy}|${invariantsHash}|${pillarsHash}`;
  const signatureHash = createHash("sha256").update(fullSigData).digest("hex");

  return {
    role: roleName,
    tier: spec.tier,
    domain: spec.domain,
    archetype: spec.archetype,
    commandsSignature: commandsSig,
    writeScopePolicy: policy,
    invariantsHash,
    signatureHash,
  };
}

function calculateJaccardSimilarity(setA: ReadonlySet<string>, setB: ReadonlySet<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

export function calculatePersonaSimilarity(
  roleA: DynamicRoleContract | DynamicRoleSpec,
  roleB: DynamicRoleContract | DynamicRoleSpec,
): PersonaSimilarityMetrics {
  const specA: DynamicRoleSpec = "spec" in roleA ? roleA.spec : roleA;
  const specB: DynamicRoleSpec = "spec" in roleB ? roleB.spec : roleB;

  const cmdsA = new Set(specA.grantedCommands ?? []);
  const cmdsB = new Set(specB.grantedCommands ?? []);
  const commandsJaccard = calculateJaccardSimilarity(cmdsA, cmdsB);
  let sharedCommandsCount = 0;
  for (const cmd of cmdsA) {
    if (cmdsB.has(cmd)) sharedCommandsCount++;
  }

  const invA = new Set(specA.invariants ?? []);
  const invB = new Set(specB.invariants ?? []);
  const invariantsJaccard = calculateJaccardSimilarity(invA, invB);

  const pilA = new Set(specA.cognitivePillars ?? []);
  const pilB = new Set(specB.cognitivePillars ?? []);
  const pillarsJaccard = calculateJaccardSimilarity(pilA, pilB);
  let sharedPillarsCount = 0;
  for (const p of pilA) {
    if (pilB.has(p)) sharedPillarsCount++;
  }

  let score = commandsJaccard * 0.4 + invariantsJaccard * 0.3 + pillarsJaccard * 0.3;
  const sameArchetype = specA.archetype === specB.archetype;
  const sameDomain = (specA.domain ?? "") === (specB.domain ?? "");
  const policyA = specA.writeScopePolicy ?? "lease_bounded";
  const policyB = specB.writeScopePolicy ?? "lease_bounded";
  const sameWritePolicy = policyA === policyB;

  if (!sameArchetype) score *= 0.5;
  if (specA.tier !== specB.tier) score *= 0.5;
  if (!sameDomain) score *= 0.8;

  const rounded = Math.round(score * 1000) / 1000;
  const exactMatch = rounded >= 0.999 && sameArchetype && specA.tier === specB.tier && sameDomain;

  return {
    roleA: getRoleName(roleA),
    roleB: getRoleName(roleB),
    commandsJaccard,
    invariantsJaccard,
    pillarsJaccard,
    similarityScore: rounded,
    exactMatch,
    sameArchetype,
    sameDomain,
    sameWritePolicy,
    sharedCommandsCount,
    sharedPillarsCount,
  };
}

export function findSimilarPersonas(
  target: DynamicRoleContract | DynamicRoleSpec,
  catalog: readonly (DynamicRoleContract | DynamicRoleSpec)[],
  threshold = 0.8,
): readonly PersonaSimilarityMetrics[] {
  const results: PersonaSimilarityMetrics[] = [];
  const targetName = String(getRoleName(target));
  for (const existing of catalog) {
    const existingName = String(getRoleName(existing));
    if (targetName === existingName) continue;
    const metric = calculatePersonaSimilarity(target, existing);
    if (metric.similarityScore >= threshold) {
      results.push(metric);
    }
  }
  return results.sort((a, b) => b.similarityScore - a.similarityScore);
}
