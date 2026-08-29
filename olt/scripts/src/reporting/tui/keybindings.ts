import type { KeyStroke, SpecialKey } from "./key-parser.ts";

export type KeyActionType =
  | "navigate_up"
  | "navigate_down"
  | "navigate_left"
  | "navigate_right"
  | "page_up"
  | "page_down"
  | "home"
  | "end"
  | "switch_view"
  | "toggle_pause"
  | "toggle_help"
  | "search"
  | "filter"
  | "select"
  | "quit"
  | "custom";

export interface KeyBinding {
  readonly key?: string | undefined;
  readonly special?: SpecialKey | undefined;
  readonly ctrl?: boolean | undefined;
  readonly alt?: boolean | undefined;
  readonly shift?: boolean | undefined;
  readonly action: KeyActionType;
  readonly targetView?: string | undefined;
  readonly customActionId?: string | undefined;
  readonly description: string;
  readonly mode?: string | undefined;
}

export type KeyActionHandler = (action: KeyBinding, stroke: KeyStroke) => void;

export class KeyBindingRegistry {
  private readonly bindings: KeyBinding[] = [];

  constructor(initialBindings?: readonly KeyBinding[]) {
    if (initialBindings) {
      for (const b of initialBindings) {
        this.register(b);
      }
    } else {
      this.loadDefaults();
    }
  }

  public register(binding: KeyBinding): void {
    this.bindings.push(binding);
  }

  public unregister(action: KeyActionType, key?: string): void {
    const idx = this.bindings.findIndex(
      (b) => b.action === action && (key === undefined || b.key === key),
    );
    if (idx !== -1) {
      this.bindings.splice(idx, 1);
    }
  }

  public resolve(stroke: KeyStroke, currentMode = "normal"): KeyBinding | undefined {
    return this.bindings.find((b) => {
      const modeMatch = !b.mode || b.mode === currentMode;
      if (!modeMatch) return false;

      const ctrlMatch = Boolean(b.ctrl) === stroke.ctrl;
      const altMatch = Boolean(b.alt) === stroke.alt;
      const shiftMatch = Boolean(b.shift) === stroke.shift;

      if (!ctrlMatch || !altMatch || !shiftMatch) return false;

      if (b.special !== undefined && stroke.special !== undefined) {
        return b.special === stroke.special;
      }

      if (b.key !== undefined && stroke.char !== "") {
        return b.key.toLowerCase() === stroke.char.toLowerCase();
      }

      return false;
    });
  }

  public getBindings(): readonly KeyBinding[] {
    return [...this.bindings];
  }

  public getBindingsForMode(mode: string): readonly KeyBinding[] {
    return this.bindings.filter((b) => !b.mode || b.mode === mode);
  }

  private loadDefaults(): void {
    this.register({ special: "up", action: "navigate_up", description: "Move selection up" });
    this.register({ key: "k", action: "navigate_up", description: "Move selection up (vim)" });
    this.register({ special: "down", action: "navigate_down", description: "Move selection down" });
    this.register({ key: "j", action: "navigate_down", description: "Move selection down (vim)" });
    this.register({ special: "left", action: "navigate_left", description: "Pan left" });
    this.register({ key: "h", action: "navigate_left", description: "Pan left (vim)" });
    this.register({ special: "right", action: "navigate_right", description: "Pan right" });
    this.register({ key: "l", action: "navigate_right", description: "Pan right (vim)" });
    this.register({ special: "page_up", action: "page_up", description: "Page up" });
    this.register({ special: "page_down", action: "page_down", description: "Page down" });
    this.register({ special: "home", action: "home", description: "Jump to start" });
    this.register({ special: "end", action: "end", description: "Jump to end" });
    this.register({
      key: "1",
      action: "switch_view",
      targetView: "dashboard",
      description: "Dashboard view",
    });
    this.register({ key: "2", action: "switch_view", targetView: "dag", description: "DAG view" });
    this.register({
      key: "3",
      action: "switch_view",
      targetView: "tasks",
      description: "Task matrix view",
    });
    this.register({
      key: "4",
      action: "switch_view",
      targetView: "mailboxes",
      description: "Mailbox stream view",
    });
    this.register({
      key: "5",
      action: "switch_view",
      targetView: "telemetry",
      description: "Telemetry stream view",
    });
    this.register({ key: "p", action: "toggle_pause", description: "Pause/Resume live feed" });
    this.register({ key: "?", action: "toggle_help", description: "Toggle help overlay" });
    this.register({ key: "/", action: "search", description: "Search / filter tasks" });
    this.register({ special: "enter", action: "select", description: "Select / expand item" });
    this.register({ special: "space", action: "select", description: "Select / expand item" });
    this.register({ key: "q", action: "quit", description: "Exit TUI" });
    this.register({ key: "c", ctrl: true, action: "quit", description: "Force quit" });
  }
}

export class KeyDispatcher {
  private readonly registry: KeyBindingRegistry;
  private readonly handlers: KeyActionHandler[] = [];

  constructor(registry?: KeyBindingRegistry) {
    this.registry = registry ?? new KeyBindingRegistry();
  }

  public getRegistry(): KeyBindingRegistry {
    return this.registry;
  }

  public addHandler(handler: KeyActionHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) {
        this.handlers.splice(idx, 1);
      }
    };
  }

  public dispatch(stroke: KeyStroke, currentMode = "normal"): boolean {
    const binding = this.registry.resolve(stroke, currentMode);
    if (!binding) {
      return false;
    }
    for (const h of this.handlers) {
      h(binding, stroke);
    }
    return true;
  }
}
