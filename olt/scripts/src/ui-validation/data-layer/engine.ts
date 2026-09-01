import { HarnessError } from "../../core/errors/index.ts";
import type {
  SyntheticFixture,
  PreFlightCertificationResult,
  RoutedDefectReceipt,
  VisualFoundationHandoffToken,
  DisambiguationEvaluationResult,
  PayloadSchema,
} from "./types.ts";
import { createDashboardTelemetryFixtures, createUserManagementFixtures } from "./fixtures.ts";
import {
  DataLayerPreFlightCertifier,
  DefectRouter,
  VisualFoundationHandoffGate,
} from "./certifier.ts";

export class DisambiguationGatewayEngine {
  private readonly certifier = new DataLayerPreFlightCertifier();
  private readonly defectRouter = new DefectRouter();
  private readonly handoffGate = new VisualFoundationHandoffGate();

  public getCertifier(): DataLayerPreFlightCertifier {
    return this.certifier;
  }

  public getDefectRouter(): DefectRouter {
    return this.defectRouter;
  }

  public getHandoffGate(): VisualFoundationHandoffGate {
    return this.handoffGate;
  }

  /**
   * Process a fixture evaluation end-to-end:
   * 1. Runs pre-flight certification
   * 2. If failure -> routes defect to Autonomous Repairer and throws or returns failure
   * 3. If success -> issues cryptographic handoff token
   */
  public processDataLayerEvaluation(params: {
    readonly endpoint: string;
    readonly componentOrRoute: string;
    readonly fixture: SyntheticFixture;
    readonly actualStatusCode: number;
    readonly actualPayload: unknown;
    readonly latencyMs: number;
    readonly schema?: PayloadSchema | undefined;
    readonly maxLatencyMs?: number | undefined;
  }): {
    readonly certification: PreFlightCertificationResult;
    readonly handoffToken?: VisualFoundationHandoffToken | undefined;
    readonly defectReceipt?: RoutedDefectReceipt | undefined;
  } {
    const certification = this.certifier.certifyFixture({
      endpoint: params.endpoint,
      fixture: params.fixture,
      actualStatusCode: params.actualStatusCode,
      actualPayload: params.actualPayload,
      latencyMs: params.latencyMs,
      ...(params.schema ? { schema: params.schema } : {}),
      ...(params.maxLatencyMs ? { maxLatencyMs: params.maxLatencyMs } : {}),
    });

    if (!certification.certified) {
      const defectReceipt = this.defectRouter.routeDefect(certification, params.actualPayload);
      return {
        certification,
        defectReceipt,
      };
    }

    const handoffToken = this.handoffGate.issueHandoffToken(certification, params.actualPayload, {
      componentOrRoute: params.componentOrRoute,
    });

    return {
      certification,
      handoffToken,
    };
  }
}

/**
 * Singleton instance of DisambiguationGatewayEngine
 */
let defaultDisambiguationEngine: DisambiguationGatewayEngine | null = null;

export function getDefaultDisambiguationGatewayEngine(): DisambiguationGatewayEngine {
  if (!defaultDisambiguationEngine) {
    defaultDisambiguationEngine = new DisambiguationGatewayEngine();
  }
  return defaultDisambiguationEngine;
}

export function setDefaultDisambiguationGatewayEngine(engine: DisambiguationGatewayEngine): void {
  defaultDisambiguationEngine = engine;
}

export function resetDefaultDisambiguationGatewayEngine(): void {
  defaultDisambiguationEngine = null;
}
