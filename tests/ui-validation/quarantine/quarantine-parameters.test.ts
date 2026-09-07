import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  CANONICAL_AUTHENTICATED_ROUTES,
  CANONICAL_PUBLIC_ROUTES,
  ParameterExtractor,
  resetDefaultParameterExtractor,
} from "../fixtures.ts";

describe("Parameter Extractor - Configuration & Routing", () => {
  beforeEach(() => {
    resetDefaultParameterExtractor();
  });

  afterEach(() => {
    resetDefaultParameterExtractor();
  });

  describe("Policy Configuration & Endpoint Extraction", () => {
    it("extracts parameters from canonical default policy configuration", () => {
      const extractor = new ParameterExtractor();
      const defaultParams = extractor.getDefaultParameters("http://localhost:3000");

      expect(defaultParams.endpoints.baseUrl).toBe("http://localhost:3000");
      expect(defaultParams.endpoints.port).toBe(3000);
      expect(defaultParams.endpoints.healthEndpoint).toBe("http://localhost:3000/api/health");
      expect(defaultParams.endpoints.loginUrl).toBe("http://localhost:3000/login");
      expect(defaultParams.endpoints.sessionVerifyUrl).toBe("http://localhost:3000/api/auth/me");
      expect(defaultParams.endpoints.publicRoutes).toEqual(CANONICAL_PUBLIC_ROUTES);
      expect(defaultParams.endpoints.authenticatedRoutes).toEqual(CANONICAL_AUTHENTICATED_ROUTES);

      expect(defaultParams.personas.admin).toBeDefined();
      expect(defaultParams.personas.admin?.role).toBe("admin");
      expect(defaultParams.personas.admin?.permissions).toContain("*");

      expect(defaultParams.personas.standard_user).toBeDefined();
      expect(defaultParams.personas.standard_user?.role).toBe("standard_user");

      expect(defaultParams.personas.guest).toBeDefined();
      expect(defaultParams.personas.guest?.role).toBe("guest");

      expect(defaultParams.featureScopes.length).toBeGreaterThan(0);
    });

    it("extracts parameters from custom policy structure", () => {
      const extractor = new ParameterExtractor();
      const mockPolicy = {
        schema_version: 1,
        ecosystem: "bun",
        docker_environment: {
          enabled: true,
          compose_file: "docker-compose.custom.yml",
          containers: {
            web_app: {
              container_name: "custom-web-app",
              ports: ["8080:8080"],
              health_endpoint: "http://localhost:8080/healthz",
              ready_timeout_ms: 15000,
            },
          },
          auth_paths: {
            login_url: "http://localhost:8080/auth/signin",
            logout_url: "http://localhost:8080/auth/signout",
            signup_url: "http://localhost:8080/auth/register",
            session_verify_url: "http://localhost:8080/api/session",
          },
          test_user_personas: {
            admin: {
              role: "admin",
              email: "superadmin@custom.local",
              display_name: "Super Administrator",
              tenant_id: "tenant-custom-99",
              permissions: ["*"],
            },
          },
        },
      };

      const extracted = extractor.extractFromPolicy(mockPolicy);
      expect(extracted.endpoints.port).toBe(8080);
      expect(extracted.endpoints.baseUrl).toBe("http://localhost:8080");
      expect(extracted.endpoints.healthEndpoint).toBe("http://localhost:8080/healthz");
      expect(extracted.endpoints.loginUrl).toBe("http://localhost:8080/auth/signin");
      expect(extracted.endpoints.logoutUrl).toBe("http://localhost:8080/auth/signout");
      expect(extracted.endpoints.signupUrl).toBe("http://localhost:8080/auth/register");
      expect(extracted.endpoints.sessionVerifyUrl).toBe("http://localhost:8080/api/session");
      expect(extracted.portInfo.containerName).toBe("custom-web-app");
      expect(extracted.personas.admin?.email).toBe("superadmin@custom.local");
      expect(extracted.personas.admin?.tenantId).toBe("tenant-custom-99");
    });

    it("resolves relative routes to absolute endpoint URLs", () => {
      const extractor = new ParameterExtractor();
      const params = extractor.getDefaultParameters("http://localhost:4000");

      expect(extractor.resolveEndpoint("/dashboard", params)).toBe(
        "http://localhost:4000/dashboard",
      );
      expect(extractor.resolveEndpoint("settings/profile", params)).toBe(
        "http://localhost:4000/settings/profile",
      );
      expect(extractor.resolveEndpoint("http://otherhost:8080/external", params)).toBe(
        "http://otherhost:8080/external",
      );
    });
  });
});
