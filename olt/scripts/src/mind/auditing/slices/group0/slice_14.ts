import { HarnessError } from "../../../../core/errors/index.ts";
import {
  getGlobalRoleRegistry,
  synthesizeDynamicRole,
  type DynamicRoleRegistry,
} from "../../../dynamic-roles.ts";
import {
  computePersonaSignature,
  calculatePersonaSimilarity,
  findSimilarPersonas,
  type NonDuplicateRoleSynthesisResult,
  type SynthesizeNonDuplicateRoleOptions,
} from "./slice_13.ts";
export function synthesizeNonDuplicatePersona(
  options: SynthesizeNonDuplicateRoleOptions,
  registry?: DynamicRoleRegistry,
): NonDuplicateRoleSynthesisResult {
  const reg = registry ?? getGlobalRoleRegistry();
  const allowReuse = options.allowReuseExisting ?? true;
  const autoDisambiguate = options.autoDisambiguate ?? true;
  const threshold = options.similarityThreshold ?? 0.95;

  const targetContract = synthesizeDynamicRole(options);
  const targetSignature = computePersonaSignature(targetContract);

  // Check for exact matching persona in the registry
  if (allowReuse) {
    for (const existing of reg.list()) {
      const existingSig = computePersonaSignature(existing);
      if (existingSig.signatureHash === targetSignature.signatureHash) {
        return {
          contract: existing,
          action: "reused_existing",
          deduplicated: true,
          signature: existingSig,
          duplicateOfRole: existing.role,
          message: `Identical persona signature found for role '${existing.role}'. Reused existing contract without redundant synthesis.`,
        };
      }
    }
  }

  // Check if role name collides with a different contract
  if (reg.has(options.name)) {
    const existing = reg.get(options.name);
    if (existing && existing.sha256 === targetContract.sha256) {
      return {
        contract: existing,
        action: "reused_existing",
        deduplicated: true,
        signature: targetSignature,
        duplicateOfRole: existing.role,
        message: `Role with identical name '${options.name}' and identical content already registered. Reused existing contract.`,
      };
    }

    if (!autoDisambiguate) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Role name '${options.name}' already exists in registry with different specification. Enable autoDisambiguate or specify a unique name.`,
      );
    }

    // Disambiguate name with sequential or domain-based suffix
    const baseName = options.name;
    let counter = 2;
    let disambiguatedName = `${baseName}-v${counter}`;
    while (reg.has(disambiguatedName)) {
      counter++;
      disambiguatedName = `${baseName}-v${counter}`;
    }

    const disambiguatedOptions: SynthesizeNonDuplicateRoleOptions = {
      ...options,
      name: disambiguatedName,
      version: counter,
      parentRole: options.parentRole ?? baseName,
    };

    const disambiguatedContract = synthesizeDynamicRole(disambiguatedOptions);
    const disambiguatedSig = computePersonaSignature(disambiguatedContract);
    reg.register(disambiguatedContract);

    return {
      contract: disambiguatedContract,
      action: "synthesized_disambiguated",
      deduplicated: false,
      signature: disambiguatedSig,
      disambiguatedFrom: baseName,
      message: `Name collision resolved: Synthesized disambiguated persona '${disambiguatedName}' (version v${counter}) evolved from '${baseName}'.`,
    };
  }

  // Check for high similarity near-duplicate warning
  const similarRoles = findSimilarPersonas(targetContract, reg.list(), threshold);
  reg.register(targetContract);

  if (similarRoles.length > 0) {
    const mostSimilar = similarRoles[0]!;
    return {
      contract: targetContract,
      action: "synthesized_new",
      deduplicated: false,
      signature: targetSignature,
      duplicateOfRole: mostSimilar.roleB,
      message: `Synthesized new persona '${targetContract.role}'. Note: High similarity (${Math.round(mostSimilar.similarityScore * 100)}%) to existing role '${mostSimilar.roleB}'.`,
    };
  }

  return {
    contract: targetContract,
    action: "synthesized_new",
    deduplicated: false,
    signature: targetSignature,
    message: `Synthesized new unique dynamic persona '${targetContract.role}'.`,
  };
}