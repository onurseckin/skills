export const DEFECT_ID = "defect-cli-1788679945241-w2ehap";
export const ERROR_CODE = "ROLE_CONFINEMENT_VIOLATION";
export const DEFECT_TITLE =
  "Defect Remediation: role validator may not invoke execution tool category 'test-runner': agent validator_cadence is a cognitive validator, and shell/execution tools belong exclusively to mechanic validators. [Remediation: Cognitive validators must not execute shell commands or tests directly. Delegate test execution to a mechanic-validator subagent or inspect files using read-only tools.]";

export interface ValidatorConfinementContext {
  readonly actor: string;
  readonly role: string;
  readonly toolCategory: string;
  readonly validatorSubtype: "cognitive" | "mechanic";
  readonly delegatedTarget?: string;
}

export interface ValidatorConfinementResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
  readonly remediationAction: string;
}

const EXECUTION_CATEGORIES: readonly string[] = ["test-runner", "shell", "execution"];

export function isExecutionToolCategory(toolCategory: string): boolean {
  return EXECUTION_CATEGORIES.includes(toolCategory);
}

export function isCognitiveValidator(subtype: string, role: string, actor: string): boolean {
  if (subtype === "cognitive") {
    return true;
  }
  if (role === "validator") {
    if (!actor.includes("mechanic")) {
      return true;
    }
  }
  return false;
}

export function evaluateValidatorConfinement(
  context: ValidatorConfinementContext,
): ValidatorConfinementResult {
  const isExecution = isExecutionToolCategory(context.toolCategory);
  const isCognitive = isCognitiveValidator(context.validatorSubtype, context.role, context.actor);

  if (isExecution && isCognitive) {
    if (context.delegatedTarget !== undefined && context.delegatedTarget.includes("mechanic")) {
      return {
        remediated: true,
        defectId: DEFECT_ID,
        errorCode: ERROR_CODE,
        allowed: true,
        errors: [],
        remediationAction: `Delegated tool '${context.toolCategory}' execution from cognitive validator '${context.actor}' to mechanic validator '${context.delegatedTarget}'.`,
      };
    }
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      allowed: false,
      errors: [DEFECT_TITLE],
      remediationAction:
        "Cognitive validators must not execute shell commands or tests directly. Delegate test execution to a mechanic-validator subagent or inspect files using read-only tools.",
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: true,
    errors: [],
    remediationAction: "Direct execution allowed under validator role confinement rules.",
  };
}

export function delegateValidatorExecution(
  actor: string,
  toolCategory: string,
  mechanicTarget: string,
): ValidatorConfinementResult {
  return evaluateValidatorConfinement({
    actor,
    role: "validator",
    toolCategory,
    validatorSubtype: "cognitive",
    delegatedTarget: mechanicTarget,
  });
}
