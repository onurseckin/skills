export interface LookaheadDirective {
  readonly allowConcurrentPlanning: boolean;
  readonly action: "PRE_PLAN_NEXT_CAPSULE" | "TRIGGER_MODE_A_DISCOVERY" | "AWAIT_CONVERGENCE";
  readonly message: string;
}

export class MindConcurrentLookaheadPipeline {
  public static computeNextActions(options: {
    activeRunCount: number;
    defectCount: number;
    concurrencyLimit: number;
  }): LookaheadDirective {
    if (options.activeRunCount === 0 && options.defectCount === 0) {
      return {
        allowConcurrentPlanning: false,
        action: "TRIGGER_MODE_A_DISCOVERY",
        message: "Active queue and runs empty; triggering Mode A Autonomous Discovery",
      };
    }
    if (options.activeRunCount >= options.concurrencyLimit) {
      return {
        allowConcurrentPlanning: false,
        action: "AWAIT_CONVERGENCE",
        message: `Concurrency limit reached (${options.activeRunCount}/${options.concurrencyLimit}); awaiting wave completion`,
      };
    }
    if (options.activeRunCount < options.concurrencyLimit && options.defectCount > 0) {
      return {
        allowConcurrentPlanning: true,
        action: "PRE_PLAN_NEXT_CAPSULE",
        message: "Concurrent bandwidth available; pre-planning next capsule",
      };
    }
    return {
      allowConcurrentPlanning: false,
      action: "AWAIT_CONVERGENCE",
      message: "Execution capacity reached or waiting for active wave convergence",
    };
  }
}
