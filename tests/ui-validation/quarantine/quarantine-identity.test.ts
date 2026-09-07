import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  CANONICAL_DEFAULT_PERSONAS,
  IdentityGovernanceEngine,
  resetDefaultIdentityGovernanceEngine,
} from "../fixtures.ts";

describe("Identity Governance Engine", () => {
  beforeEach(() => {
    resetDefaultIdentityGovernanceEngine();
  });

  afterEach(() => {
    resetDefaultIdentityGovernanceEngine();
  });

  describe("Identity Token & Session Provisioning", () => {
    it("generates deterministic mock JWT tokens with correct claims", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.admin!;

      const token = engine.generateMockToken(persona, { expiresInSeconds: 1800 });
      expect(token).toBeDefined();
      expect(token.split(".").length).toBe(3);

      const decoded = engine.decodeMockToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.payload.role).toBe("admin");
      expect(decoded?.payload.email).toBe(persona.email);
      expect(decoded?.payload.tenant_id).toBe(persona.tenantId);
      expect(decoded?.payload.iss).toBe("olt-identity-governor");
      expect(typeof decoded?.payload.exp).toBe("number");
    });

    it("detects expired tokens accurately", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.standard_user!;

      const activeToken = engine.generateMockToken(persona, { expiresInSeconds: 100 });
      expect(engine.isTokenExpired(activeToken)).toBe(false);

      const expiredToken = engine.generateMockToken(persona, { expiresInSeconds: -50 });
      expect(engine.isTokenExpired(expiredToken)).toBe(true);
    });

    it("generates session cookies conforming to template specifications", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.admin!;

      const cookies = engine.generateSessionCookies(persona, {
        baseUrl: "http://localhost:3000",
      });

      expect(cookies.length).toBe(2);
      const sessionCookie = cookies.find((c) => c.name === "olt_session_id");
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie?.domain).toBe("localhost");
      expect(sessionCookie?.httpOnly).toBe(true);
      expect(sessionCookie?.sameSite).toBe("Lax");
    });

    it("generates Playwright-compatible browser storage state", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.billing_admin!;

      const storageState = engine.generateStorageState(persona, {
        baseUrl: "http://localhost:3000",
      });

      expect(storageState.cookies.length).toBeGreaterThan(0);
      expect(storageState.origins.length).toBe(1);
      expect(storageState.origins[0]?.origin).toBe("http://localhost:3000");

      const authStorage = storageState.origins[0]?.localStorage.find(
        (e) => e.name === "auth_token",
      );
      expect(authStorage).toBeDefined();
      expect(authStorage?.value).toBeDefined();

      const userStorage = storageState.origins[0]?.localStorage.find(
        (e) => e.name === "current_user",
      );
      expect(userStorage).toBeDefined();
      const parsedUser = JSON.parse(userStorage!.value);
      expect(parsedUser.role).toBe("billing_admin");
    });

    it("generates HTTP authorization headers", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.compliance_auditor!;

      const headers = engine.generateAuthHeaders(persona);
      expect(headers.Authorization).toMatch(/^Bearer\s+.+/u);
      expect(headers["X-Tenant-ID"]).toBe(persona.tenantId);
      expect(headers["X-User-Role"]).toBe("compliance_auditor");
    });

    it("creates complete persona session context", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.admin!;

      const ctx = engine.createPersonaSessionContext(persona, { baseUrl: "http://localhost:3000" });
      expect(ctx.persona).toEqual(persona);
      expect(ctx.token).toBeDefined();
      expect(ctx.cookies.length).toBe(2);
      expect(ctx.authHeaders.Authorization).toBeDefined();
      expect(ctx.storageState.origins.length).toBe(1);
      expect(ctx.expiresAt).toBeGreaterThan(Date.now());
    });
  });
});
