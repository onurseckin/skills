export interface LookaheadContext {
  readonly activeRunCount: number;
  readonly defectCount: number;
  readonly concurrencyLimit: number;
}

export interface LookaheadDirective {
  readonly allowConcurrentPlanning: boolean;
  readonly action: "PRE_PLAN_NEXT_CAPSULE" | "AWAIT_CONVERGENCE" | "TRIGGER_MODE_A_DISCOVERY";
  readonly message: string;
}

export class MindConcurrentLookaheadPipeline {
  public static computeNextActions(context: LookaheadContext): LookaheadDirective {
    if (context.activeRunCount < context.concurrencyLimit && context.defectCount > 0) {
      return {
        allowConcurrentPlanning: true,
        action: "PRE_PLAN_NEXT_CAPSULE",
        message: `Concurrent bandwidth available (${context.activeRunCount}/${context.concurrencyLimit} runs). Mind must pre-plan and open capsule for ${context.defectCount} pending defects in parallel.`,
      };
    }

    if (context.activeRunCount === 0 && context.defectCount === 0) {
      return {
        allowConcurrentPlanning: false,
        action: "TRIGGER_MODE_A_DISCOVERY",
        message: "No active runs and queue empty. Trigger Mode A Autonomous Discovery immediately.",
      };
    }

    return {
      allowConcurrentPlanning: false,
      action: "AWAIT_CONVERGENCE",
      message: "Concurrency limit reached. Supervise active wave convergence.",
    };
  }
}
