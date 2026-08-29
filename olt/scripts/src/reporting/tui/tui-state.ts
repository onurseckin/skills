export type TuiViewMode =
  | "dashboard"
  | "dag"
  | "tasks"
  | "mailboxes"
  | "telemetry"
  | "help";

export interface TuiTaskItem {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly role: string;
  readonly effort: number;
}

export interface TuiState {
  readonly viewMode: TuiViewMode;
  readonly previousViewMode?: TuiViewMode | undefined;
  readonly cursorIndex: number;
  readonly scrollOffset: number;
  readonly selectedItemId?: string | undefined;
  readonly isPaused: boolean;
  readonly searchFilter: string;
  readonly searchActive: boolean;
  readonly terminalWidth: number;
  readonly terminalHeight: number;
  readonly tasks: readonly TuiTaskItem[];
  readonly totalWork: number;
  readonly criticalSpan: number;
  readonly activeLanes: number;
}

export type StateListener = (state: TuiState) => void;

export class TuiStateStore {
  private state: TuiState;
  private readonly listeners: Set<StateListener> = new Set();

  constructor(initialState?: Partial<TuiState>) {
    this.state = {
      viewMode: initialState?.viewMode ?? "dashboard",
      cursorIndex: initialState?.cursorIndex ?? 0,
      scrollOffset: initialState?.scrollOffset ?? 0,
      isPaused: initialState?.isPaused ?? false,
      searchFilter: initialState?.searchFilter ?? "",
      searchActive: initialState?.searchActive ?? false,
      terminalWidth: initialState?.terminalWidth ?? 80,
      terminalHeight: initialState?.terminalHeight ?? 24,
      tasks: initialState?.tasks ?? [],
      totalWork: initialState?.totalWork ?? 0,
      criticalSpan: initialState?.criticalSpan ?? 0,
      activeLanes: initialState?.activeLanes ?? 1,
      ...initialState,
    };
  }

  public getState(): TuiState {
    return this.state;
  }

  public setState(updater: Partial<TuiState> | ((prev: TuiState) => TuiState)): void {
    const nextState = typeof updater === "function" ? updater(this.state) : { ...this.state, ...updater };
    this.state = nextState;
    this.notify();
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setViewMode(mode: TuiViewMode): void {
    if (this.state.viewMode === mode) return;
    this.setState({
      previousViewMode: this.state.viewMode,
      viewMode: mode,
      cursorIndex: 0,
      scrollOffset: 0,
    });
  }

  public toggleHelp(): void {
    if (this.state.viewMode === "help") {
      this.setState({
        viewMode: this.state.previousViewMode ?? "dashboard",
      });
    } else {
      this.setState({
        previousViewMode: this.state.viewMode,
        viewMode: "help",
      });
    }
  }

  public togglePause(): void {
    this.setState((prev) => ({ ...prev, isPaused: !prev.isPaused }));
  }

  public moveCursor(delta: number, maxItems?: number): void {
    const max = maxItems !== undefined ? maxItems : Math.max(0, this.state.tasks.length - 1);
    const newIndex = Math.max(0, Math.min(max, this.state.cursorIndex + delta));
    let newScroll = this.state.scrollOffset;
    const viewHeight = Math.max(5, this.state.terminalHeight - 8);

    if (newIndex < newScroll) {
      newScroll = newIndex;
    } else if (newIndex >= newScroll + viewHeight) {
      newScroll = newIndex - viewHeight + 1;
    }

    const selectedItem = this.state.tasks[newIndex];
    this.setState({
      cursorIndex: newIndex,
      scrollOffset: newScroll,
      selectedItemId: selectedItem?.id,
    });
  }

  public resize(width: number, height: number): void {
    this.setState({
      terminalWidth: Math.max(20, width),
      terminalHeight: Math.max(10, height),
    });
  }

  public setSearchFilter(filter: string): void {
    this.setState({
      searchFilter: filter,
      cursorIndex: 0,
      scrollOffset: 0,
    });
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
      }
    }
  }
}
