import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { join, resolve } from "node:path";
import type { AgentRole, SentinelViolation } from "../index.ts";
import { LiveStrategyMonitorImpl } from "./strategy-monitor.ts";
export { LiveStrategyMonitorImpl };
import type {
  CreateMonitorOptions,
  LiveStrategyMonitor,
  SentinelMonitorDescriptor,
} from "./types.ts";

export type { CreateMonitorOptions, LiveStrategyMonitor, SentinelMonitorDescriptor };

export class SentinelMonitorRegistry {
  private static instance?: SentinelMonitorRegistry;
  private readonly monitors = new Map<string, LiveStrategyMonitor>();
  private defaultRepoRoot?: string;

  public static getInstance(): SentinelMonitorRegistry {
    return (SentinelMonitorRegistry.instance ??= new SentinelMonitorRegistry());
  }

  public static register(monitor: LiveStrategyMonitor | CreateMonitorOptions): LiveStrategyMonitor {
    return SentinelMonitorRegistry.getInstance().register(monitor);
  }

  public static get(agentId: string): LiveStrategyMonitor | undefined {
    return SentinelMonitorRegistry.getInstance().get(agentId);
  }

  public static list(): readonly LiveStrategyMonitor[] {
    return SentinelMonitorRegistry.getInstance().list();
  }

  public static unregister(agentId: string): void {
    SentinelMonitorRegistry.getInstance().unregister(agentId);
  }

  public static stopAll(): void {
    SentinelMonitorRegistry.getInstance().stopAll();
  }

  public register(monitor: LiveStrategyMonitor | CreateMonitorOptions): LiveStrategyMonitor {
    let instance: LiveStrategyMonitor;
    if ("isMonitoring" in monitor && typeof monitor.isMonitoring === "function") {
      instance = monitor;
    } else {
      const createOpts: CreateMonitorOptions = monitor;
      const existingForAgent = this.monitors.get(createOpts.agentId);
      if (existingForAgent && existingForAgent.isMonitoring()) return existingForAgent;
      const opts: CreateMonitorOptions = {
        ...createOpts,
        onStop: () => this.sync(createOpts.repoRoot),
      };
      instance = new LiveStrategyMonitorImpl(opts);
      if (createOpts.autoStart !== false) instance.start();
    }

    const existing = this.monitors.get(instance.agentId);
    if (existing && existing !== instance) existing.stop();

    this.monitors.set(instance.agentId, instance);
    if (instance.repoRoot) this.defaultRepoRoot = instance.repoRoot;
    this.sync(instance.repoRoot);
    return instance;
  }

  public get(agentId: string): LiveStrategyMonitor | undefined {
    return this.monitors.get(agentId);
  }

  public list(): readonly LiveStrategyMonitor[] {
    return Array.from(this.monitors.values());
  }

  public unregister(agentId: string): void {
    const existing = this.monitors.get(agentId);
    if (existing) {
      existing.stop();
      this.monitors.delete(agentId);
      this.sync(existing.repoRoot);
    }
  }

  public stopAll(): void {
    for (const monitor of this.monitors.values()) monitor.stop();
    this.monitors.clear();
    this.sync();
  }

  public sync(repoRoot?: string): void {
    const root = repoRoot ?? this.defaultRepoRoot;
    if (!root) return;
    const oltDir = join(resolve(root), ".olt");
    if (!existsSync(oltDir)) {
      try {
        mkdirSync(oltDir, { recursive: true });
      } catch {}
    }
    const descriptors: SentinelMonitorDescriptor[] = this.list().map((m) => ({
      agentId: m.agentId,
      role: m.role,
      transcriptPath: m.transcriptPath,
      targetWorktree: m.targetWorktree,
      parentSupervisor: m.parentSupervisor,
      repoRoot: m.repoRoot,
      writeScope: m.writeScope,
      isMonitoring: m.isMonitoring(),
    }));
    try {
      writeFileSync(
        join(oltDir, "sentinel-monitors.json"),
        JSON.stringify(descriptors, null, 2),
        "utf-8",
      );
    } catch {}
  }
}
