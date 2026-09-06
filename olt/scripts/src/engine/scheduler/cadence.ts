import { HarnessError } from "../../core/errors/index.ts";

export const DEFAULT_SUPERVISORY_CRON = "*/5 * * * *";
export const ANTIGRAVITY_SCHEDULE_TOOL = "schedule";
export const STAGNATION_IDLE_THRESHOLD_SECONDS = 120;

export const SUPERVISORY_ROLES: readonly string[] = Object.freeze([
  "mind",
  "orchestrator",
  "coordinator",
  "mind_supervisor",
  "autonomic_watchdog",
]);

export function isSupervisoryCadenceRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return SUPERVISORY_ROLES.some((r) => r === normalized);
}

export interface FloorLoopCommandOptions {
  readonly intervalSeconds?: number | undefined;
  readonly agentId?: string | undefined;
  readonly role?: string | undefined;
  readonly logPath?: string | undefined;
}

export function buildFloorLoopCommand(
  command: string,
  options: FloorLoopCommandOptions = {},
): string {
  const trimmedCmd = command.trim();
  if (trimmedCmd.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Command string must not be empty");
  }
  const intervalSeconds = options.intervalSeconds ?? 300;
  if (intervalSeconds <= 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Interval seconds must be greater than 0");
  }
  const execUnit = options.logPath
    ? `(${trimmedCmd}) >> ${options.logPath.trim()} 2>&1 || true`
    : `(${trimmedCmd}) || true`;
  return `while true; do ${execUnit}; sleep ${intervalSeconds}; done`;
}

export interface FloorLoopStepResult<T> {
  readonly iteration: number;
  readonly success: boolean;
  readonly value?: T | undefined;
  readonly error?: string | undefined;
}

export async function executeFloorLoopStep<T>(
  stepFn: () => Promise<T> | T,
  iteration: number = 1,
): Promise<FloorLoopStepResult<T>> {
  try {
    const value = await stepFn();
    return { iteration, success: true, value };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { iteration, success: false, error: message };
  }
}

export interface FloorLoopDriverOptions {
  readonly maxIterations?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly onError?: ((error: string, iteration: number) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface FloorLoopDriverResult<T> {
  readonly totalIterations: number;
  readonly successfulIterations: number;
  readonly failedIterations: number;
  readonly steps: readonly FloorLoopStepResult<T>[];
  readonly aborted: boolean;
}

export async function executeFloorLoop<T>(
  stepFn: (iteration: number) => Promise<T> | T,
  options: FloorLoopDriverOptions = {},
): Promise<FloorLoopDriverResult<T>> {
  const maxIterations = options.maxIterations ?? 1;
  const steps: FloorLoopStepResult<T>[] = [];
  let successfulIterations = 0;
  let failedIterations = 0;
  let aborted = false;

  for (let i = 1; i <= maxIterations; i++) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }
    const stepResult = await executeFloorLoopStep(() => stepFn(i), i);
    steps.push(stepResult);
    if (stepResult.success) {
      successfulIterations++;
    } else {
      failedIterations++;
      if (options.onError && stepResult.error !== undefined) {
        options.onError(stepResult.error, i);
      }
    }
    if (i < maxIterations && options.intervalMs !== undefined && options.intervalMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, options.intervalMs));
    }
  }

  return {
    totalIterations: steps.length,
    successfulIterations,
    failedIterations,
    steps: Object.freeze(steps),
    aborted,
  };
}

export interface HostCronParameters {
  readonly CronExpression: string;
  readonly Prompt: string;
  readonly MaxIterations?: number | undefined;
}

export interface HostCronRegistration {
  readonly tool: typeof ANTIGRAVITY_SCHEDULE_TOOL;
  readonly parameters: HostCronParameters;
  readonly host: string;
  readonly role: string;
  readonly registered: boolean;
  readonly dispatched: boolean;
}

export interface TurnStartContext {
  readonly role: string;
  readonly agentId?: string | undefined;
  readonly host: string;
  readonly prompt?: string | undefined;
  readonly cronExpression?: string | undefined;
  readonly idleDurationSeconds?: number | undefined;
}

export function registerHostCronSchedule(
  context: TurnStartContext,
  dispatcher?: (tool: string, parameters: Record<string, unknown>) => unknown,
): HostCronRegistration {
  const isAntigravity = context.host.trim().toLowerCase() === "antigravity";
  const cronExpr = context.cronExpression ?? DEFAULT_SUPERVISORY_CRON;
  const role = context.role.trim().toLowerCase();
  const prompt =
    context.prompt ??
    `Execute supervisory cadence pulse for role '${role}' and inspect execution topology.`;

  const parameters: HostCronParameters = { CronExpression: cronExpr, Prompt: prompt };
  let dispatched = false;
  if (isAntigravity && typeof dispatcher === "function") {
    dispatcher(ANTIGRAVITY_SCHEDULE_TOOL, {
      CronExpression: parameters.CronExpression,
      Prompt: parameters.Prompt,
    });
    dispatched = true;
  }

  return {
    tool: ANTIGRAVITY_SCHEDULE_TOOL,
    parameters,
    host: context.host,
    role,
    registered: isAntigravity,
    dispatched,
  };
}

