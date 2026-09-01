import {
  CANONICAL_DEFAULT_PERSONAS,
  CANONICAL_FEATURE_SCOPES,
  CANONICAL_PUBLIC_ROUTES,
  CANONICAL_AUTHENTICATED_ROUTES,
  type ApplicationEndpoints,
  type RunningPortInfo,
  type PersonaDefinition,
  type DeductiveParameters,
} from "./types.ts";

export function resolveEndpoint(pathOrRoute: string, params: DeductiveParameters): string {
  const trimmed = pathOrRoute.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  const cleanBase = params.endpoints.baseUrl.replace(/\/+$/u, "");
  const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${cleanBase}${cleanPath}`;
}

/**
 * Get personas with permission to access a specific feature scope
 */
export function getPersonasForFeature(
  featureName: string,
  params: DeductiveParameters,
): readonly PersonaDefinition[] {
  const scope = params.featureScopes.find(
    (s) => s.name.toLowerCase() === featureName.toLowerCase(),
  );
  if (!scope) {
    // If unknown feature, return admin by default
    const admin = params.personas.admin;
    return admin ? [admin] : [];
  }

  const matching: PersonaDefinition[] = [];
  for (const personaName of scope.accessiblePersonas) {
    const p = params.personas[personaName];
    if (p) {
      matching.push(p);
    }
  }
  return matching;
}

/**
 * Retrieve list of public routes
 */
export function getPublicRoutes(params: DeductiveParameters): readonly string[] {
  return params.endpoints.publicRoutes;
}

/**
 * Retrieve list of authenticated routes
 */
export function getAuthenticatedRoutes(params: DeductiveParameters): readonly string[] {
  return params.endpoints.authenticatedRoutes;
}

/**
 * Get standard canonical default parameters
 */
export function getDefaultParameters(baseUrl = "http://localhost:3000"): DeductiveParameters {
  const url = new URL(baseUrl);
  const port = url.port ? parseInt(url.port, 10) : 3000;
  const host = url.hostname || "localhost";
  const protocol = (url.protocol === "https:" ? "https" : "http") as "http" | "https";

  const endpoints: ApplicationEndpoints = {
    baseUrl,
    host,
    port,
    healthEndpoint: `${baseUrl}/api/health`,
    readyTimeoutMs: 30000,
    loginUrl: `${baseUrl}/login`,
    logoutUrl: `${baseUrl}/logout`,
    signupUrl: `${baseUrl}/signup`,
    sessionVerifyUrl: `${baseUrl}/api/auth/me`,
    publicRoutes: CANONICAL_PUBLIC_ROUTES,
    authenticatedRoutes: CANONICAL_AUTHENTICATED_ROUTES,
    apiBaseUrl: `${baseUrl}/api`,
  };

  const portInfo: RunningPortInfo = {
    port,
    host,
    protocol,
    containerName: "app-web-test",
    composeFile: "docker-compose.test.yml",
    healthEndpoint: `${baseUrl}/api/health`,
  };

  return {
    endpoints,
    portInfo,
    personas: { ...CANONICAL_DEFAULT_PERSONAS },
    featureScopes: CANONICAL_FEATURE_SCOPES,
    provenance: "canonical_default",
    extractedAt: new Date().toISOString(),
  };
}
