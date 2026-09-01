import { RawValuePolicyValidator, validateZeroRawValues } from "./raw-value-validator.ts";
import { TokenComplianceImmunity } from "./immunity-defense.ts";
import { CompositionalDialecticEngine } from "./compositional-dialectic.ts";
import { TokenEvolutionManager } from "./evolution-manager.ts";
export class TokenAuthorityEngine {
  public readonly policyValidator: RawValuePolicyValidator;
  public readonly immunity: TokenComplianceImmunity;
  public readonly dialectic: CompositionalDialecticEngine;
  public readonly evolution: TokenEvolutionManager;

  public constructor(options?: {
    policyValidator?: RawValuePolicyValidator;
    immunity?: TokenComplianceImmunity;
    dialectic?: CompositionalDialecticEngine;
    evolution?: TokenEvolutionManager;
  }) {
    this.policyValidator = options?.policyValidator ?? new RawValuePolicyValidator();
    this.immunity = options?.immunity ?? new TokenComplianceImmunity();
    this.dialectic = options?.dialectic ?? new CompositionalDialecticEngine();
    this.evolution = options?.evolution ?? new TokenEvolutionManager();
  }
}

let defaultTokenAuthorityEngine: TokenAuthorityEngine | null = null;

export function getDefaultTokenAuthorityEngine(): TokenAuthorityEngine {
  if (!defaultTokenAuthorityEngine) {
    defaultTokenAuthorityEngine = new TokenAuthorityEngine();
  }
  return defaultTokenAuthorityEngine;
}

export function setDefaultTokenAuthorityEngine(engine: TokenAuthorityEngine): void {
  defaultTokenAuthorityEngine = engine;
}

export function resetDefaultTokenAuthorityEngine(): void {
  defaultTokenAuthorityEngine = null;
}
