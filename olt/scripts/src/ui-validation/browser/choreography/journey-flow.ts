// @ts-nocheck
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  JourneyActionType,
  JourneyStep,
  JourneyFlow,
  JourneyStepResult,
  BreadcrumbVerificationResult,
  JourneyFlowResult,
  JourneyStepHandlerContext,
  JourneyStepHandler,
} from "./types.ts";
export class JourneyFlowEngine {
  /**
   * Verifies breadcrumb continuity against expected hierarchy
   */
  public verifyBreadcrumbContinuity(
    expectedBreadcrumbs: readonly string[],
    observedBreadcrumbs: readonly string[],
  ): BreadcrumbVerificationResult {
    if (!expectedBreadcrumbs || !observedBreadcrumbs) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Breadcrumb arrays must not be undefined or null",
      );
    }

    const missingBreadcrumbs = expectedBreadcrumbs.filter(
      (exp) => !observedBreadcrumbs.includes(exp),
    );
    const unexpectedBreadcrumbs = observedBreadcrumbs.filter(
      (obs) => !expectedBreadcrumbs.includes(obs),
    );

    // Strict order check if lengths match
    let match = missingBreadcrumbs.length === 0 && unexpectedBreadcrumbs.length === 0;
    if (match && expectedBreadcrumbs.length === observedBreadcrumbs.length) {
      for (let i = 0; i < expectedBreadcrumbs.length; i++) {
        if (expectedBreadcrumbs[i] !== observedBreadcrumbs[i]) {
          match = false;
          break;
        }
      }
    }

    return {
      match,
      expected: [...expectedBreadcrumbs],
      observed: [...observedBreadcrumbs],
      missingBreadcrumbs,
      unexpectedBreadcrumbs,
    };
  }

  /**
   * Executes a multi-step journey flow with breadcrumb continuity tracking
   */
  public async executeJourney(
    flow: JourneyFlow,
    stepHandler?: JourneyStepHandler,
  ): Promise<JourneyFlowResult> {
    if (!flow || !flow.id || !flow.steps) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Invalid journey flow structure supplied",
      );
    }

    if (flow.steps.length === 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Journey flow must contain at least one step",
      );
    }

    const executedSteps: JourneyStepResult[] = [];
    const violations: string[] = [];
    let currentRoute = flow.initialRoute;
    let breadcrumbContinuityPassed = true;
    let failedStep: JourneyStepResult | undefined;
    const startTime = Date.now();

    for (let index = 0; index < flow.steps.length; index++) {
      const step = flow.steps[index];
      if (!step) continue;
      const stepStartTime = Date.now();

      if (failedStep) {
        // Skip remaining steps after a failure
        executedSteps.push({
          stepId: step.id,
          stepName: step.name,
          route: step.route,
          status: "SKIPPED",
          durationMs: 0,
          breadcrumbsObserved: [],
          continuityVerified: false,
        });
        continue;
      }

      try {
        let breadcrumbsObserved: readonly string[] = step.expectedBreadcrumbs || [];
        let actualRoute = step.route;
        let stepError: string | undefined;

        if (stepHandler) {
          const handlerRes = await stepHandler({
            step,
            currentRoute,
            stepIndex: index,
          });
          if (handlerRes.breadcrumbsObserved !== undefined) {
            breadcrumbsObserved = handlerRes.breadcrumbsObserved;
          }
          if (handlerRes.actualRoute !== undefined) {
            actualRoute = handlerRes.actualRoute;
          }
          if (handlerRes.error) {
            stepError = handlerRes.error;
          }
        }

        let continuityVerified = true;
        if (step.expectedBreadcrumbs && step.expectedBreadcrumbs.length > 0) {
          const bRes = this.verifyBreadcrumbContinuity(
            step.expectedBreadcrumbs,
            breadcrumbsObserved,
          );
          if (!bRes.match) {
            continuityVerified = false;
            breadcrumbContinuityPassed = false;
            violations.push(
              `Step '${step.name}' breadcrumb mismatch. Expected [${step.expectedBreadcrumbs.join(
                ", ",
              )}], observed [${breadcrumbsObserved.join(", ")}]`,
            );
          }
        }

        const stepDuration = Date.now() - stepStartTime;

        if (stepError) {
          const failedResult: JourneyStepResult = {
            stepId: step.id,
            stepName: step.name,
            route: actualRoute,
            status: "FAILED",
            durationMs: stepDuration,
            breadcrumbsObserved,
            continuityVerified,
            error: stepError,
          };
          executedSteps.push(failedResult);
          failedStep = failedResult;
          violations.push(`Step '${step.name}' failed with error: ${stepError}`);
        } else {
          executedSteps.push({
            stepId: step.id,
            stepName: step.name,
            route: actualRoute,
            status: "PASSED",
            durationMs: stepDuration,
            breadcrumbsObserved,
            continuityVerified,
          });
          currentRoute = actualRoute;
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const stepDuration = Date.now() - stepStartTime;
        const failedResult: JourneyStepResult = {
          stepId: step.id,
          stepName: step.name,
          route: step.route,
          status: "FAILED",
          durationMs: stepDuration,
          breadcrumbsObserved: [],
          continuityVerified: false,
          error: errorMsg,
        };
        executedSteps.push(failedResult);
        failedStep = failedResult;
        violations.push(`Step '${step.name}' encountered unhandled exception: ${errorMsg}`);
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const success = !failedStep && violations.length === 0;

    return {
      flowId: flow.id,
      flowName: flow.name,
      success,
      executedSteps,
      ...(failedStep ? { failedStep } : {}),
      totalDurationMs,
      breadcrumbContinuityPassed,
      violations,
    };
  }
}

// ============================================================================
// 2. Dynamic Form Exploration & Boundary Stress Testing
// ============================================================================
