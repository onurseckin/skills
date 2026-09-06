import { describe, expect, it } from "bun:test";
import {
  compareSemanticVersions,
  createHandshakeOffer,
  isHandshakeAccept,
  isHandshakeReject,
  negotiateHandshake,
  parseSemanticVersion,
} from "../../../olt/scripts/src/liaison/protocol/handshake.ts";
import type { EndpointConfig } from "../../../olt/scripts/src/liaison/protocol/types.ts";

describe("Handshake protocol negotiator", () => {
  const baseConfig: EndpointConfig = {
    endpoint_id: "server-liaison-1",
    supported_versions: ["1.0.0", "1.1.0", "2.0.0"],
    capabilities: [
      "two_phase_receipts",
      "structured_telemetry",
      "explicit_expectations",
      "heartbeat",
    ],
    min_heartbeat_interval_ms: 5000,
    max_heartbeat_interval_ms: 60000,
    preferred_heartbeat_interval_ms: 15000,
  };

  describe("Semantic version parsing and comparison", () => {
    it("parses valid semantic version strings", () => {
      expect(parseSemanticVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
      expect(parseSemanticVersion("v2.0.1")).toEqual({ major: 2, minor: 0, patch: 1 });
      expect(parseSemanticVersion("invalid")).toBeNull();
    });

    it("compares semantic versions correctly", () => {
      expect(compareSemanticVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
      expect(compareSemanticVersions("1.1.0", "1.2.0")).toBeLessThan(0);
      expect(compareSemanticVersions("1.0.0", "1.0.0")).toBe(0);
    });
  });

  describe("Handshake offer creation", () => {
    it("creates a well-formed handshake offer", () => {
      const offer = createHandshakeOffer({
        endpoint_id: "client-liaison-1",
        protocol_version: "1.1.0",
        supported_versions: ["1.0.0", "1.1.0"],
        capabilities: ["two_phase_receipts", "heartbeat"],
        heartbeat_interval_ms: 10000,
      });

      expect(offer.endpoint_id).toBe("client-liaison-1");
      expect(offer.protocol_version).toBe("1.1.0");
      expect(offer.supported_versions).toContain("1.1.0");
      expect(offer.capabilities).toContain("two_phase_receipts");
      expect(offer.heartbeat_interval_ms).toBe(10000);
      expect(offer.timestamp).toBeDefined();
    });
  });

  describe("Handshake negotiation", () => {
    it("negotiates mutually supported version and capabilities", () => {
      const offer = createHandshakeOffer({
        endpoint_id: "client-liaison-1",
        protocol_version: "1.1.0",
        supported_versions: ["1.0.0", "1.1.0"],
        capabilities: ["two_phase_receipts", "heartbeat", "custom_feature"],
        heartbeat_interval_ms: 12000,
      });

      const result = negotiateHandshake(offer, baseConfig);

      expect(isHandshakeAccept(result)).toBe(true);
      if (isHandshakeAccept(result)) {
        expect(result.accepted).toBe(true);
        // Mutually supported are 1.0.0 and 1.1.0; 1.1.0 is higher
        expect(result.selected_version).toBe("1.1.0");
        expect(result.agreed_capabilities).toEqual(["two_phase_receipts", "heartbeat"]);
        expect(result.agreed_capabilities).not.toContain("custom_feature");
        expect(result.agreed_heartbeat_interval_ms).toBe(12000);
        expect(result.endpoint_id).toBe("server-liaison-1");
      }
    });

    it("clamps heartbeat interval to server bounds", () => {
      // Client offers interval smaller than min (2000ms < 5000ms)
      const lowOffer = createHandshakeOffer({
        endpoint_id: "client-liaison-1",
        protocol_version: "1.0.0",
        capabilities: ["heartbeat"],
        heartbeat_interval_ms: 2000,
      });
      const lowResult = negotiateHandshake(lowOffer, baseConfig);
      expect(isHandshakeAccept(lowResult)).toBe(true);
      if (isHandshakeAccept(lowResult)) {
        expect(lowResult.agreed_heartbeat_interval_ms).toBe(5000);
      }

      // Client offers interval larger than max (90000ms > 60000ms)
      const highOffer = createHandshakeOffer({
        endpoint_id: "client-liaison-1",
        protocol_version: "1.0.0",
        capabilities: ["heartbeat"],
        heartbeat_interval_ms: 90000,
      });
      const highResult = negotiateHandshake(highOffer, baseConfig);
      expect(isHandshakeAccept(highResult)).toBe(true);
      if (isHandshakeAccept(highResult)) {
        expect(highResult.agreed_heartbeat_interval_ms).toBe(60000);
      }
    });

    it("rejects offer when client is missing a required capability", () => {
      const strictConfig: EndpointConfig = {
        ...baseConfig,
        required_capabilities: ["two_phase_receipts", "structured_telemetry"],
      };

      const offer = createHandshakeOffer({
        endpoint_id: "client-liaison-1",
        protocol_version: "1.0.0",
        capabilities: ["two_phase_receipts"], // missing structured_telemetry!
        heartbeat_interval_ms: 10000,
      });

      const result = negotiateHandshake(offer, strictConfig);
      expect(isHandshakeReject(result)).toBe(true);
      if (isHandshakeReject(result)) {
        expect(result.accepted).toBe(false);
        expect(result.reject_reason).toContain("structured_telemetry");
      }
    });

    it("rejects offer when protocol versions are incompatible", () => {
      const offer = createHandshakeOffer({
        endpoint_id: "client-liaison-legacy",
        protocol_version: "0.9.0",
        supported_versions: ["0.8.0", "0.9.0"],
        capabilities: ["heartbeat"],
        heartbeat_interval_ms: 10000,
      });

      const result = negotiateHandshake(offer, baseConfig);
      expect(isHandshakeReject(result)).toBe(true);
      if (isHandshakeReject(result)) {
        expect(result.accepted).toBe(false);
        expect(result.reject_reason).toContain("Incompatible protocol versions");
      }
    });
  });
});
