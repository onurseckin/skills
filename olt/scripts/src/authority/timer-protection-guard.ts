import { HarnessError } from "../core/errors/index.ts";

export interface TimerRecord {
  readonly id: string;
  readonly isSupervisory: boolean;
  readonly label: string;
}

export interface AgentGrantRecord {
  readonly id: string;
  readonly role: string;
}

export class TimerProtectionGuard {
  public static assertCanKillTimer(caller: AgentGrantRecord, timer: TimerRecord): void {
    if (timer.isSupervisory && caller.role !== "human_root") {
      throw new HarnessError(
        "INVALID_STATE",
        `Permission Denied: Agent '${caller.id}' (${caller.role}) cannot kill protected supervisory timer '${timer.id}' (${timer.label}). Supervisory heartbeats are immutable.`,
      );
    }
  }
}
