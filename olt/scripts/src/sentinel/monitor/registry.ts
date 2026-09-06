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
import { executeInstantInterjection, isPathInScope, isSupervisoryRole } from "./interjection.ts";
import {
  PROHIBITED_SUPERVISORY_TOOLS,
  type CreateMonitorOptions,
  type LiveStrategyMonitor,
  type SentinelMonitorDescriptor,
} from "./types.ts";

export type { CreateMonitorOptions, LiveStrategyMonitor, SentinelMonitorDescriptor };

const PROHIBITED_TOOL_SET = new Set<string>(PROHIBITED_SUPERVISORY_TOOLS);

export class LiveStrategyMonitorImpl implements LiveStrategyMonitor {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly transcriptPath: string;
  readonly targetWorktree?: string | undefined;
  readonly parentSupervisor?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly taskId?: string | undefined;

  private active: boolean = false;
  private timer?: ReturnType<typeof setInterval> | undefined;
  private watcher?: FSWatcher | undefined;
  private byteOffset: number = 0;
  private lineBuffer: string = "";
  private readonly pollIntervalMs: number;
  private readonly onStop?: (() => void) | undefined;

  constructor(options: CreateMonitorOptions) {
    this.agentId = options.agentId;
    this.role = options.role;
    this.transcriptPath = options.transcriptPath;
    this.targetWorktree = options.targetWorktree;
    this.parentSupervisor = options.parentSupervisor;
    this.repoRoot = options.repoRoot;
    this.writeScope = options.writeScope;
    this.taskId = options.taskId;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.byteOffset = options.initialOffset ?? 0;
    this.onStop = options.onStop;
  }

  isMonitoring(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.pollNow();
    this.timer = setInterval(() => this.pollNow(), this.pollIntervalMs);
    this.attachWatcher();
  }

  private attachWatcher(): void {
    if (this.watcher || !this.targetWorktree || !existsSync(this.targetWorktree)) return;
    try {
      this.watcher = watch(this.targetWorktree, { recursive: true }, (_e, file) => {
        if (!file || !this.writeScope || this.writeScope.length === 0) return;
        const norm = file.toString().replace(/\\/g, "/").replace(/^\.\//, "");
        if (norm.startsWith(".git/") || norm === ".git" || norm.startsWith(".olt/locks/")) return;
        if (!isPathInScope(norm, this.writeScope)) {
          const violation: SentinelViolation = {
            code: "OUT_OF_SCOPE_MUTATION",
            severity: "CRITICAL",
            message: `Agent '${this.agentId}' mutated '${norm}' outside write scope [${this.writeScope.join(", ")}]`,
            target_file: norm,
            remediation_cmd: "Confine mutations strictly to declared write_scope paths.",
          };
          this.triggerInterjection(violation);
        }
      });
    } catch {}
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
      this.watcher = undefined;
    }
    this.onStop?.();
    if (this.repoRoot) SentinelMonitorRegistry.getInstance().sync(this.repoRoot);
  }

  pollNow(): void {
    if (!existsSync(this.transcriptPath)) return;
    this.attachWatcher();
    try {
      const size = statSync(this.transcriptPath).size;
      if (size < this.byteOffset) this.byteOffset = 0;
      if (size <= this.byteOffset) return;
      const len = size - this.byteOffset;
      const fd = openSync(this.transcriptPath, "r");
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, this.byteOffset);
      closeSync(fd);
      this.byteOffset = size;
      this.processChunk(buf.toString("utf-8"));
    } catch {}
  }

  private processChunk(chunk: string): void {
    const combined = this.lineBuffer + chunk;
    const lines = combined.split("\n");
    this.lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const tools: string[] = [];
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (Array.isArray(parsed?.tool_calls)) {
          for (const tc of parsed.tool_calls as readonly Record<string, unknown>[]) {
            if (typeof tc?.name === "string") tools.push(tc.name);
          }
        }
        for (const k of ["tool", "tool_name", "name"]) {
          if (typeof parsed?.[k] === "string") tools.push(parsed[k] as string);
        }
      } catch {}

      if (tools.length === 0) {
        const re = /(?:call:\s*(?:default_api:)?|Tool Use:\s*|"name"\s*:\s*")([a-zA-Z0-9_-]+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(trimmed)) !== null) {
          if (m[1]) tools.push(m[1]);
        }
      }

      for (const t of tools) {
        if (PROHIBITED_TOOL_SET.has(t) && isSupervisoryRole(this.role)) {
          const violation: SentinelViolation = {
            code: "SUPERVISOR_PROHIBITED_TOOL_EXECUTION",
            severity: "CRITICAL",
            message: `Supervisory role '${this.role}' (${this.agentId}) invoked prohibited tool '${t}'. Supervisory roles are confined to coordination via invoke_subagent.`,
            remediation_cmd: "Dispatch Tier 3 Implementers via invoke_subagent.",
            documentation_ref:
              "docs/olt/architecture/15-state-schemas-and-event-ledger/15-04-state-json-and-mailbox-schemas.md",
          };
          this.triggerInterjection(violation);
          break;
        }
      }
    }
  }

  private triggerInterjection(violation: SentinelViolation): void {
    executeInstantInterjection(
      {
        agentId: this.agentId,
        role: this.role,
        taskId: this.taskId,
        repoRoot: this.repoRoot,
        parentSupervisor: this.parentSupervisor,
      },
      violation,
    );
  }
}

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
