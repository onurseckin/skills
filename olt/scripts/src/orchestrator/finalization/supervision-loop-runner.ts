import { HarnessError } from "../../core/errors/index.ts";
import {
  assessRecyclingState,
  planAutonomousRoundRecycle,
  type AutonomousRecycleOptions,
  type RecycleAssessment,
  type RecyclePlan,
} from "../../mind/archival/recycler/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { AutonomousLoopRunner } from "../loop-runner.ts";
import { executeBackgroundFinalization } from "./background-finalize.ts";
import { assertZeroMainThreadSpillover } from "./spillover-guard.ts";
import { boundedEvidenceCause } from "./runners.ts";
import type {
  BackgroundFinalizationResult,
  SupervisionLoopRunnerOptions,
  SupervisionLoopSummary,
} from "./types.ts";

export function transitionSupervisionLoopToDiscovery(
  options: AutonomousRecycleOptions & { readonly state?: Record<string, unknown> | undefined },
): RecycleAssessment {
  let state = options.state;
  if (state === undefined) {
    try {
      state = loadRun(options.runRoot).state as Record<string, unknown>;
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `supervision loop continuation evidence unavailable: ${boundedEvidenceCause(error)}`,
      );
    }
  }
  return assessRecyclingState(state, options.runRoot, { now: options.now });
}

export function planSupervisionLoopRecycle(
  state: Record<string, unknown>,
  options: AutonomousRecycleOptions,
): RecyclePlan {
  return planAutonomousRoundRecycle(state, options);
}

export class SupervisionLoopRunner {
  private readonly loopRunner: AutonomousLoopRunner;
  private readonly options: SupervisionLoopRunnerOptions;

  public constructor(options: SupervisionLoopRunnerOptions) {
    this.options = options;
    this.loopRunner = new AutonomousLoopRunner(options);
  }

  public get maxRounds(): number {
    return this.loopRunner.maxRounds;
  }

  public get baseRunId(): string {
    return this.loopRunner.baseRunId;
  }

  public get repoPath(): string {
    return this.loopRunner.repoPath;
  }

  public getCapsulePath(runId: string): string {
    return this.loopRunner.getCapsulePath(runId);
  }

  public async run(): Promise<SupervisionLoopSummary> {
    const summary = await this.loopRunner.run();
    let finalization: BackgroundFinalizationResult | undefined;
    let recyclingAssessment: RecycleAssessment | undefined;

    const autoFinalize = this.options.autoFinalizeOnConvergence ?? true;

    if (summary.finalStatus === "converged_success" && autoFinalize) {
      const actorName = this.options.actor?.length ? this.options.actor : "orchestrator-tier1";

      finalization = await executeBackgroundFinalization({
        repoPath: this.options.repoPath,
        runId: this.loopRunner.baseRunId,
        runRoot: this.loopRunner.getCapsulePath(this.loopRunner.baseRunId),
        actor: actorName,
        skipPush: this.options.skipPush,
        skipSync: this.options.skipSync,
        syncCommand: this.options.syncCommand,
        gitRunner: this.options.gitRunner,
        syncRunner: this.options.syncRunner,
        commitMessage: this.options.commitMessageTemplate,
        isMainThread: false,
        executionTier: 1,
      });

      assertZeroMainThreadSpillover(finalization);
      recyclingAssessment = finalization.recyclingAssessment;
      this.options.onFinalizationComplete?.(finalization);
    }

    return {
      ...summary,
      ...(finalization !== undefined ? { finalization } : {}),
      ...(recyclingAssessment !== undefined ? { recyclingAssessment } : {}),
      zeroMainThreadSpillover: true,
    };
  }
}
