import { HarnessError } from "../../core/errors/index.ts";

export interface TimerProtectionCaller {
  readonly id: string;
  readonly role: string;
  readonly token?: string | undefined;
  readonly isVerified?: boolean | undefined;
}

export interface TimerProtectionTarget {
  readonly id: string;
  readonly isSupervisory: boolean;
  readonly label?: string | undefined;
}

export class TimerProtectionGuard {
  public constructor() {}

  public static canKillTimer(caller: TimerProtectionCaller, timer: TimerProtectionTarget): boolean {
    if (!timer.isSupervisory) {
      return true;
    }
    if (caller.role !== "human_root") {
      return false;
    }
    if (caller.isVerified === false) {
      return false;
    }
    return true;
  }

  public static assertCanKillTimer(
    caller: TimerProtectionCaller,
    timer: TimerProtectionTarget,
  ): void {
    if (!this.canKillTimer(caller, timer)) {
      const labelStr = timer.label ? ` (${timer.label})` : "";
      throw new HarnessError(
        "INVALID_STATE",
        `Permission Denied: Agent '${caller.id}' (${caller.role}) cannot kill protected supervisory timer '${timer.id}'${labelStr}. Supervisory heartbeats are immutable.`,
      );
    }
  }
}
