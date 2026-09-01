import type { PersonaDefinition } from "../parameters/index.ts";
import type {
  PermissionBoundaryAuditResult,
  PersonaAccessEvaluation,
  PermissionAuditExpectation,
} from "./types.ts";

export function simulatePermissionBoundary(
  targetRouteOrAction: string,
  routeRequiredPermissions: readonly string[],
  personas: readonly PersonaDefinition[],
): PermissionBoundaryAuditResult {
  const evaluations: PersonaAccessEvaluation[] = [];
  const privilegeLeakages: PersonaAccessEvaluation[] = [];
  const falsePositiveRejections: PersonaAccessEvaluation[] = [];

  const isWildcardRequired = routeRequiredPermissions.includes("*");

  for (const persona of personas) {
    const hasWildcard = persona.permissions.includes("*");
    const hasDirectPermission = routeRequiredPermissions.some((perm) =>
      persona.permissions.includes(perm),
    );

    // Determine expected result
    let expectedResult: PermissionAuditExpectation;
    if (persona.role === "guest") {
      if (
        routeRequiredPermissions.includes("public_read") &&
        routeRequiredPermissions.length === 1
      ) {
        expectedResult = "ALLOW";
      } else {
        expectedResult = "DENY_REDIRECT_LOGIN";
      }
    } else if (hasWildcard || (!isWildcardRequired && hasDirectPermission)) {
      if (
        persona.permissions.some((p) => p.endsWith("_read") && !p.endsWith("_write")) &&
        targetRouteOrAction.includes("export")
      ) {
        expectedResult = "READ_ONLY";
      } else {
        expectedResult = "ALLOW";
      }
    } else {
      expectedResult = "DENY_FORBIDDEN";
    }

    // Simulate access outcome
    let actualResult: "ALLOW" | "DENY_FORBIDDEN" | "DENY_REDIRECT_LOGIN" | "READ_ONLY";
    if (persona.role === "guest" && expectedResult === "DENY_REDIRECT_LOGIN") {
      actualResult = "DENY_REDIRECT_LOGIN";
    } else if (hasWildcard || hasDirectPermission) {
      actualResult = expectedResult === "READ_ONLY" ? "READ_ONLY" : "ALLOW";
    } else {
      actualResult = "DENY_FORBIDDEN";
    }

    // Evaluate compliance
    let status: "COMPLIANT" | "PRIVILEGE_LEAKAGE" | "FALSE_POSITIVE_REJECTION" = "COMPLIANT";
    let details = `Access matched expected policy (${expectedResult}).`;

    if (expectedResult !== actualResult) {
      if (
        (expectedResult === "DENY_FORBIDDEN" || expectedResult === "DENY_REDIRECT_LOGIN") &&
        (actualResult === "ALLOW" || actualResult === "READ_ONLY")
      ) {
        status = "PRIVILEGE_LEAKAGE";
        details = `PRIVILEGE LEAKAGE: Persona '${persona.role}' lacks permissions [${routeRequiredPermissions.join(", ")}] but received access.`;
      } else {
        status = "FALSE_POSITIVE_REJECTION";
        details = `FALSE POSITIVE REJECTION: Authorized persona '${persona.role}' with permissions [${persona.permissions.join(", ")}] was denied.`;
      }
    }

    const evaluation: PersonaAccessEvaluation = {
      persona: persona.displayName,
      role: persona.role,
      expectedResult,
      actualResult,
      status,
      details,
    };

    evaluations.push(evaluation);

    if (status === "PRIVILEGE_LEAKAGE") {
      privilegeLeakages.push(evaluation);
    } else if (status === "FALSE_POSITIVE_REJECTION") {
      falsePositiveRejections.push(evaluation);
    }
  }

  const totalEvaluations = evaluations.length;
  const passedCount = totalEvaluations - privilegeLeakages.length - falsePositiveRejections.length;
  const securityScore =
    totalEvaluations > 0 ? Math.round((passedCount / totalEvaluations) * 100) : 100;

  return {
    targetRouteOrAction,
    evaluations,
    compliant: privilegeLeakages.length === 0 && falsePositiveRejections.length === 0,
    privilegeLeakages,
    falsePositiveRejections,
    securityScore,
    timestamp: new Date().toISOString(),
  };
}
