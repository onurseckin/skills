import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  CANONICAL_DEFAULT_PERSONAS,
  IdentityGovernanceEngine,
  getDefaultIdentityGovernanceEngine,
  setDefaultIdentityGovernanceEngine,
  resetDefaultIdentityGovernanceEngine,
} from "../fixtures.ts";

describe("Identity Governance Engine - Lifecycle & Permissions", () => {
  beforeEach(() => {
    resetDefaultIdentityGovernanceEngine();
  });

  afterEach(() => {
    resetDefaultIdentityGovernanceEngine();
  });

  describe("Session Degradation & Permission Enforcement", () => {
    it("detects mid-flight session degradation across all vectors", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.standard_user!;

      const res401 = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/dashboard",
        statusCode: 401,
        activePersona: persona,
      });
      expect(res401.degraded).toBe(true);
      expect(res401.cause).toBe("STATUS_401");
      expect(res401.recommendedAction).toBe("RE_AUTHENTICATE");

      const res403 = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/admin",
        statusCode: 403,
        activePersona: persona,
      });
      expect(res403.degraded).toBe(true);
      expect(res403.cause).toBe("STATUS_403");
      expect(res403.recommendedAction).toBe("SWITCH_PERSONA");

      const res419 = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/settings",
        statusCode: 419,
        activePersona: persona,
      });
      expect(res419.degraded).toBe(true);
      expect(res419.cause).toBe("STATUS_419");

      const resRedirect = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/login?redirect=%2Fdashboard",
        activePersona: persona,
      });
      expect(resRedirect.degraded).toBe(true);
      expect(resRedirect.cause).toBe("REDIRECT_TO_LOGIN");

      const resVisual = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/profile",
        domSnippet: "<div class='banner alert'>Your session expired. Please log in again.</div>",
        activePersona: persona,
      });
      expect(resVisual.degraded).toBe(true);
      expect(resVisual.cause).toBe("VISUAL_UNAUTHORIZED_BANNER");

      const expiredJwt = engine.generateMockToken(persona, { expiresInSeconds: -100 });
      const resExpiredJwt = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/dashboard",
        token: expiredJwt,
        activePersona: persona,
      });
      expect(resExpiredJwt.degraded).toBe(true);
      expect(resExpiredJwt.cause).toBe("EXPIRED_JWT");

      const validJwt = engine.generateMockToken(persona, { expiresInSeconds: 3600 });
      const resClean = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/dashboard",
        statusCode: 200,
        token: validJwt,
        activePersona: persona,
      });
      expect(resClean.degraded).toBe(false);
      expect(resClean.cause).toBe("NONE");
    });

    it("executes autonomous re-authentication protocol gracefully", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.standard_user!;

      const degradation = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/dashboard",
        statusCode: 401,
        activePersona: persona,
      });

      const reauthPlan = engine.executeAutonomousReauthentication(degradation, persona, {
        baseUrl: "http://localhost:3000",
        resumeUrl: "http://localhost:3000/dashboard",
      });

      expect(reauthPlan.success).toBe(true);
      expect(reauthPlan.resumeUrl).toBe("http://localhost:3000/dashboard");
      expect(reauthPlan.freshContext.token).toBeDefined();
      expect(reauthPlan.injectionSteps.length).toBeGreaterThan(3);
    });

    it("simulates multi-role permission boundaries and catches privilege leakage", () => {
      const engine = new IdentityGovernanceEngine();
      const personas = [
        CANONICAL_DEFAULT_PERSONAS.admin!,
        CANONICAL_DEFAULT_PERSONAS.standard_user!,
        CANONICAL_DEFAULT_PERSONAS.guest!,
      ];

      const auditResult = engine.simulatePermissionBoundary("/admin/settings", ["*"], personas);

      expect(auditResult.compliant).toBe(true);
      expect(auditResult.securityScore).toBe(100);
      expect(auditResult.privilegeLeakages.length).toBe(0);

      const adminEval = auditResult.evaluations.find((e) => e.role === "admin");
      expect(adminEval?.actualResult).toBe("ALLOW");

      const standardEval = auditResult.evaluations.find((e) => e.role === "standard_user");
      expect(standardEval?.actualResult).toBe("DENY_FORBIDDEN");

      const guestEval = auditResult.evaluations.find((e) => e.role === "guest");
      expect(guestEval?.actualResult).toBe("DENY_REDIRECT_LOGIN");
    });

    it("manages singleton instance correctly", () => {
      const defaultEngine = getDefaultIdentityGovernanceEngine();
      expect(defaultEngine).toBeInstanceOf(IdentityGovernanceEngine);

      const customEngine = new IdentityGovernanceEngine();
      setDefaultIdentityGovernanceEngine(customEngine);
      expect(getDefaultIdentityGovernanceEngine()).toBe(customEngine);
    });
  });
});
