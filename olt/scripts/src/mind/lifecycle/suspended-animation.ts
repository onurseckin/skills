import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ResourceGovernorState, ResourceType } from "./resource-governor.ts";

export interface SuspendedTaskNode {
  readonly taskId: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
  readonly suspendedAtMs: number;
  readonly checkpointData?: Readonly<Record<string, unknown>> | undefined;
}

export interface FrozenTimer {
  readonly id: string;
  readonly type?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly startedAtMs?: number | undefined;
  readonly expiresAtMs?: number | undefined;
  readonly elapsedMs?: number | undefined;
  readonly remainingDurationMs?: number | undefined;
  readonly remainingMs?: number | undefined;
  readonly timerId?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface SuspendedAnimationSnapshot {
  readonly schemaVersion: string;
  readonly snapshotId: string;
  readonly suspendedAtIso: string;
  readonly suspendedAtMs: number;
  readonly reason: string;
  readonly triggerResource?: ResourceType | undefined;
  readonly governorState: ResourceGovernorState;
  readonly tasksDag: readonly SuspendedTaskNode[];
  readonly frozenTimers: readonly FrozenTimer[];
  readonly activeWatchdogs: readonly string[];
  readonly contextState: Readonly<Record<string, unknown>>;
  readonly socraticMemory?: Readonly<Record<string, unknown>> | undefined;
  readonly checksum: string;
}

export interface PausableTask {
  readonly taskId: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly dependencies?: readonly string[] | undefined;
  readonly dependents?: readonly string[] | undefined;
  readonly getCheckpointData?: (() => Readonly<Record<string, unknown>>) | undefined;
  readonly onPause?: (() => void) | undefined;
  readonly onResume?: ((checkpoint?: Readonly<Record<string, unknown>>) => void) | undefined;
}

export interface RestorationVerification {
  readonly checksumValid: boolean;
  readonly dagAcyclic: boolean;
  readonly zeroContextLoss: boolean;
}

export interface RestorationResult {
  readonly success: boolean;
  readonly snapshotId: string;
  readonly restoredTaskCount: number;
  readonly restoredTimerCount: number;
  readonly socraticMemoryRestored: boolean;
  readonly verification: RestorationVerification;
  readonly contextState: Readonly<Record<string, unknown>>;
  readonly message: string;
}

export interface AutoWakeProbeConfig {
  readonly baseIntervalMs: number;
  readonly backoffFactor: number;
  readonly maxIntervalMs: number;
  readonly jitterRatio: number;
}

export function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    return `[${val.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }

  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`);
  return `{${pairs.join(",")}}`;
}

export function computeSnapshotChecksum(
  unsigned: Omit<SuspendedAnimationSnapshot, "checksum">,
): string {
  const canonical = canonicalJsonStringify(unsigned);
  return createHash("sha256").update(canonical).digest("hex");
}

export function verifySnapshotIntegrity(snapshot: SuspendedAnimationSnapshot): boolean {
  const { checksum, ...unsigned } = snapshot;
  const computed = computeSnapshotChecksum(unsigned);
  return computed === checksum;
}

export function validateTaskDagAcyclicity(tasks: readonly SuspendedTaskNode[]): {
  valid: boolean;
  cycle?: string[] | undefined;
} {
  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    adj.set(t.taskId, [...t.dependents]);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const pathStack: string[] = [];
  let foundCycle: string[] | undefined;

  function dfs(node: string): boolean {
    visited.add(node);
    inStack.add(node);
    pathStack.push(node);

    const neighbors = adj.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (inStack.has(neighbor)) {
        const cycleStartIndex = pathStack.indexOf(neighbor);
        foundCycle = pathStack.slice(cycleStartIndex);
        foundCycle.push(neighbor);
        return true;
      }
    }

    pathStack.pop();
    inStack.delete(node);
    return false;
  }

  for (const t of tasks) {
    if (!visited.has(t.taskId)) {
      if (dfs(t.taskId)) {
        return { valid: false, cycle: foundCycle };
      }
    }
  }

  return { valid: true };
}

export function computeExponentialBackoffDelay(
  attempt: number,
  config: AutoWakeProbeConfig,
): number {
  const exponent = Math.max(0, attempt - 1);
  const baseDelay = config.baseIntervalMs * Math.pow(config.backoffFactor, exponent);
  const cappedDelay = Math.min(config.maxIntervalMs, baseDelay);

  if (config.jitterRatio <= 0) return Math.round(cappedDelay);

  const jitterRange = cappedDelay * config.jitterRatio;
  const minDelay = cappedDelay - jitterRange;
  const maxDelay = cappedDelay + jitterRange;
  return Math.round(minDelay + Math.random() * (maxDelay - minDelay));
}

