import { HarnessError } from "../errors/harness-error.ts";
import {
  trackerDependencies,
  type TrackerDependencies,
} from "./descendant-tracker-dependencies.ts";
import { MIN_POLL_DELAY_MS, nextPollDelayMs } from "./descendant-poll-policy.ts";
import {
  sameProcessIdentity,
  type ProcessIdentity,
  type ProcessTopology,
} from "./process-identity.ts";
import { ancestry, matchesTopology } from "./process-tree.ts";
import { expandDescendants, liveTrackedParents } from "./descendant-topology.ts";

export type { ProcessIdentity } from "./process-identity.ts";

export class DescendantTracker {
  private readonly tracked = new Map<number, ProcessIdentity>();
  private readonly protectedPids = new Set<number>();
  private readonly deliveredSignals = new Map<NodeJS.Signals, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pollDelayMs = MIN_POLL_DELAY_MS;
  private active: Promise<void> | undefined;
  private failure: unknown;
  private rootIdentity: ProcessIdentity | undefined;
  private readonly dependencies: Required<TrackerDependencies>;

  public constructor(
    private readonly rootPid: number,
    _pipeAnchors: ReadonlySet<bigint> = new Set(),
    private readonly ownershipToken = "",
    dependencies: TrackerDependencies = {},
  ) {
    this.dependencies = trackerDependencies(dependencies, _pipeAnchors);
  }

  public async start(): Promise<ProcessIdentity | undefined> {
    await this.refresh(false, true);
    if (this.rootIdentity) {
      this.pollDelayMs = MIN_POLL_DELAY_MS;
      this.scheduleNextPoll();
    }
    return this.rootIdentity ? { ...this.rootIdentity } : undefined;
  }

  public async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.active;
    if (this.failure) throw this.failure;
    await this.refresh(true);
    if (this.failure) throw this.failure;
  }

  private scheduleNextPoll(): void {
    this.timer = setTimeout(() => void this.poll(), this.pollDelayMs);
    this.timer.unref();
  }

  private async poll(): Promise<void> {
    const trackedBefore = this.tracked.size;
    await this.refresh().catch(() => undefined);
    if (this.timer === undefined) return;
    this.pollDelayMs = nextPollDelayMs(this.pollDelayMs, this.tracked.size > trackedBefore);
    this.scheduleNextPoll();
  }

  public async terminate(
    graceMs: number,
    onSignal?: (signal: NodeJS.Signals) => void,
  ): Promise<NodeJS.Signals[]> {
    const identities = [...this.tracked.values()];
    const signals: NodeJS.Signals[] = [];
    const termDelivered = await this.signalAll(identities, "SIGTERM", onSignal);
    if (termDelivered) signals.push("SIGTERM");
    if (!termDelivered && !this.wasDeliveredToAny(identities, "SIGTERM")) return signals;
    await new Promise((resolve) => setTimeout(resolve, graceMs));
    if (await this.signalAll(identities, "SIGKILL", onSignal)) signals.push("SIGKILL");
    return signals;
  }

  public async proveAbsent(): Promise<boolean> {
    await this.refresh(true);
    if (this.failure) throw this.failure;
    return [...this.tracked.values()].every(
      (identity) => this.dependencies.probe(identity) === "absent",
    );
  }

  private refresh(includePipeOwners = false, initial = false): Promise<void> {
    if (this.active) return this.active;
    this.active = this.capture(includePipeOwners, initial).finally(() => {
      this.active = undefined;
    });
    return this.active;
  }

  private async capture(includePipeOwners: boolean, initial: boolean): Promise<void> {
    try {
      const processes = await this.dependencies.snapshot();
      if (initial) this.captureRoot(processes);
      const protectedNow = new Set([
        ...this.protectedPids,
        ...ancestry(processes, this.dependencies.runnerPid),
      ]);
      const liveParents = liveTrackedParents(
        this.rootPid,
        this.rootIdentity,
        this.tracked,
        processes,
        this.dependencies.identify,
        this.dependencies.runnerPid,
      );
      expandDescendants(
        this.rootPid,
        protectedNow,
        liveParents,
        processes,
        this.tracked,
        this.dependencies.identify,
      );
      if (includePipeOwners) this.captureOwners(protectedNow);
    } catch (error) {
      this.failure ??= error;
      throw error;
    }
  }

  private captureRoot(processes: ReadonlyMap<number, ProcessTopology>): void {
    for (const pid of ancestry(processes, this.dependencies.runnerPid)) this.protectedPids.add(pid);
    const topology = processes.get(this.rootPid);
    const root = this.dependencies.identify(this.rootPid);
    if (!root) return;
    if (!matchesTopology(root, topology))
      throw new HarnessError("INVALID_STATE", "cannot bind command root process identity");
    if (root.parent !== this.dependencies.runnerPid)
      throw new HarnessError("INVALID_STATE", "command root is not a direct child of the runner");
    if (root.group !== root.pid)
      throw new HarnessError("INVALID_STATE", "command root is not its own process group leader");
    this.rootIdentity = root;
  }

  private captureOwners(protectedNow: ReadonlySet<number>): void {
    for (const expected of this.dependencies.tokenOwners(this.ownershipToken)) {
      if (expected.pid === this.rootPid || protectedNow.has(expected.pid)) continue;
      const current = this.dependencies.identify(expected.pid);
      if (!current) continue;
      if (!sameProcessIdentity(expected, current))
        throw new HarnessError(
          "INVALID_STATE",
          `ownership-token process identity changed during scan for pid ${expected.pid}`,
        );
      this.tracked.set(expected.pid, current);
    }
  }

  private async signalAll(
    identities: ProcessIdentity[],
    name: NodeJS.Signals,
    onSignal?: (signal: NodeJS.Signals) => void,
  ): Promise<boolean> {
    const processes = await this.dependencies.snapshot();
    const protectedNow = new Set([
      ...this.protectedPids,
      ...ancestry(processes, this.dependencies.runnerPid),
    ]);
    let sent = false;
    const delivered = this.deliveredSignals.get(name) ?? new Set<string>();
    this.deliveredSignals.set(name, delivered);
    for (const expected of identities) {
      const identityKey = `${expected.pid}:${expected.birth}`;
      if (delivered.has(identityKey)) continue;
      if (protectedNow.has(expected.pid)) continue;
      const current = this.dependencies.identify(expected.pid);
      if (!sameProcessIdentity(expected, current)) continue;
      try {
        this.dependencies.kill(expected.pid, name);
        delivered.add(identityKey);
        onSignal?.(name);
        sent = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") continue;
        if (code === "EPERM")
          throw new HarnessError(
            "INVALID_STATE",
            `permission refused while signaling tracked process ${expected.pid}`,
          );
        throw error;
      }
    }
    return sent;
  }

  private wasDeliveredToAny(
    identities: readonly ProcessIdentity[],
    signal: NodeJS.Signals,
  ): boolean {
    const delivered = this.deliveredSignals.get(signal);
    return Boolean(
      delivered &&
      identities.some((identity) => delivered.has(`${identity.pid}:${identity.birth}`)),
    );
  }
}
