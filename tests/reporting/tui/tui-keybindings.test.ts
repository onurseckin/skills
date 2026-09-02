import { describe, expect, it } from "bun:test";
import type { KeyStroke } from "../../../olt/scripts/src/reporting/tui/key-parser.ts";
import {
  KeyBindingRegistry,
  KeyDispatcher,
  type KeyBinding,
} from "../../../olt/scripts/src/reporting/tui/keybindings.ts";

describe("TUI Keybindings Engine Coverage (keybindings.ts)", () => {
  describe("KeyBindingRegistry initialization and querying", () => {
    it("loads default keybindings when constructed without arguments", () => {
      const registry = new KeyBindingRegistry();
      const bindings = registry.getBindings();
      expect(bindings.length).toBeGreaterThan(15);

      const vimUp = bindings.find((b) => b.key === "k" && b.action === "navigate_up");
      expect(vimUp).toBeDefined();

      const quitCtrl = bindings.find(
        (b) => b.key === "c" && b.ctrl === true && b.action === "quit",
      );
      expect(quitCtrl).toBeDefined();
    });

    it("registers custom initial bindings and filters by mode", () => {
      const initial: KeyBinding[] = [
        { key: "i", action: "custom", mode: "normal", description: "Enter insert" },
        { special: "escape", action: "custom", mode: "insert", description: "Back to normal" },
        { key: "g", action: "home", description: "Global home" },
      ];
      const registry = new KeyBindingRegistry(initial);

      expect(registry.getBindings().length).toBe(3);
      expect(registry.getBindingsForMode("normal").length).toBe(2); // "i" and "g"
      expect(registry.getBindingsForMode("insert").length).toBe(2); // "escape" and "g"
      expect(registry.getBindingsForMode("search").length).toBe(1); // "g" only
    });

    it("registers and unregisters keybindings with and without key specifier", () => {
      const registry = new KeyBindingRegistry([]);
      const b1: KeyBinding = { key: "a", action: "select", description: "Select A" };
      const b2: KeyBinding = { key: "b", action: "select", description: "Select B" };
      const b3: KeyBinding = { key: "c", action: "toggle_pause", description: "Pause" };

      registry.register(b1);
      registry.register(b2);
      registry.register(b3);
      expect(registry.getBindings().length).toBe(3);

      // Unregister non-existent action does nothing
      registry.unregister("quit");
      expect(registry.getBindings().length).toBe(3);

      // Unregister specific key
      registry.unregister("select", "a");
      expect(registry.getBindings().length).toBe(2);
      expect(registry.getBindings().find((b) => b.key === "a")).toBeUndefined();

      // Unregister by action alone
      registry.unregister("select");
      expect(registry.getBindings().length).toBe(1);
      expect(registry.getBindings()[0]?.action).toBe("toggle_pause");
    });
  });

  describe("KeyBindingRegistry.resolve matching logic", () => {
    it("matches special keys and character keys case-insensitively", () => {
      const registry = new KeyBindingRegistry();

      const upStroke: KeyStroke = {
        raw: "\x1b[A",
        char: "",
        ctrl: false,
        alt: false,
        shift: false,
        special: "up",
      };
      const resolvedUp = registry.resolve(upStroke);
      expect(resolvedUp?.action).toBe("navigate_up");

      const capitalKStroke: KeyStroke = {
        raw: "K",
        char: "K",
        ctrl: false,
        alt: false,
        shift: false,
      };
      const resolvedK = registry.resolve(capitalKStroke);
      expect(resolvedK?.action).toBe("navigate_up");
    });

    it("evaluates modifier flags strictly (ctrl, alt, shift)", () => {
      const customBindings: KeyBinding[] = [
        { key: "x", ctrl: true, action: "quit", description: "Ctrl+X" },
        { key: "y", alt: true, action: "filter", description: "Alt+Y" },
        { key: "z", shift: true, action: "search", description: "Shift+Z" },
      ];
      const registry = new KeyBindingRegistry(customBindings);

      const plainX: KeyStroke = { raw: "x", char: "x", ctrl: false, alt: false, shift: false };
      expect(registry.resolve(plainX)).toBeUndefined();

      const ctrlX: KeyStroke = { raw: "\x18", char: "x", ctrl: true, alt: false, shift: false };
      expect(registry.resolve(ctrlX)?.action).toBe("quit");

      const altY: KeyStroke = { raw: "\x1by", char: "y", ctrl: false, alt: true, shift: false };
      expect(registry.resolve(altY)?.action).toBe("filter");

      const shiftZ: KeyStroke = { raw: "Z", char: "Z", ctrl: false, alt: false, shift: true };
      expect(registry.resolve(shiftZ)?.action).toBe("search");
    });

    it("evaluates modes and rejects unmapped strokes or empty strokes", () => {
      const registry = new KeyBindingRegistry([
        { key: "d", mode: "command", action: "custom", description: "Delete" },
      ]);

      const dStroke: KeyStroke = { raw: "d", char: "d", ctrl: false, alt: false, shift: false };
      expect(registry.resolve(dStroke, "normal")).toBeUndefined();
      expect(registry.resolve(dStroke, "command")?.action).toBe("custom");

      const emptyStroke: KeyStroke = { raw: "", char: "", ctrl: false, alt: false, shift: false };
      expect(registry.resolve(emptyStroke)).toBeUndefined();
    });
  });

  describe("KeyDispatcher lifecycle and dispatching", () => {
    it("dispatches actions to all handlers and manages handler removal", () => {
      const registry = new KeyBindingRegistry();
      const dispatcher = new KeyDispatcher(registry);
      expect(dispatcher.getRegistry()).toBe(registry);

      const actions1: string[] = [];
      const actions2: string[] = [];

      const unsub1 = dispatcher.addHandler((binding) => {
        actions1.push(binding.action);
      });
      const unsub2 = dispatcher.addHandler((binding) => {
        actions2.push(binding.action);
      });

      const pStroke: KeyStroke = { raw: "p", char: "p", ctrl: false, alt: false, shift: false };
      const dispatched = dispatcher.dispatch(pStroke);
      expect(dispatched).toBe(true);
      expect(actions1).toEqual(["toggle_pause"]);
      expect(actions2).toEqual(["toggle_pause"]);

      // Unsubscribe first handler
      unsub1();
      unsub1(); // idempotent check

      const qStroke: KeyStroke = { raw: "q", char: "q", ctrl: false, alt: false, shift: false };
      dispatcher.dispatch(qStroke);
      expect(actions1).toEqual(["toggle_pause"]);
      expect(actions2).toEqual(["toggle_pause", "quit"]);

      unsub2();
    });

    it("returns false when no binding matches and uses default registry", () => {
      const defaultDispatcher = new KeyDispatcher();
      expect(defaultDispatcher.getRegistry()).toBeDefined();

      let called = false;
      defaultDispatcher.addHandler(() => {
        called = true;
      });

      const unmapped: KeyStroke = {
        raw: "\x1b[99~",
        char: "",
        ctrl: true,
        alt: true,
        shift: true,
        special: "f1",
      };
      const result = defaultDispatcher.dispatch(unmapped);
      expect(result).toBe(false);
      expect(called).toBe(false);
    });
  });
});
