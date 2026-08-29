import { HarnessError } from "../../core/errors/index.ts";

export interface TimerProtectionCaller {
  readonly id: string;
  readonly role: string;
}

export interface TimerProtectionTarget {
  readonly id: string;
  readonly isSupervisory: boolean;
  readonly label?: string | undefined;
}

export class TimerProtectionGuard {
  public static assertCanKillTimer(
    caller: TimerProtectionCaller,
    timer: TimerProtectionTarget,
  ): void {
    if (timer.isSupervisory && caller.role !== "human_root") {
      const labelStr = timer.label ? ` (${timer.label})` : "";
      throw new HarnessError(
        "INVALID_STATE",
        `Permission Denied: Agent '${caller.id}' (${caller.role}) cannot kill protected supervisory timer '${timer.id}'${labelStr}. Supervisory heartbeats are immutable.`,
      );
    }
  }
}
