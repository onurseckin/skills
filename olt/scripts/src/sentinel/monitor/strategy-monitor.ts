import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
  watch,
  type FSWatcher,
} from "node:fs";
import type { AgentRole, SentinelViolation } from "../index.ts";
import {
  evaluateTranscriptLine,
  executeInstantInterjection,
  isPathInScope,
} from "./interjection.ts";
import type { CreateMonitorOptions, LiveStrategyMonitor } from "./types.ts";
import { SentinelMonitorRegistry } from "./registry.ts";

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
  private isStopped: boolean = false;
  private timer?: ReturnType<typeof setInterval> | undefined;
  private watcher?: FSWatcher | undefined;
  private byteOffset: number = 0;
  private lineBuffer: string = "";
  private readonly pollIntervalMs: number;
  private readonly onStop?: (() => void) | undefined;
  public onLineParsed?: ((line: string) => void) | undefined;

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
    this.isStopped = false;
    this.active = true;
    this.pollNow();
    this.timer = setInterval(() => this.pollNow(), this.pollIntervalMs);
    this.attachWatcher();
  }

  private attachWatcher(): void {
    if (
      this.isStopped ||
      !this.active ||
      this.watcher ||
      !this.targetWorktree ||
      !existsSync(this.targetWorktree)
    )
      return;
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
    this.isStopped = true;
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
    if (this.isStopped || !existsSync(this.transcriptPath)) return;
    if (this.active) this.attachWatcher();
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
      if (!line.trim()) continue;

      if (this.onLineParsed) {
        try {
          this.onLineParsed(line);
        } catch {}
      }

      const violation = evaluateTranscriptLine(line, {
        agentId: this.agentId,
        role: this.role,
        targetWorktree: this.targetWorktree,
        writeScope: this.writeScope,
      });
      if (violation) {
        this.triggerInterjection(violation);
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