export interface StagnationAutoWakePayload {
  readonly type: "auto_wake_injection";
  readonly alert: string;
  readonly role: string;
  readonly agentId: string;
  readonly idleDurationSeconds: number;
  readonly thresholdSeconds: number;
  readonly promptDirective: string;
  readonly timestamp: string;
}

export interface StagnationWatchdogEvaluation {
  readonly idleDurationSeconds: number;
  readonly thresholdSeconds: number;
  readonly isStagnant: boolean;
  readonly autoWakeInjected: boolean;
  readonly injectionPayload?: StagnationAutoWakePayload | undefined;
}

export interface StagnationWatchdogOptions {
  readonly idleDurationSeconds: number;
  readonly role: string;
  readonly agentId?: string | undefined;
  readonly thresholdSeconds?: number | undefined;
  readonly now?: string | undefined;
}

export function evaluateStagnationWatchdog(
  options: StagnationWatchdogOptions,
): StagnationWatchdogEvaluation {
  const thresholdSeconds = options.thresholdSeconds ?? STAGNATION_IDLE_THRESHOLD_SECONDS;
  const idle = Math.max(0, options.idleDurationSeconds);
  const isStagnant = idle > thresholdSeconds;
  const role = options.role.trim().toLowerCase();
  const agentId = options.agentId ?? `agent-${role}`;
  const now = options.now ?? new Date().toISOString();

  if (!isStagnant) {
    return {
      idleDurationSeconds: idle,
      thresholdSeconds,
      isStagnant: false,
      autoWakeInjected: false,
    };
  }

  const alert = `CRITICAL SUPERVISORY ALERT: Live Stagnation Detected (>${thresholdSeconds}s Idle)`;
  const directive = `[LIVE_STAGNATION_WAKEUP_INJECTION] Idle duration of ${idle}s exceeds the ${thresholdSeconds}s inactivity ceiling. Enforce active DAG progression, recover stale leases, and dispatch ready tasks immediately.`;

  const injectionPayload: StagnationAutoWakePayload = {
    type: "auto_wake_injection",
    alert,
    role,
    agentId,
    idleDurationSeconds: idle,
    thresholdSeconds,
    promptDirective: directive,
    timestamp: now,
  };

  return {
    idleDurationSeconds: idle,
    thresholdSeconds,
    isStagnant: true,
    autoWakeInjected: true,
    injectionPayload,
  };
}

export function formatStagnationAutoWakePrompt(payload: StagnationAutoWakePayload): string {
  return [
    `[LIVE_STAGNATION_WAKEUP_INJECTION]`,
    `================================================================================`,
    payload.alert,
    `Role: ${payload.role} | Agent: ${payload.agentId} | Idle Duration: ${payload.idleDurationSeconds}s (Threshold: ${payload.thresholdSeconds}s)`,
    `Timestamp: ${payload.timestamp}`,
    `================================================================================`,
    payload.promptDirective,
    `================================================================================`,
    `Execute supervisory cadence recovery immediately.`,
  ].join("\n");
}

export interface TurnStartCadenceResult {
  readonly cronRegistration: HostCronRegistration;
  readonly stagnationEvaluation: StagnationWatchdogEvaluation;
  readonly autoWakeDirective?: string | undefined;
}

export function handleTurnStartCadence(
  context: TurnStartContext,
  dispatcher?: (tool: string, parameters: Record<string, unknown>) => unknown,
): TurnStartCadenceResult {
  const cronRegistration = registerHostCronSchedule(context, dispatcher);
  const stagnationEvaluation = evaluateStagnationWatchdog({
    idleDurationSeconds: context.idleDurationSeconds ?? 0,
    role: context.role,
    agentId: context.agentId,
  });

  const autoWakeDirective = stagnationEvaluation.injectionPayload
    ? formatStagnationAutoWakePrompt(stagnationEvaluation.injectionPayload)
    : undefined;

  return { cronRegistration, stagnationEvaluation, autoWakeDirective };
}

export {
  buildFloorLoopCommand as generateFloorLoopCommand,
  executeFloorLoop as runFloorLoop,
  executeFloorLoopStep as runFloorLoopStep,
};
