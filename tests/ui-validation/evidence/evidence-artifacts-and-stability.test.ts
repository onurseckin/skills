import {
  describe,
  expect,
  it,
  HarnessError,
  CompositeKeyParser,
  type CompositeArtifactKey,
} from "../fixtures.ts";

describe("Evidence Lifecycle - Artifact Keys & Stability Barrier", () => {
  describe("Composite-Key Artifact Identification Framework", () => {
    it("sanitizes key segments cleanly", () => {
      expect(CompositeKeyParser.sanitizeSegment("/users/settings/")).toBe("users-settings");
      expect(CompositeKeyParser.sanitizeSegment("Epic#1_Auth")).toBe("epic-1_auth");
      expect(CompositeKeyParser.sanitizeSegment("")).toBe("unknown");
    });

    it("serializes and parses composite artifact keys correctly", () => {
      const key: CompositeArtifactKey = {
        epic: "auth-gateway",
        round: 2,
        route: "login-form",
        state: "error-state",
        viewport: "1440x900",
      };

      const serializedWithExt = CompositeKeyParser.serialize(key, "png");
      expect(serializedWithExt).toBe("auth-gateway_r2_login-form_error-state_1440x900.png");

      const parsed = CompositeKeyParser.parse(serializedWithExt);
      expect(parsed.epic).toBe("auth-gateway");
      expect(parsed.round).toBe(2);
      expect(parsed.route).toBe("login-form");
      expect(parsed.state).toBe("error-state");
      expect(parsed.viewport).toBe("1440x900");
    });

    it("validates composite keys accurately", () => {
      expect(CompositeKeyParser.validate("checkout_r1_shipping_default_390x844.png")).toBe(true);
      expect(CompositeKeyParser.validate("invalid_key_too_few_parts")).toBe(false);
      expect(
        CompositeKeyParser.validate({
          epic: "auth",
          round: 1,
          route: "login",
          state: "default",
          viewport: "1440x900",
        }),
      ).toBe(true);
    });

    it("extracts complete artifact metadata", () => {
      const meta = CompositeKeyParser.extractMetadata(
        "dashboard_r1_overview_populated_1920x1080.png",
        {
          sizeBytes: 1048576,
          mimeType: "image/png",
        },
      );

      expect(meta.key.epic).toBe("dashboard");
      expect(meta.key.round).toBe(1);
      expect(meta.sizeBytes).toBe(1048576);
      expect(meta.mimeType).toBe("image/png");
      expect(meta.tier).toBe(1);
      expect(meta.sha256).toBeDefined();
      expect(meta.createdAt).toBeDefined();
    });

    it("throws HarnessError on invalid composite key operations", () => {
      expect(() => CompositeKeyParser.serialize(null as unknown as CompositeArtifactKey)).toThrow(
        HarnessError,
      );
      expect(() =>
        CompositeKeyParser.serialize({
          epic: "a",
          round: -1,
          route: "r",
          state: "s",
          viewport: "v",
        }),
      ).toThrow(HarnessError);
      expect(() => CompositeKeyParser.parse("")).toThrow(HarnessError);
      expect(() => CompositeKeyParser.parse("a_b_c_d")).toThrow(HarnessError);
    });
  });
});
