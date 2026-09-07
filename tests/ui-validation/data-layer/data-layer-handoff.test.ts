import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  computePayloadSha256,
  createDashboardTelemetryFixtures,
  DataLayerPreFlightCertifier,
  VisualFoundationHandoffGate,
  DisambiguationGatewayEngine,
  getDefaultDisambiguationGatewayEngine,
  setDefaultDisambiguationGatewayEngine,
  resetDefaultDisambiguationGatewayEngine,
} from "../fixtures.ts";

describe("Data Layer Disambiguation Gateway - Pre-flight & Handoff Token", () => {
  beforeEach(() => {
    resetDefaultDisambiguationGatewayEngine();
  });

  afterEach(() => {
    resetDefaultDisambiguationGatewayEngine();
  });

  describe("Certification & Token Gate", () => {
    it("issues and verifies cryptographic visual foundation handoff tokens", () => {
      const certifier = new DataLayerPreFlightCertifier();
      const handoffGate = new VisualFoundationHandoffGate();
      const fixtures = createDashboardTelemetryFixtures();
      const payload = fixtures.FULLY_POPULATED.payload;

      const cert = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 200,
        actualPayload: payload,
        latencyMs: 25,
      });

      const token = handoffGate.issueHandoffToken(cert, payload, {
        componentOrRoute: "/dashboard",
        ttlSeconds: 600,
      });

      expect(token.tokenId).toMatch(/^vtok-/u);
      expect(token.certificateId).toBe(cert.certificateId);
      expect(token.componentOrRoute).toBe("/dashboard");
      expect(token.payloadSha256).toBe(computePayloadSha256(payload));

      const validVerify = handoffGate.verifyHandoffToken(token, payload);
      expect(validVerify.verified).toBe(true);
      expect(validVerify.tampered).toBe(false);
      expect(validVerify.expired).toBe(false);

      const tamperedPayload = { ...(payload as Record<string, unknown>), injectedField: "hacked" };
      const tamperedVerify = handoffGate.verifyHandoffToken(token, tamperedPayload);
      expect(tamperedVerify.verified).toBe(false);
      expect(tamperedVerify.tampered).toBe(true);

      const expiredVerify = handoffGate.verifyHandoffToken(token, payload, token.expiresAt + 10);
      expect(expiredVerify.verified).toBe(false);
      expect(expiredVerify.expired).toBe(true);
    });

    it("throws HarnessError when trying to issue handoff token for uncertified pre-flight result", () => {
      const handoffGate = new VisualFoundationHandoffGate();
      const uncertifiedResult = {
        certified: false,
        certificateId: "cert-invalid",
        endpoint: "/api/broken",
        fixtureType: "FULLY_POPULATED" as const,
        statusCode: 500,
        expectedStatusCode: 200,
        schemaValid: false,
        latencyMs: 50,
        violations: ["Server crashed"],
        timestamp: new Date().toISOString(),
      };

      expect(() => {
        handoffGate.issueHandoffToken(uncertifiedResult, {}, { componentOrRoute: "/broken" });
      }).toThrow(HarnessError);
    });

    it("executes end-to-end evaluation flow in DisambiguationGatewayEngine", () => {
      const engine = new DisambiguationGatewayEngine();
      const fixtures = createDashboardTelemetryFixtures();

      const successEval = engine.processDataLayerEvaluation({
        endpoint: "/api/telemetry",
        componentOrRoute: "/dashboard",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 200,
        actualPayload: fixtures.FULLY_POPULATED.payload,
        latencyMs: 30,
      });

      expect(successEval.certification.certified).toBe(true);
      expect(successEval.handoffToken).toBeDefined();
      expect(successEval.defectReceipt).toBeUndefined();

      const failEval = engine.processDataLayerEvaluation({
        endpoint: "/api/telemetry",
        componentOrRoute: "/dashboard",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 500,
        actualPayload: { error: "Database timeout" },
        latencyMs: 500,
      });

      expect(failEval.certification.certified).toBe(false);
      expect(failEval.handoffToken).toBeUndefined();
      expect(failEval.defectReceipt).toBeDefined();
      expect(failEval.defectReceipt?.recipient).toBe("AUTONOMOUS_IMPLEMENTER");
    });

    it("manages singleton instance correctly", () => {
      const defaultEngine = getDefaultDisambiguationGatewayEngine();
      expect(defaultEngine).toBeInstanceOf(DisambiguationGatewayEngine);

      const customEngine = new DisambiguationGatewayEngine();
      setDefaultDisambiguationGatewayEngine(customEngine);
      expect(getDefaultDisambiguationGatewayEngine()).toBe(customEngine);
    });
  });
});
