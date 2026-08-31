import { DoubleBufferedCanvas } from "./canvas-diff.ts";
import { parseKeySequence } from "./key-parser.ts";
import { KeyDispatcher, type KeyBinding } from "./keybindings.ts";
import { ReactiveRenderLoop, type RenderLoopOptions } from "./render-loop.ts";
import { StreamMultiplexer, type MultiplexerOptions } from "./stream-multiplexer.ts";
import type { StreamSource } from "./stream-sources.ts";
import { TuiStateStore, type TuiState, type TuiViewMode } from "./tui-state.ts";
import {
  renderDashboardOverview,
  renderFooterView,
  renderHeaderView,
  renderHelpOverlay,
  renderMailboxStreamView,
  renderTaskMatrixView,
  renderTelemetryStreamView,
} from "./views.ts";

export interface TuiControllerOptions {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly renderOptions?: RenderLoopOptions | undefined;
  readonly muxOptions?: MultiplexerOptions | undefined;
  readonly onExit?: (() => void) | undefined;
}

export class TuiController {
  private readonly stateStore: TuiStateStore;
  private readonly canvas: DoubleBufferedCanvas;
  private readonly dispatcher: KeyDispatcher;
  private readonly multiplexer: StreamMultiplexer;
  private readonly renderLoop: ReactiveRenderLoop;
  private readonly onExit?: (() => void) | undefined;

  constructor(options?: TuiControllerOptions) {
    const width = options?.width ?? 80;
    const height = options?.height ?? 24;

    this.onExit = options?.onExit;
    this.stateStore = new TuiStateStore({
      terminalWidth: width,
      terminalHeight: height,
    });
    this.canvas = new DoubleBufferedCanvas(width, height);
    this.dispatcher = new KeyDispatcher();
    this.multiplexer = new StreamMultiplexer(options?.muxOptions);

    this.renderLoop = new ReactiveRenderLoop(() => {
      this.renderFrame();
    }, options?.renderOptions);

    this.setupKeyBindings();
    this.setupStateSubscriptions();
  }

  public start(): void {
    this.renderLoop.start();
    this.renderLoop.requestRender(true);
  }

  public stop(): void {
    this.renderLoop.stop();
  }

  public handleInput(chunk: Uint8Array | string): void {
    const strokes = parseKeySequence(chunk);
    for (const s of strokes) {
      this.dispatcher.dispatch(s);
    }
  }

  public attachSource(source: StreamSource): void {
    this.multiplexer.registerSource(source);
    this.renderLoop.markDirty();
  }

  public pushEvent<T>(channel: string, payload: T, actor = "system", kind = "custom"): void {
    this.multiplexer.pushEvent(channel, payload, actor, kind);
    if (!this.stateStore.getState().isPaused) {
      this.renderLoop.markDirty();
    }
  }

  public pollStreams(): void {
    this.multiplexer.pollSources();
    if (!this.stateStore.getState().isPaused) {
      this.renderLoop.markDirty();
    }
  }

  public resize(width: number, height: number): void {
    this.canvas.resize(width, height);
    this.stateStore.resize(width, height);
    this.renderLoop.markDirty();
  }

  public getState(): TuiState {
    return this.stateStore.getState();
  }

  public getStateStore(): TuiStateStore {
    return this.stateStore;
  }

  public getCanvas(): DoubleBufferedCanvas {
    return this.canvas;
  }

  public getMultiplexer(): StreamMultiplexer {
    return this.multiplexer;
  }

  public getDispatcher(): KeyDispatcher {
    return this.dispatcher;
  }

  public renderFrame(): string {
    const state = this.stateStore.getState();
    this.canvas.clear();

    renderHeaderView(state, this.canvas);

    const allEvents = this.multiplexer.getEvents();

    if (state.viewMode === "help") {
      renderHelpOverlay(this.canvas);
    } else if (state.viewMode === "tasks") {
      renderTaskMatrixView(state, this.canvas);
    } else if (state.viewMode === "mailboxes") {
      renderMailboxStreamView(state, allEvents, this.canvas);
    } else if (state.viewMode === "telemetry") {
      renderTelemetryStreamView(state, allEvents, this.canvas);
    } else {
      renderDashboardOverview(state, allEvents, this.canvas);
    }

    renderFooterView(state, this.canvas);

    return this.canvas.renderAnsiDiff();
  }

  private setupKeyBindings(): void {
    this.dispatcher.addHandler((binding: KeyBinding) => {
      switch (binding.action) {
        case "navigate_up":
          this.stateStore.moveCursor(-1);
          break;
        case "navigate_down":
          this.stateStore.moveCursor(1);
          break;
        case "switch_view":
          if (binding.targetView) {
            this.stateStore.setViewMode(binding.targetView as TuiViewMode);
          }
          break;
        case "toggle_pause":
          this.stateStore.togglePause();
          break;
        case "toggle_help":
          this.stateStore.toggleHelp();
          break;
        case "quit":
          this.stop();
          this.onExit?.();
          break;
        default:
          break;
      }
      this.renderLoop.markDirty();
    });
  }

  private setupStateSubscriptions(): void {
    this.stateStore.subscribe(() => {
      this.renderLoop.markDirty();
    });
  }
}
