function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export interface LifecycleFinding {
  readonly code:
    | "PLANNING_BRAINSTORMING_SKIPPED"
    | "PLAN_VALIDATION_SKIPPED"
    | "UNVALIDATED_TASK_COMPLETED";
  readonly severity: "critical" | "warning";
  readonly description: string;
  readonly details?: Record<string, unknown>;
}

export interface LifecycleAuditSummary {
  readonly healthy: boolean;
  readonly findings: readonly LifecycleFinding[];
  readonly issues: readonly string[];
}

function getEventName(event: Record<string, unknown>): string {
  if (typeof event["name"] === "string") return event["name"];
  if (typeof event["kind"] === "string") return event["kind"];
  if (typeof event["type"] === "string") return event["type"];
  return "";
}

export class StateMachineAuditor {
  public static isPlanBrainstormed(events: readonly Record<string, unknown>[]): boolean {
    return events.some((event) => {
      const kind = getEventName(event);
      return (
        kind === "plan-brainstormed" ||
        kind === "plan:brainstorm" ||
        kind === "brainstormed" ||
        kind === "brainstorm"
      );
    });
  }

  public static isPlanValidationApproved(
    runState: Record<string, unknown>,
    events: readonly Record<string, unknown>[],
  ): boolean {
    if (isRecord(runState["plan_review"])) {
      const review = runState["plan_review"];
      if (review["status"] === "approved" || review["verdict"] === "approved") {
        return true;
      }
    }

    if (isRecord(runState["plan_validation"])) {
      const val = runState["plan_validation"];
      if (val["status"] === "approved" || val["verdict"] === "approved") {
        return true;
      }
    }

    return events.some((event) => {
      const kind = getEventName(event);
      if (
        kind === "plan-reviewed" ||
        kind === "plan:review" ||
        kind === "plan-validated" ||
        kind === "plan:validate" ||
        kind === "plan-validation"
      ) {
        if (event["status"] === "approved" || event["verdict"] === "approved") {
          return true;
        }
        if (isRecord(event["payload"])) {
          const payload = event["payload"];
          if (payload["status"] === "approved" || payload["verdict"] === "approved") {
            return true;
          }
        }
      }
      return false;
    });
  }

  public static isTaskValidationPassed(task: Record<string, unknown>): boolean {
    const rawValidations = task["validations"];
    if (!isArray(rawValidations) || rawValidations.length === 0) {
      return false;
    }

    let hasPassing = false;
    for (const item of rawValidations) {
      if (!isRecord(item)) return false;
      const verdict = item["verdict"];
      const status = item["status"];
      const isPass =
        verdict === "pass" ||
        verdict === "passed" ||
        verdict === "approved" ||
        status === "pass" ||
        status === "passed" ||
        status === "approved";

      const isFail =
        verdict === "fail" ||
        verdict === "failed" ||
        verdict === "changes_requested" ||
        verdict === "rejected" ||
        status === "fail" ||
        status === "failed" ||
        status === "rejected";

      if (isFail) {
        return false;
      }
      if (isPass) {
        hasPassing = true;
      }
    }

    if (!hasPassing) {
      return false;
    }

    if (isArray(task["findings"])) {
      for (const f of task["findings"]) {
        if (isRecord(f) && f["status"] === "open") {
          return false;
        }
      }
    }

    return true;
  }

  public static auditLifecycle(
    runState: Record<string, unknown>,
    events: readonly Record<string, unknown>[] = [],
  ): readonly LifecycleFinding[] {
    const findings: LifecycleFinding[] = [];

    const tasksObj = isRecord(runState["tasks"]) ? runState["tasks"] : undefined;
    const taskEntries = tasksObj ? Object.entries(tasksObj) : [];
    const planningTasks = isArray(runState["planning_tasks"]) ? runState["planning_tasks"] : [];
    const taskCount = taskEntries.length + planningTasks.length;

    const hasTaskEvents = events.some((event) => {
      const kind = getEventName(event);
      return (
        kind.startsWith("task-") ||
        kind.startsWith("task:") ||
        kind === "task_claimed" ||
        kind === "task_done" ||
        kind === "plan-applied" ||
        kind === "plan:apply"
      );
    });

    const tasksExistOrProgressed = taskCount > 0 || hasTaskEvents;

    const brainstormed = StateMachineAuditor.isPlanBrainstormed(events);
    if (tasksExistOrProgressed && !brainstormed) {
      findings.push({
        code: "PLANNING_BRAINSTORMING_SKIPPED",
        severity: "critical",
        description:
          "Tasks exist or have progressed in the lifecycle, but no plan-brainstormed event was recorded in the event stream.",
        details: {
          taskCount,
          eventCount: events.length,
        },
      });
    }

    const progressedStatuses = new Set([
      "leased",
      "running",
      "submitted",
      "validating",
      "validated",
      "done",
      "changes_requested",
      "retry_ready",
      "escalated",
      "gating",
      "branched",
    ]);

    const progressedTaskIds: string[] = [];
    for (const [id, taskVal] of taskEntries) {
      if (isRecord(taskVal)) {
        const status = typeof taskVal["status"] === "string" ? taskVal["status"] : "";
        if (
          progressedStatuses.has(status) ||
          taskVal["lease"] !== undefined ||
          taskVal["report"] !== undefined
        ) {
          progressedTaskIds.push(id);
        }
      }
    }

    const hasProgressedTaskEvents = events.some((event) => {
      const kind = getEventName(event);
      return (
        kind === "task-claimed" ||
        kind === "task:claim" ||
        kind === "task-submitted" ||
        kind === "task:submit" ||
        kind === "task-done" ||
        kind === "task:done" ||
        kind === "task-validated" ||
        kind === "task:validate"
      );
    });

    const tasksClaimedOrDone = progressedTaskIds.length > 0 || hasProgressedTaskEvents;
    const planValidationApproved = StateMachineAuditor.isPlanValidationApproved(runState, events);

    if (tasksClaimedOrDone && !planValidationApproved) {
      findings.push({
        code: "PLAN_VALIDATION_SKIPPED",
        severity: "critical",
        description:
          "Tasks were claimed, submitted, or completed without approved plan validation.",
        details: {
          progressedTaskCount: progressedTaskIds.length,
          progressedTaskIds,
        },
      });
    }

    for (const [id, taskVal] of taskEntries) {
      if (isRecord(taskVal)) {
        const status = taskVal["status"];
        if (status === "done") {
          const validated = StateMachineAuditor.isTaskValidationPassed(taskVal);
          if (!validated) {
            findings.push({
              code: "UNVALIDATED_TASK_COMPLETED",
              severity: "critical",
              description: `Task "${id}" was marked done without passing validations.`,
              details: {
                taskId: id,
                status: "done",
                validations:
                  (taskVal["validations"] as Record<string, unknown>[] | undefined) ?? [],
              },
            });
          }
        }
      }
    }

    return findings;
  }

  public static summarizeLifecycle(findings: readonly LifecycleFinding[]): LifecycleAuditSummary {
    const issues = findings.map((f) => `lifecycle: [${f.code}] ${f.description}`);
    return {
      healthy: findings.length === 0,
      findings,
      issues,
    };
  }
}
