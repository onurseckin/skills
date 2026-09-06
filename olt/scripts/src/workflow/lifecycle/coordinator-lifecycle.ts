import { HarnessError } from "../../core/errors/index.ts";

const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set(["done", "cancelled", "escalated"]);
const IN_PROGRESS_TASK_STATUSES: ReadonlySet<string> = new Set([
  "claimed",
  "leased",
  "running",
  "validating",
  "gating",
  "submitted",
]);
const LEASE_STATUSES: ReadonlySet<string> = new Set(["leased", "claimed", "running", "gating"]);
const VALIDATION_STATUSES: ReadonlySet<string> = new Set(["validating", "submitted"]);
const IDLE_TRANSITIONS: ReadonlySet<string> = new Set(["idle", "sleep", "pause"]);
const RELEASE_TRANSITIONS: ReadonlySet<string> = new Set(["release", "agent:release"]);
const POLL_TRANSITIONS: ReadonlySet<string> = new Set(["poll", "msg:poll"]);
const PERMITTED_POLLING_COMMANDS: ReadonlySet<string> = new Set([
  "msg:poll",
  "msg:recv",
  "msg:send",
  "task:heartbeat",
]);

interface TaskValidationInfo {
  readonly validator_id?: string | undefined;
  readonly domain?: string | undefined;
  readonly verdict?: "pass" | "probe" | "reject" | string | undefined;
  readonly attempt?: number | undefined;
}

interface TaskLeaseInfo {
  readonly agent_id?: string | undefined;
  readonly role?: string | undefined;
  readonly expires_at?: string | undefined;
  readonly issued_at?: string | undefined;
  readonly token_digest?: string | undefined;
}

interface TaskLifecycleInfo {
  readonly id: string;
  readonly status: string;
  readonly lease?: TaskLeaseInfo | null | undefined;
  readonly validations?: readonly TaskValidationInfo[] | null | undefined;
  readonly original_implementer?: string | undefined;
  readonly assigned_agent?: string | undefined;
}

interface CoordinatorLifecycleOptions {
  readonly coordinatorId: string;
  readonly role?: string | undefined;
  readonly action?: string | undefined;
  readonly currentCommand?: string | undefined;
  readonly tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>;
  readonly waveId?: number | string | undefined;
  readonly mailboxMessagesCount?: number | undefined;
  readonly hasPolledMailbox?: boolean | undefined;
}

function normalizeTaskList(
  tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
): readonly TaskLifecycleInfo[] {
  return Array.isArray(tasks) ? tasks : Object.values(tasks);
}

function isTaskTerminal(task: TaskLifecycleInfo): boolean {
  return TERMINAL_TASK_STATUSES.has(task.status.toLowerCase());
}

function hasActiveLease(task: TaskLifecycleInfo): boolean {
  if (task.lease !== undefined && task.lease !== null) return true;
  return LEASE_STATUSES.has(task.status.toLowerCase());
}

function hasActiveValidations(task: TaskLifecycleInfo): boolean {
  if (Array.isArray(task.validations) && task.validations.length > 0) {
    const hasUnresolved = task.validations.some((v) => {
      if (v.verdict === undefined) return true;
      if (v.verdict === null) return true;
      return v.verdict === "";
    });
    if (hasUnresolved) return true;
  }
  return VALIDATION_STATUSES.has(task.status.toLowerCase());
}

function isTaskInProgress(task: TaskLifecycleInfo): boolean {
  if (isTaskTerminal(task)) return false;
  if (hasActiveLease(task)) return true;
  if (hasActiveValidations(task)) return true;
  return IN_PROGRESS_TASK_STATUSES.has(task.status.toLowerCase());
}

function getActiveChildTasks(
  tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
  _coordinatorId?: string,
): readonly TaskLifecycleInfo[] {
  const list = normalizeTaskList(tasks);
  return list.filter((task) => isTaskInProgress(task));
}

function hasActiveChildTasks(
  tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
  coordinatorId?: string,
): boolean {
  return getActiveChildTasks(tasks, coordinatorId).length > 0;
}

function isWaveTerminal(
  tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
): boolean {
  const list = normalizeTaskList(tasks);
  if (list.length === 0) return true;
  return list.every((task) => isTaskTerminal(task));
}

function assertCoordinatorCanIdle(options: CoordinatorLifecycleOptions): void {
  const activeTasks = getActiveChildTasks(options.tasks, options.coordinatorId);
  if (activeTasks.length > 0) {
    const activeIds = activeTasks.map((t) => t.id);
    throw new HarnessError(
      "ROLE_BOUNDARY_DEVIATION",
      `Coordinator '${options.coordinatorId}' cannot transition to idle while child tasks have active leases or validations (ROLE_BOUNDARY_DEVIATION): [${activeIds.join(", ")}]. Coordinators must maintain active supervision and reactive mailbox polling (msg:poll) until terminal wave state.`,
      [{ coordinatorId: options.coordinatorId, activeTasks: activeIds }],
      3,
      "Execute msg:poll to supervise running child tasks until all wave tasks reach terminal state.",
    );
  }
}

