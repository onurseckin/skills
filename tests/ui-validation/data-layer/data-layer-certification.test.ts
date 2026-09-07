import {
  describe,
  expect,
  it,
  createDashboardTelemetryFixtures,
  DataLayerPreFlightCertifier,
  DefectRouter,
} from "../fixtures.ts";

describe("Data Layer Disambiguation Gateway - Pre-flight & Handoff Token", () => {
  describe("Certification & Token Gate", () => {
    it("certifies valid data-layer responses in pre-flight inspection", () => {
      const certifier = new DataLayerPreFlightCertifier();
      const fixtures = createDashboardTelemetryFixtures();

      const result = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 200,
        actualPayload: fixtures.FULLY_POPULATED.payload,
        latencyMs: 45,
      });

      expect(result.certified).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.certificateId).toMatch(/^cert-/u);
      expect(result.latencyMs).toBe(45);
    });

    it("rejects invalid status code or high latency in pre-flight certification", () => {
      const certifier = new DataLayerPreFlightCertifier();
      const fixtures = createDashboardTelemetryFixtures();

      const statusMismatch = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 500,
        actualPayload: { error: "Database crashed" },
        latencyMs: 120,
      });

      expect(statusMismatch.certified).toBe(false);
      expect(statusMismatch.violations.some((v) => v.includes("HTTP Status Code mismatch"))).toBe(
        true,
      );

      const highLatency = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 200,
        actualPayload: fixtures.FULLY_POPULATED.payload,
        latencyMs: 6500,
        maxLatencyMs: 5000,
      });

      expect(highLatency.certified).toBe(false);
      expect(highLatency.violations.some((v) => v.includes("latency"))).toBe(true);
    });

    it("routes data-layer defects directly to AUTONOMOUS_IMPLEMENTER", () => {
      const certifier = new DataLayerPreFlightCertifier();
      const defectRouter = new DefectRouter();
      const fixtures = createDashboardTelemetryFixtures();

      const failedCert = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 500,
        actualPayload: { error: "Internal Server Error" },
        latencyMs: 100,
      });

      const receipt = defectRouter.routeDefect(failedCert, { error: "Internal Server Error" });

      expect(receipt.recipient).toBe("AUTONOMOUS_IMPLEMENTER");
      expect(receipt.category).toBe("BACKEND_DATA_LAYER_FAULT");
      expect(receipt.severity).toBe("CRITICAL");
      expect(receipt.endpoint).toBe("/api/telemetry");
      expect(receipt.statusCode).toBe(500);

      expect(defectRouter.getRoutedReceipts().length).toBe(1);
      defectRouter.clearReceipts();
      expect(defectRouter.getRoutedReceipts().length).toBe(0);
    });
  });
});
