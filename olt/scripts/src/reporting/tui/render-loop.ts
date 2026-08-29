export type RenderCallback = (deltaTimeMs: number) => void;

export interface RenderLoopOptions {
  readonly targetFps?: number | undefined;
  readonly maxFps?: number | undefined;
  readonly autoSleepWhenClean?: boolean | undefined;
}

export class ReactiveRenderLoop {
  private readonly callback: RenderCallback;
  private readonly targetFps: number;
  private readonly frameIntervalMs: number;
  private readonly autoSleep: boolean;

  private isRunningState = false;
  private isDirty = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderTimestamp = 0;
  private frameCount = 0;
  private currentFps = 0;
  private fpsWindowStart = 0;

  constructor(callback: RenderCallback, options?: RenderLoopOptions) {
    this.callback = callback;
    this.targetFps = Math.max(1, Math.min(60, options?.targetFps ?? 20));
    this.frameIntervalMs = Math.floor(1000 / this.targetFps);
    this.autoSleep = options?.autoSleepWhenClean ?? true;
  }

  public start(): void {
    if (this.isRunningState) {
      return;
    }
    this.isRunningState = true;
    this.isDirty = true;
    this.lastRenderTimestamp = performance.now();
    this.fpsWindowStart = performance.now();
    this.frameCount = 0;
    this.scheduleNextTick(0);
  }

  public stop(): void {
    this.isRunningState = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public isRunning(): boolean {
    return this.isRunningState;
  }

  public markDirty(): void {
    this.isDirty = true;
    if (this.isRunningState && this.timer === null) {
      this.scheduleNextTick(0);
    }
  }

  public requestRender(immediate = false): void {
    this.markDirty();
    if (immediate && this.isRunningState) {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.tick();
    }
  }

  public getFps(): number {
    return this.currentFps;
  }

  public getTargetFps(): number {
    return this.targetFps;
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.isRunningState) {
      return;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, Math.max(0, delayMs));
  }

  private tick(): void {
    if (!this.isRunningState) {
      return;
    }

    const now = performance.now();
    const delta = now - this.lastRenderTimestamp;

    if (this.isDirty) {
      this.isDirty = false;
      this.lastRenderTimestamp = now;
      this.callback(delta);

      this.frameCount += 1;
      const fpsElapsed = now - this.fpsWindowStart;
      if (fpsElapsed >= 1000) {
        this.currentFps = Math.round((this.frameCount * 1000) / fpsElapsed);
        this.frameCount = 0;
        this.fpsWindowStart = now;
      }
    } else if (this.autoSleep) {
      return;
    }

    const nextDelay = Math.max(1, this.frameIntervalMs - (performance.now() - now));
    this.scheduleNextTick(nextDelay);
  }
}