function assertCoordinatorCanRelease(options: CoordinatorLifecycleOptions): void {
  const activeTasks = getActiveChildTasks(options.tasks, options.coordinatorId);
  if (activeTasks.length > 0) {
    const activeIds = activeTasks.map((t) => t.id);
    throw new HarnessError(
      "INVALID_STATE",
      `Coordinator '${options.coordinatorId}' cannot release grant while child tasks have active leases or validations (INVALID_STATE): [${activeIds.join(", ")}]. Release is strictly forbidden until all child tasks complete.`,
      [{ coordinatorId: options.coordinatorId, activeTasks: activeIds }],
      3,
      "Wait for active leases and validations to complete, polling via msg:poll.",
    );
  }

  if (!isWaveTerminal(options.tasks)) {
    const nonTerminal = normalizeTaskList(options.tasks)
      .filter((t) => !isTaskTerminal(t))
      .map((t) => t.id);
    throw new HarnessError(
      "INVALID_STATE",
      `Coordinator '${options.coordinatorId}' cannot release grant before all wave tasks reach terminal state (INVALID_STATE: done, cancelled, escalated). Incomplete tasks: [${nonTerminal.join(", ")}].`,
      [{ coordinatorId: options.coordinatorId, nonTerminalTasks: nonTerminal }],
      3,
      "Supervise remaining wave tasks until terminal state before releasing coordinator grant.",
    );
  }
}

function resolveAttemptedAction(options: CoordinatorLifecycleOptions): string {
  if (typeof options.action === "string" && options.action.trim() !== "") {
    return options.action.trim().toLowerCase();
  }
  if (typeof options.currentCommand === "string" && options.currentCommand.trim() !== "") {
    return options.currentCommand.trim().toLowerCase();
  }
  return "";
}

function assertReactiveMailboxPolling(options: CoordinatorLifecycleOptions): void {
  if (isWaveTerminal(options.tasks)) return;

  const attempted = resolveAttemptedAction(options);
  const normalizedCmd = attempted.replace(/^bun\s+(?:\.\/)?(?:olt\/scripts\/)?harness\.ts\s+/u, "");

  if (attempted !== "" && !PERMITTED_POLLING_COMMANDS.has(normalizedCmd)) {
    const activeTasks = getActiveChildTasks(options.tasks, options.coordinatorId).map((t) => t.id);
    const actionLabel =
      options.action !== undefined && options.action !== null
        ? options.action
        : options.currentCommand;
    throw new HarnessError(
      "ROLE_BOUNDARY_DEVIATION",
      `Coordinator '${options.coordinatorId}' must maintain reactive mailbox polling (msg:poll) until the wave reaches terminal state (ROLE_BOUNDARY_DEVIATION). Action '${String(actionLabel)}' is forbidden while child tasks are in flight: [${activeTasks.join(", ")}].`,
      [{ coordinatorId: options.coordinatorId, attemptedAction: attempted, activeTasks }],
      3,
      "Run `bun harness.ts msg:poll` to receive worker updates and maintain reactive event loop.",
    );
  }

  if (options.hasPolledMailbox === false) {
    throw new HarnessError(
      "ROLE_BOUNDARY_DEVIATION",
      `Coordinator '${options.coordinatorId}' failed reactive mailbox polling mandate (ROLE_BOUNDARY_DEVIATION). Mailbox polling (msg:poll) is required while wave is non-terminal.`,
      [{ coordinatorId: options.coordinatorId }],
      3,
      "Execute `bun harness.ts msg:poll` to check for task completion or escalation messages.",
    );
  }
}

function validateCoordinatorLifecycleTransition(
  transition: string,
  options: CoordinatorLifecycleOptions,
): void {
  const norm = transition.trim().toLowerCase();
  if (IDLE_TRANSITIONS.has(norm)) {
    assertCoordinatorCanIdle(options);
    assertReactiveMailboxPolling({ ...options, action: transition });
    return;
  }
  if (RELEASE_TRANSITIONS.has(norm)) {
    assertCoordinatorCanRelease(options);
    return;
  }
  if (POLL_TRANSITIONS.has(norm)) return;
  assertReactiveMailboxPolling({ ...options, action: transition });
}

class CoordinatorLifecycleGuard {
  private readonly coordinatorId: string;

  constructor(coordinatorId: string) {
    this.coordinatorId = coordinatorId;
  }

  public assertCanIdle(
    tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
  ): void {
    assertCoordinatorCanIdle({ coordinatorId: this.coordinatorId, tasks });
  }

  public assertCanRelease(
    tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
  ): void {
    assertCoordinatorCanRelease({ coordinatorId: this.coordinatorId, tasks });
  }

  public assertReactiveMailboxPolling(
    tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
    currentCommand?: string,
  ): void {
    assertReactiveMailboxPolling({ coordinatorId: this.coordinatorId, tasks, currentCommand });
  }

  public isWaveTerminal(
    tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
  ): boolean {
    return isWaveTerminal(tasks);
  }

  public getActiveChildTasks(
    tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
  ): readonly TaskLifecycleInfo[] {
    return getActiveChildTasks(tasks, this.coordinatorId);
  }

  public validateTransition(
    transition: string,
    tasks: readonly TaskLifecycleInfo[] | Readonly<Record<string, TaskLifecycleInfo>>,
  ): void {
    validateCoordinatorLifecycleTransition(transition, {
      coordinatorId: this.coordinatorId,
      tasks,
      action: transition,
    });
  }
}

export {
  CoordinatorLifecycleGuard,
  IN_PROGRESS_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  assertCoordinatorCanIdle,
  assertCoordinatorCanRelease,
  assertReactiveMailboxPolling,
  getActiveChildTasks,
  hasActiveChildTasks,
  hasActiveLease,
  hasActiveValidations,
  isTaskInProgress,
  isTaskTerminal,
  isWaveTerminal,
  validateCoordinatorLifecycleTransition,
  type CoordinatorLifecycleOptions,
  type TaskLeaseInfo,
  type TaskLifecycleInfo,
  type TaskValidationInfo,
};
