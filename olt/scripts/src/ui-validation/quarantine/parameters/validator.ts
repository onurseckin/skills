import type { DeductiveParameters, ExtractionValidationResult } from "./types.ts";

export function validateParameters(params: DeductiveParameters): ExtractionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Endpoint checks
  if (
    !params.endpoints.baseUrl.startsWith("http://") &&
    !params.endpoints.baseUrl.startsWith("https://")
  ) {
    errors.push(
      `Invalid baseUrl '${params.endpoints.baseUrl}': must start with http:// or https://`,
    );
  }

  if (params.endpoints.port <= 0 || params.endpoints.port > 65535) {
    errors.push(`Invalid port '${params.endpoints.port}': must be between 1 and 65535`);
  }

  if (!params.endpoints.healthEndpoint.startsWith("http")) {
    errors.push(
      `Invalid healthEndpoint '${params.endpoints.healthEndpoint}': must be a valid HTTP URL`,
    );
  }

  // 2. Persona checks
  if (Object.keys(params.personas).length === 0) {
    errors.push("No personas declared or extracted in parameters");
  } else {
    if (!params.personas.admin) {
      warnings.push("Admin persona is missing from extracted personas");
    }
    if (!params.personas.standard_user) {
      warnings.push("Standard user persona is missing from extracted personas");
    }
    if (!params.personas.guest) {
      warnings.push("Guest persona is missing from extracted personas");
    }
  }

  // 3. Feature scopes
  if (params.featureScopes.length === 0) {
    warnings.push("No feature scopes defined in deductive parameters");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    parameters: params,
  };
}

/**
 * Resolve an absolute URL endpoint for a given route path
 */
