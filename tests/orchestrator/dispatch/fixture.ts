import type { DispatchLogEvent } from "../../../olt/scripts/src/orchestrator/dispatch-log.ts";

export function createSampleDispatchLogEvent(overrides: Partial<DispatchLogEvent> = {}): DispatchLogEvent {
  return {
    kind: "supervisor-dispatch-outcome",
    payload: {
      task_id: "T-sample-dispatch",
      outcome: "dispatched",
      agent_id: "agent-sample",
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}
