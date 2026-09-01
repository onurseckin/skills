import { createDefaultRunnerStats, type RunnerStats, type StreamEvent } from "./types.ts";

export interface TerminalTickerOptions {
  readonly interactive?: boolean | undefined;
  readonly updateCadenceMs?: number | undefined;
  readonly stdout?: NodeJS.WritableStream | undefined;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  clearLine: "\r\x1b[2K",
} as const;

export function isInteractiveTerminal(options?: {
  readonly interactive?: boolean | undefined;
}): boolean {
  if (options?.interactive !== undefined) {
    return options.interactive;
  }
  if (process.env.CI === "1" || process.env.CI === "true" || process.env.TERM === "dumb") {
    return false;
  }
  return Boolean(process.stdout && process.stdout.isTTY);
}

export function formatElapsedSeconds(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, ms)}ms`;
  }
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

export class TerminalTicker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimeMs: number = 0;
  private frameIndex: number = 0;
  private isInteractive: boolean;
  private updateCadenceMs: number;
  private out: NodeJS.WritableStream;
  private lastStats: RunnerStats = createDefaultRunnerStats();
  private activeSuite: string | null = null;
  private stopped: boolean = false;

  constructor(options: TerminalTickerOptions = {}) {
    this.isInteractive = isInteractiveTerminal(options);
    this.updateCadenceMs = options.updateCadenceMs ?? 50;
    this.out = options.stdout ?? process.stdout;
  }

  public getIsInteractive(): boolean {
    return this.isInteractive;
  }

  public getStartTimeMs(): number {
    return this.startTimeMs;
  }

  public start(): void {
    this.startTimeMs = Date.now();
    this.stopped = false;
    if (this.isInteractive) {
      this.timer = setInterval(() => {
        this.render();
      }, this.updateCadenceMs);
      if (this.timer && typeof this.timer.unref === "function") {
        this.timer.unref();
      }
      this.render();
    }
  }

  public tick(stats?: RunnerStats, activeSuite?: string | null): void {
    if (stats) {
      this.lastStats = stats;
    }
    if (activeSuite !== undefined) {
      this.activeSuite = activeSuite;
    }
    if (this.isInteractive && !this.stopped) {
      this.render();
    }
  }

  public onStreamEvent(event: StreamEvent, stats: RunnerStats): void {
    this.lastStats = stats;
    if (event.type === "suite_start") {
      this.activeSuite = event.file;
      if (!this.isInteractive) {
        this.out.write(`[suite] ${event.file}\n`);
      }
    } else if (event.type === "test_fail") {
      if (!this.isInteractive) {
        this.out.write(`[fail] ${event.suite} > ${event.name}\n`);
      }
    }

    if (this.isInteractive && !this.stopped) {
      this.render();
    }
  }

  public render(): void {
    if (this.stopped || !this.isInteractive) {
      return;
    }

    const elapsedMs = Date.now() - this.startTimeMs;
    const spinner = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
    this.frameIndex++;

    const suiteDisplay = this.activeSuite ? this.activeSuite : "Initializing tests...";
    const line = `${ANSI.cyan}${spinner}${ANSI.reset} ${ANSI.bold}${suiteDisplay}${ANSI.reset} | ${ANSI.green}${this.lastStats.testsPassed} passed${ANSI.reset} | ${ANSI.red}${this.lastStats.testsFailed} failed${ANSI.reset} | ${ANSI.yellow}${this.lastStats.testsSkipped} skipped${ANSI.reset} | ${ANSI.dim}[${formatElapsedSeconds(elapsedMs)}]${ANSI.reset}`;

    this.out.write(ANSI.clearLine + line);
  }

  public clear(): void {
    if (this.isInteractive) {
      this.out.write(ANSI.clearLine);
    }
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopped = true;
    this.clear();
  }
}