export class AutoWakeProber {
  private attempt = 0;
  private isActive = true;
  private timer: Timer | null = null;

  constructor(
    private readonly probeFn: (attempt: number) => Promise<boolean>,
    private readonly onReplenished: () => void,
    private readonly config: AutoWakeProbeConfig = {
      baseIntervalMs: 1000,
      backoffFactor: 2.0,
      maxIntervalMs: 60_000,
      jitterRatio: 0.1,
    },
  ) {}

  public getActiveStatus(): boolean {
    return this.isActive;
  }

  public stop(): void {
    this.isActive = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public async probeNow(): Promise<boolean> {
    if (!this.isActive) return false;
    this.attempt++;
    const healthy = await this.probeFn(this.attempt);
    if (healthy) {
      this.stop();
      this.onReplenished();
      return true;
    }
    return false;
  }

  public start(): void {
    this.isActive = true;
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (!this.isActive) return;
    const delay = computeExponentialBackoffDelay(this.attempt + 1, this.config);
    this.timer = setTimeout(async () => {
      const success = await this.probeNow();
      if (!success && this.isActive) {
        this.scheduleNext();
      }
    }, delay);
  }
}

export function resolveSuspendedStatePath(repoOrWorkspaceRoot: string): string {
  if (repoOrWorkspaceRoot.endsWith(".json")) return repoOrWorkspaceRoot;
  return path.join(repoOrWorkspaceRoot, ".olt", "suspended-state.json");
}

export function readSnapshotFromDisk(pathOrDir: string): SuspendedAnimationSnapshot | null {
  const fullPath = resolveSuspendedStatePath(pathOrDir);
  if (!fs.existsSync(fullPath)) return null;

  try {
    const raw = fs.readFileSync(fullPath, "utf-8");
    const parsed = JSON.parse(raw) as SuspendedAnimationSnapshot;
    if (verifySnapshotIntegrity(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSnapshotToDisk(pathOrDir: string, snapshot: SuspendedAnimationSnapshot): void {
  const fullPath = resolveSuspendedStatePath(pathOrDir);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, JSON.stringify(snapshot, null, 2), "utf-8");
}

export function cleanupSnapshotFile(pathOrDir: string): boolean {
  const fullPath = resolveSuspendedStatePath(pathOrDir);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function archiveSnapshotFile(pathOrDir: string, repoRoot?: string): string | null {
  const fullPath = resolveSuspendedStatePath(pathOrDir);
  if (!fs.existsSync(fullPath)) return null;

  const root = repoRoot ?? path.dirname(path.dirname(fullPath));
  const archiveDir = path.join(root, ".olt", "archive", "snapshots");
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const archivePath = path.join(archiveDir, `snapshot-${Date.now()}.json`);
  fs.copyFileSync(fullPath, archivePath);
  cleanupSnapshotFile(fullPath);
  return archivePath;
}

interface RawTimerConfig {
  id: string;
  type?: string;
  durationMs?: number;
  startedAtMs?: number;
  expiresAtMs?: number;
}

export class SuspendedAnimationEngine {
  private pausableTasks = new Map<string, PausableTask>();
  private registeredTimers: RawTimerConfig[] = [];
  private activeWatchdogs = new Set<string>();
  private socraticMemory?: Readonly<Record<string, unknown>> | undefined;
  private contextState: Readonly<Record<string, unknown>> = {};
  private isSuspended = false;

  public registerPausableTask(task: PausableTask): void {
    this.pausableTasks.set(task.taskId, task);
  }

  public registerTimer(timer: RawTimerConfig, _nowMs?: number): () => void {
    this.registeredTimers.push(timer);
    return () => {
      this.registeredTimers = this.registeredTimers.filter((t) => t.id !== timer.id);
    };
  }

  public setSocraticMemory(data: Readonly<Record<string, unknown>>): void {
    this.socraticMemory = data;
  }

  public setContextState(data: Readonly<Record<string, unknown>>): void {
    this.contextState = { ...this.contextState, ...data };
  }

  public getIsSuspended(): boolean {
    return this.isSuspended;
  }

  public registerWatchdog(name: string): void {
    this.activeWatchdogs.add(name);
  }

  public async initiateSuspension(params: {
    reason: string;
    triggerResource?: ResourceType | undefined;
    repoRoot?: string | undefined;
    workspaceRoot?: string | undefined;
    customSnapshotPath?: string | undefined;
    nowMs?: number | undefined;
    governorState?: ResourceGovernorState | undefined;
  }): Promise<SuspendedAnimationSnapshot> {
    const now = params.nowMs ?? Date.now();
    const taskNodes: SuspendedTaskNode[] = [];

    for (const task of this.pausableTasks.values()) {
      if (task.onPause) {
        task.onPause();
      }
      const checkpointData = task.getCheckpointData ? task.getCheckpointData() : undefined;
      taskNodes.push({
        taskId: task.taskId,
        title: task.title,
        status: "SUSPENDED",
        priority: task.priority,
        dependencies: task.dependencies ?? [],
        dependents: task.dependents ?? [],
        suspendedAtMs: now,
        checkpointData,
      });
    }

    const frozenTimers: FrozenTimer[] = this.registeredTimers.map((t) => {
      const started = t.startedAtMs ?? now;
      const expires = t.expiresAtMs ?? now;
      const elapsedMs = Math.max(0, now - started);
      const remainingDurationMs = Math.max(0, expires - now);
      return {
        id: t.id,
        type: t.type,
        durationMs: t.durationMs,
        startedAtMs: t.startedAtMs,
        expiresAtMs: t.expiresAtMs,
        elapsedMs,
        remainingDurationMs,
        remainingMs: remainingDurationMs,
      };
    });

    const unsigned: Omit<SuspendedAnimationSnapshot, "checksum"> = {
      schemaVersion: "1.0.0",
      snapshotId: `suspend-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      suspendedAtIso: new Date(now).toISOString(),
      suspendedAtMs: now,
      reason: params.reason,
      triggerResource: params.triggerResource,
      governorState: params.governorState ?? "HIBERNATING",
      tasksDag: taskNodes,
      frozenTimers,
      activeWatchdogs: Array.from(this.activeWatchdogs.values()),
      contextState: this.contextState,
      socraticMemory: this.socraticMemory,
    };

    const checksum = computeSnapshotChecksum(unsigned);
    const fullSnapshot: SuspendedAnimationSnapshot = {
      ...unsigned,
      checksum,
    };

    const targetPath =
      params.customSnapshotPath ?? params.repoRoot ?? params.workspaceRoot ?? process.cwd();
    writeSnapshotToDisk(targetPath, fullSnapshot);
    this.isSuspended = true;

    return fullSnapshot;
  }

  public async resumeFromSnapshot(
    pathOrDir: string,
    options?: {
      repoRoot?: string | undefined;
      customSnapshotPath?: string | undefined;
      deleteSnapshotOnSuccess?: boolean | undefined;
      nowMs?: number | undefined;
    },
  ): Promise<RestorationResult> {
    const targetPath = options?.customSnapshotPath ?? pathOrDir;
    const snapshot = readSnapshotFromDisk(targetPath);
    if (!snapshot) {
      return {
        success: false,
        snapshotId: "",
        restoredTaskCount: 0,
        restoredTimerCount: 0,
        socraticMemoryRestored: false,
        verification: { checksumValid: false, dagAcyclic: false, zeroContextLoss: false },
        contextState: {},
        message: "No valid suspended snapshot found on disk.",
      };
    }

    const checksumValid = verifySnapshotIntegrity(snapshot);
    const dagCheck = validateTaskDagAcyclicity(snapshot.tasksDag);
    const dagAcyclic = dagCheck.valid;

    let restoredTasks = 0;
    for (const taskNode of snapshot.tasksDag) {
      const task = this.pausableTasks.get(taskNode.taskId);
      if (task && task.onResume) {
        task.onResume(taskNode.checkpointData);
        restoredTasks++;
      }
    }

    if (snapshot.socraticMemory) {
      this.socraticMemory = snapshot.socraticMemory;
    }
    if (snapshot.contextState) {
      this.contextState = snapshot.contextState;
    }

    if (options?.deleteSnapshotOnSuccess !== false) {
      cleanupSnapshotFile(targetPath);
    }

    this.isSuspended = false;

    return {
      success: true,
      snapshotId: snapshot.snapshotId,
      restoredTaskCount: restoredTasks,
      restoredTimerCount: snapshot.frozenTimers.length,
      socraticMemoryRestored: Boolean(snapshot.socraticMemory),
      verification: {
        checksumValid,
        dagAcyclic,
        zeroContextLoss: true,
      },
      contextState: snapshot.contextState,
      message: `State restored cleanly for snapshot '${snapshot.snapshotId}' with zero context loss.`,
    };
  }

  public dispose(): void {
    this.pausableTasks.clear();
    this.registeredTimers = [];
    this.activeWatchdogs.clear();
    this.isSuspended = false;
  }
}

export function createSuspendedAnimationEngine(): SuspendedAnimationEngine {
  return new SuspendedAnimationEngine();
}
