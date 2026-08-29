import { categorizeDefect } from "../core/sanitizer.ts";
import type { AggregatedDefect, DefectRecordInput } from "../core/types.ts";
import type {
  DomainExecutionContext,
  DomainExecutionStatus,
  DomainExecutionTask,
  DomainTaskResult,
} from "./types.ts";

export async function executeDomainTask<TResult>(params: {
  readonly task: DomainExecutionTask<TResult>;
  readonly domain: string;
  readonly defaultTimeoutMs: number;
  readonly recordDefect: (
    input: DefectRecordInput,
    domain: string,
    taskId?: string,
  ) => AggregatedDefect;
}): Promise<DomainTaskResult<TResult>> {
  const { task, domain, defaultTimeoutMs, recordDefect } = params;
  const capturedDefects: AggregatedDefect[] = [];
  const abortController = new AbortController();
  const timeoutMs = task.timeoutMs ?? defaultTimeoutMs;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let isTimedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      isTimedOut = true;
      abortController.abort();
      reject(
        new Error(`Domain task ${task.id} in domain ${domain} timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
  });

  const context: DomainExecutionContext = {
    domain,
    taskId: task.id,
    taskName: task.name,
    signal: abortController.signal,
    emitDefect: (input: DefectRecordInput) => {
      const bl = recordDefect(input, domain, task.id);
      capturedDefects.push(bl);
      return bl;
    },
    log: (_msg: string) => {},
    metadata: task.metadata,
  };

  const startTime = Date.now();
  let retriesAttempted = 0;
  const retryLimit = task.retryLimit ?? 0;
  let finalResult: TResult | undefined;
  let finalError: unknown | undefined;
  let finalStatus: DomainExecutionStatus = "failed";

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    if (attempt > 0) retriesAttempted += 1;
    try {
      const result = await Promise.race([task.execute(context), timeoutPromise]);
      finalResult = result;
      finalStatus = "succeeded";
      finalError = undefined;
      break;
    } catch (err: unknown) {
      finalError = err;
      if (isTimedOut) {
        finalStatus = "timed_out";
        const defect: DefectRecordInput = {
          id: `defect-timeout-${task.id}`,
          type: "domain_task_timeout",
          severity: "high",
          category: "code_defect",
          observation: `Domain task ${task.name} (${task.id}) in domain ${domain} timed out after ${timeoutMs}ms`,
          remediation: "Increase timeout or optimize execution performance",
        };
        capturedDefects.push(recordDefect(defect, domain, task.id));
        break;
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      const autoDefect: DefectRecordInput = {
        id: `defect-exec-${task.id}-${attempt}`,
        type: "task_execution_failure",
        severity: "warning",
        category: categorizeDefect({ type: "task_execution_failure", observation: errorMessage }),
        observation: `Task execution failed in domain ${domain}: ${errorMessage}`,
        remediation: `Investigate root cause in domain ${domain} task ${task.name}`,
      };
      capturedDefects.push(recordDefect(autoDefect, domain, task.id));

      if (attempt < retryLimit && !abortController.signal.aborted) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }

  if (timeoutHandle !== null) clearTimeout(timeoutHandle);

  return {
    taskId: task.id,
    taskName: task.name,
    domain,
    status: finalStatus,
    result: finalResult,
    error: finalError,
    durationMs: Date.now() - startTime,
    defectsCaptured: capturedDefects,
    retryCount: retriesAttempted,
    timestamp: new Date().toISOString(),
  };
}
