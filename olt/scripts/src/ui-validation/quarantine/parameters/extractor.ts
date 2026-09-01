// @ts-nocheck
import {
  CANONICAL_DEFAULT_PERSONAS,
  CANONICAL_FEATURE_SCOPES,
  CANONICAL_PUBLIC_ROUTES,
  CANONICAL_AUTHENTICATED_ROUTES,
  type ApplicationEndpoints,
  type RunningPortInfo,
  type PersonaDefinition,
  type CookieTemplateSpec,
  type DeductiveParameters,
  type ExtractionValidationResult,
  type RepoPolicy,
} from "./types.ts";
import { extractFromWorkspace } from "./workspace-policy.ts";
import { validateParameters } from "./validator.ts";
import {
  resolveEndpoint,
  getPersonasForFeature,
  getPublicRoutes,
  getAuthenticatedRoutes,
  getDefaultParameters,
} from "./helpers.ts";

export class ParameterExtractor {
  public extractFromPolicy(policy: RepoPolicy | Record<string, unknown>): DeductiveParameters {
    const rawPolicy = policy as Record<string, unknown>;
    const dockerEnv = (rawPolicy.docker_environment ?? {}) as Record<string, unknown>;
    const containers = (dockerEnv.containers ?? {}) as Record<string, Record<string, unknown>>;
    const webApp = (containers.web_app ?? containers.web ?? containers.app ?? {}) as Record<
      string,
      unknown
    >;

    // 1. Deducing port and host
    let port = 3000;
    const host = "localhost";
    let protocol: "http" | "https" = "http";
    const declaredHealth = typeof webApp.health_endpoint === "string" ? webApp.health_endpoint : "";
    const rawAuthPaths = (dockerEnv.auth_paths ?? {}) as Record<string, unknown>;
    const declaredLogin = typeof rawAuthPaths.login_url === "string" ? rawAuthPaths.login_url : "";
    if (declaredHealth.startsWith("https://") || declaredLogin.startsWith("https://")) {
      protocol = "https";
    }

    if (Array.isArray(webApp.ports) && webApp.ports.length > 0) {
      const firstPort = String(webApp.ports[0]);
      const match = /(?:(\d+):)?(\d+)/u.exec(firstPort);
      if (match && match[1]) {
        port = parseInt(match[1], 10);
      } else if (match && match[2]) {
        port = parseInt(match[2], 10);
      }
    } else if (typeof webApp.env === "object" && webApp.env !== null) {
      const env = webApp.env as Record<string, string>;
      if (env.PORT) {
        const parsed = parseInt(env.PORT, 10);
        if (!isNaN(parsed) && parsed > 0) {
          port = parsed;
        }
      }
    }

    const baseUrl = `${protocol}://${host}:${port}`;
    const healthEndpoint =
      typeof webApp.health_endpoint === "string" && webApp.health_endpoint.length > 0
        ? webApp.health_endpoint
        : `${baseUrl}/api/health`;

    const readyTimeoutMs =
      typeof webApp.ready_timeout_ms === "number" && webApp.ready_timeout_ms > 0
        ? webApp.ready_timeout_ms
        : 30000;

    // 2. Deducing auth paths
    const authPaths = rawAuthPaths;
    const loginUrl =
      typeof authPaths.login_url === "string" && authPaths.login_url.length > 0
        ? authPaths.login_url
        : `${baseUrl}/login`;

    const logoutUrl =
      typeof authPaths.logout_url === "string" && authPaths.logout_url.length > 0
        ? authPaths.logout_url
        : `${baseUrl}/logout`;

    const signupUrl =
      typeof authPaths.signup_url === "string" && authPaths.signup_url.length > 0
        ? authPaths.signup_url
        : `${baseUrl}/signup`;

    const sessionVerifyUrl =
      typeof authPaths.session_verify_url === "string" && authPaths.session_verify_url.length > 0
        ? authPaths.session_verify_url
        : `${baseUrl}/api/auth/me`;

    // 3. Cookie templates
    const rawTemplates = (dockerEnv.session_cookie_templates ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const defaultTemplate: CookieTemplateSpec = {
      name: "olt_session_id",
      domain: host,
      path: "/",
      httpOnly: true,
      secure: protocol === "https",
      sameSite: "Lax",
    };

    let sessionCookieTemplate = defaultTemplate;
    const firstTemplateKey = Object.keys(rawTemplates)[0];
    if (firstTemplateKey) {
      const t = rawTemplates[firstTemplateKey];
      if (t) {
        sessionCookieTemplate = {
          name: typeof t.name === "string" ? t.name : defaultTemplate.name,
          domain: typeof t.domain === "string" ? t.domain : defaultTemplate.domain,
          path: typeof t.path === "string" ? t.path : defaultTemplate.path,
          httpOnly: typeof t.http_only === "boolean" ? t.http_only : defaultTemplate.httpOnly,
          secure: typeof t.secure === "boolean" ? t.secure : defaultTemplate.secure,
          sameSite:
            t.same_site === "Strict" || t.same_site === "Lax" || t.same_site === "None"
              ? t.same_site
              : defaultTemplate.sameSite,
        };
      }
    }

    // 4. Personas extraction
    const rawPersonas = (dockerEnv.test_user_personas ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const personas: Record<string, PersonaDefinition> = {};

    for (const [key, p] of Object.entries(rawPersonas)) {
      if (typeof p === "object" && p !== null) {
        const role = typeof p.role === "string" ? p.role : key;
        const email = typeof p.email === "string" ? p.email : `${role}@olt.local`;
        const passwordEnvVar =
          typeof p.password_env_var === "string"
            ? p.password_env_var
            : `OLT_TEST_${role.toUpperCase()}_PASSWORD`;
        const displayName = typeof p.display_name === "string" ? p.display_name : `Test ${role}`;
        const tenantId = typeof p.tenant_id === "string" ? p.tenant_id : "tenant-corp-001";
        const permissions = Array.isArray(p.permissions)
          ? p.permissions.map(String)
          : role === "admin"
            ? ["*"]
            : ["read"];
        const mockSessionCookie =
          typeof p.mock_session_cookie === "string" ? p.mock_session_cookie : undefined;

        personas[key] = {
          role,
          email,
          passwordEnvVar,
          displayName,
          tenantId,
          permissions,
          ...(mockSessionCookie !== undefined ? { mockSessionCookie } : {}),
          cookieTemplate: sessionCookieTemplate,
        };
      }
    }

    // Ensure all canonical personas are present by augmenting fallbacks
    for (const [key, canonicalPersona] of Object.entries(CANONICAL_DEFAULT_PERSONAS)) {
      if (!personas[key]) {
        personas[key] = {
          ...canonicalPersona,
          cookieTemplate: sessionCookieTemplate,
        };
      }
    }

    // 5. Build PortInfo
    const portInfo: RunningPortInfo = {
      port,
      host,
      protocol,
      ...(typeof webApp.container_name === "string"
        ? { containerName: webApp.container_name }
        : {}),
      ...(typeof dockerEnv.compose_file === "string"
        ? { composeFile: dockerEnv.compose_file }
        : {}),
      healthEndpoint,
    };

    // 6. Build Endpoints
    const endpoints: ApplicationEndpoints = {
      baseUrl,
      host,
      port,
      healthEndpoint,
      readyTimeoutMs,
      loginUrl,
      logoutUrl,
      signupUrl,
      sessionVerifyUrl,
      publicRoutes: CANONICAL_PUBLIC_ROUTES,
      authenticatedRoutes: CANONICAL_AUTHENTICATED_ROUTES,
      apiBaseUrl: `${baseUrl}/api`,
    };

    const provenance =
      rawPolicy.provenance === "explicit_custom" || rawPolicy.provenance === "explicit_policy"
        ? "explicit_policy"
        : rawPolicy.provenance === "auto_detected"
          ? "auto_detected"
          : "canonical_default";

    return {
      endpoints,
      portInfo,
      personas,
      featureScopes: CANONICAL_FEATURE_SCOPES,
      provenance,
      extractedAt: new Date().toISOString(),
    };
  }

  /**
   * Extract parameters by discovering workspace policy file directly
   */
  public extractFromWorkspace(
    repoRoot = process.cwd(),
    customPolicyPath?: string,
  ): DeductiveParameters {
    return extractFromWorkspace.call(this, repoRoot, customPolicyPath);
  }

  public validateParameters(params: DeductiveParameters): ExtractionValidationResult {
    return validateParameters(params);
  }

  public resolveEndpoint(pathOrRoute: string, params: DeductiveParameters): string {
    return resolveEndpoint(pathOrRoute, params);
  }

  public getPersonasForFeature(
    featureName: string,
    params: DeductiveParameters,
  ): readonly PersonaDefinition[] {
    return getPersonasForFeature(featureName, params);
  }

  public getPublicRoutes(params: DeductiveParameters): readonly string[] {
    return getPublicRoutes(params);
  }

  public getAuthenticatedRoutes(params: DeductiveParameters): readonly string[] {
    return getAuthenticatedRoutes(params);
  }

  public getDefaultParameters(baseUrl = "http://localhost:3000"): DeductiveParameters {
    return getDefaultParameters(baseUrl);
  }
}

let defaultParameterExtractor: ParameterExtractor | null = null;

export function getDefaultParameterExtractor(): ParameterExtractor {
  if (!defaultParameterExtractor) {
    defaultParameterExtractor = new ParameterExtractor();
  }
  return defaultParameterExtractor;
}

export function setDefaultParameterExtractor(extractor: ParameterExtractor): void {
  defaultParameterExtractor = extractor;
}

export function resetDefaultParameterExtractor(): void {
  defaultParameterExtractor = null;
}
