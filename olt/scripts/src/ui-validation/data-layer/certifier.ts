// @ts-nocheck
import { createHash, createHmac, randomUUID } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import type {
  SyntheticFixtureType,
  SyntheticFixture,
  PayloadSchema,
  PreFlightCertificationResult,
  RoutedDefectReceipt,
  VisualFoundationHandoffToken,
  HandoffVerificationResult,
} from "./types.ts";
import {
  computePayloadSha256,
  validatePayloadSchema,
} from "./fixtures.ts";

const HANDOFF_SECRET = "olt-visual-foundation-handoff-secret-key-32-chars";

export class DataLayerPreFlightCertifier {
  /**
   * Certify a synthetic fixture response against expectations and payload schema
   */
  public certifyFixture(params: {
    readonly endpoint: string;
    readonly fixture: SyntheticFixture;
    readonly actualStatusCode: number;
    readonly actualPayload: unknown;
    readonly latencyMs: number;
    readonly schema?: PayloadSchema | undefined;
    readonly maxLatencyMs?: number | undefined;
  }): PreFlightCertificationResult {
    const {
      endpoint,
      fixture,
      actualStatusCode,
      actualPayload,
      latencyMs,
      schema,
      maxLatencyMs = 5000,
    } = params;

    const violations: string[] = [];

    // 1. Status Code Match
    if (actualStatusCode !== fixture.expectedStatusCode) {
      violations.push(
        `HTTP Status Code mismatch: expected ${fixture.expectedStatusCode}, received ${actualStatusCode}.`,
      );
    }

    // 2. Latency Threshold
    if (latencyMs > maxLatencyMs) {
      violations.push(
        `Data layer response latency (${latencyMs}ms) exceeded SLA threshold of ${maxLatencyMs}ms.`,
      );
    }

    // 3. Payload Schema Validation (if schema provided and not controlled error)
    let schemaValid = true;
    if (schema && fixture.type !== "CONTROLLED_SERVER_ERROR") {
      const schemaCheck = validatePayloadSchema(actualPayload, schema);
      if (!schemaCheck.valid) {
        schemaValid = false;
        violations.push(...schemaCheck.violations);
      }
    }

    const certified = violations.length === 0;
    const certificateId = `cert-${randomUUID()}`;

    return {
      certified,
      certificateId,
      endpoint,
      fixtureType: fixture.type,
      statusCode: actualStatusCode,
      expectedStatusCode: fixture.expectedStatusCode,
      schemaValid,
      latencyMs,
      violations,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Autonomous Repairer Defect Router
 */
export class DefectRouter {
  private readonly defectReceipts: RoutedDefectReceipt[] = [];

  /**
   * Route a data-layer failure directly to AUTONOMOUS_REPAIRER
   */
  public routeDefect(certification: PreFlightCertificationResult, actualPayload?: unknown): RoutedDefectReceipt {
    const defectId = `defect-data-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const severity =
      certification.statusCode >= 500
        ? "CRITICAL"
        : certification.violations.length > 3
          ? "HIGH"
          : "MEDIUM";

    let payloadSnippet = "";
    try {
      payloadSnippet = JSON.stringify(actualPayload ?? {}).slice(0, 500);
    } catch {
      payloadSnippet = String(actualPayload).slice(0, 500);
    }

    const receipt: RoutedDefectReceipt = {
      defectId,
      recipient: "AUTONOMOUS_REPAIRER",
      category: "BACKEND_DATA_LAYER_FAULT",
      severity,
      endpoint: certification.endpoint,
      fixtureType: certification.fixtureType,
      violations: certification.violations,
      statusCode: certification.statusCode,
      payloadSnippet,
      routedAt: new Date().toISOString(),
      recommendedAction: `Inspect backend mock endpoint '${certification.endpoint}' for schema mismatch or HTTP ${certification.statusCode} failure. Restore synthetic fixture '${certification.fixtureType}'.`,
    };

    this.defectReceipts.push(receipt);
    return receipt;
  }

  /**
   * Retrieve all defect routing receipts
   */
  public getRoutedReceipts(): readonly RoutedDefectReceipt[] {
    return [...this.defectReceipts];
  }

  /**
   * Clear defect history
   */
  public clearReceipts(): void {
    this.defectReceipts.length = 0;
  }
}

/**
 * Controlled Visual Foundation Handoff Gate
 */
export class VisualFoundationHandoffGate {
  /**
   * Issue a cryptographic handoff token upon successful pre-flight certification
   */
  public issueHandoffToken(
    certification: PreFlightCertificationResult,
    payload: unknown,
    options: {
      readonly componentOrRoute: string;
      readonly ttlSeconds?: number | undefined;
    },
  ): VisualFoundationHandoffToken {
    if (!certification.certified) {
      throw new HarnessError(
        "INVALID_STATE",
        `Cannot issue visual foundation handoff token for uncertified pre-flight result (${certification.violations.join("; ")})`,
      );
    }

    const tokenId = `vtok-${randomUUID()}`;
    const payloadSha256 = computePayloadSha256(payload);
    const now = Math.floor(Date.now() / 1000);
    const ttl = options.ttlSeconds ?? 900; // 15 minutes default
    const expiresAt = now + ttl;

    const signature = createHmac("sha256", HANDOFF_SECRET)
      .update(`${tokenId}:${certification.certificateId}:${options.componentOrRoute}:${certification.fixtureType}:${payloadSha256}:${expiresAt}`)
      .digest("hex");

    return {
      tokenId,
      certificateId: certification.certificateId,
      componentOrRoute: options.componentOrRoute,
      fixtureType: certification.fixtureType,
      payloadSha256,
      issuedAt: now,
      expiresAt,
      signature,
    };
  }

  /**
   * Verify handoff token cryptographic signature, freshness, and payload hash integrity
   */
  public verifyHandoffToken(
    token: VisualFoundationHandoffToken,
    payload: unknown,
    currentTimeSeconds?: number,
  ): HandoffVerificationResult {
    const current = currentTimeSeconds ?? Math.floor(Date.now() / 1000);

    // 1. Check expiration
    if (token.expiresAt <= current) {
      return {
        verified: false,
        reason: `Handoff token '${token.tokenId}' has expired (expired at ${token.expiresAt}, current ${current}).`,
        tampered: false,
        expired: true,
        token,
      };
    }

    // 2. Check cryptographic signature
    const expectedSignature = createHmac("sha256", HANDOFF_SECRET)
      .update(`${token.tokenId}:${token.certificateId}:${token.componentOrRoute}:${token.fixtureType}:${token.payloadSha256}:${token.expiresAt}`)
      .digest("hex");

    if (token.signature !== expectedSignature) {
      return {
        verified: false,
        reason: `Handoff token signature is invalid: token has been tampered with.`,
        tampered: true,
        expired: false,
        token,
      };
    }

    // 3. Verify payload SHA-256 integrity
    const actualPayloadSha256 = computePayloadSha256(payload);
    if (actualPayloadSha256 !== token.payloadSha256) {
      return {
        verified: false,
        reason: `Payload SHA-256 mismatch: expected ${token.payloadSha256}, actual ${actualPayloadSha256}. Data was modified after pre-flight certification.`,
        tampered: true,
        expired: false,
        token,
      };
    }

    return {
      verified: true,
      reason: `Visual foundation handoff token verified successfully for component '${token.componentOrRoute}' (${token.fixtureType}).`,
      tampered: false,
      expired: false,
      token,
    };
  }
}

/**
 * Master Disambiguation Gateway Engine
 */
