import { HarnessError } from "../../../core/errors/index.ts";
import {
  getGlobalRoleRegistry,
  synthesizeDynamicRole,
  type DynamicRoleRegistry,
} from "../../roles/dynamic/index.ts";
import { computePersonaSignature, findSimilarPersonas } from "./similarity.ts";
import type {
  NonDuplicateRoleSynthesisResult,
  SynthesizeNonDuplicateRoleOptions,
} from "./types.ts";

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

  if (reg.has(options.name)) {
    const existing = reg.get(options.name);
    if (existing && existing.sha256 === targetContract.sha256) {
      return {
        contract: existing,
        action: "reused_existing",
        deduplicated: true,
        signature: targetSignature,
        duplicateOfRole: existing.role,
        message: `Role '${options.name}' already registered with identical content. Reused existing contract.`,
      };
    }
    if (!autoDisambiguate) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Role name '${options.name}' already exists in registry with different specification.`,
      );
    }
    let version = 2;
    let disambiguatedName = `${options.name}-v${version}`;
    while (reg.has(disambiguatedName)) {
      version++;
      disambiguatedName = `${options.name}-v${version}`;
    }
    const disambiguatedContract = synthesizeDynamicRole({ ...options, name: disambiguatedName });
    if (registry) registry.register(disambiguatedContract);
    return {
      contract: disambiguatedContract,
      action: "synthesized_disambiguated",
      deduplicated: false,
      signature: computePersonaSignature(disambiguatedContract),
      disambiguatedFrom: options.name,
      duplicateOfRole: options.name,
      message: `Name collision resolved by generating unique persona '${disambiguatedName}'.`,
    };
  }

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
          message: `Identical persona signature found for role '${existing.role}'. Reused existing contract.`,
        };
      }
    }
  }

  const existingRoles = reg.list();
  const similarRoles = findSimilarPersonas(targetContract, existingRoles, threshold);

  if (allowReuse && similarRoles.length > 0) {
    const mostSimilar = similarRoles[0];
    if (mostSimilar) {
      const existingRole = reg.get(mostSimilar.roleB);
      if (existingRole) {
        return {
          contract: existingRole,
          action: "reused_existing",
          deduplicated: true,
          signature: computePersonaSignature(existingRole),
          duplicateOfRole: existingRole.role,
          message: `High similarity persona found for '${existingRole.role}'. Reused existing contract.`,
        };
      }
    }
  }

  if (registry) registry.register(targetContract);

  return {
    contract: targetContract,
    action: "synthesized_new",
    deduplicated: false,
    signature: targetSignature,
    message: `Synthesized new unique dynamic persona '${targetContract.role}'.`,
  };
}
