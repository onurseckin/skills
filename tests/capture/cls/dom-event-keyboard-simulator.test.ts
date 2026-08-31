import { describe, expect, it } from "bun:test";
import { DOM_EVENT_DISPATCH_SCRIPT } from "../../../olt/scripts/src/capture/runners/dom-event-simulator/index.ts";

describe("dom-event-simulator: in-page dispatch script & keyboard evaluation", () => {
  it("executes script against mocked DOM environment covering all dispatch branches", () => {
    const scriptFn = new Function(`return (${DOM_EVENT_DISPATCH_SCRIPT});`)() as (
      payload?: unknown,
    ) => void;

    const eventsDispatched: { type: string; event: string }[] = [];
    const classes = new Set<string>();
    const attributes: Record<string, string> = {};

    const mockElement = {
      tagName: "BUTTON",
      value: "",
      click: () => {
        eventsDispatched.push({ type: "click", event: "click_fn" });
      },
      focus: () => {
        eventsDispatched.push({ type: "focus", event: "focus_fn" });
      },
      blur: () => {
        eventsDispatched.push({ type: "blur", event: "blur_fn" });
      },
      scrollTo: (x: number, y: number) => {
        eventsDispatched.push({ type: "scroll", event: `scrollTo(${x},${y})` });
      },
      scrollBy: (x: number, y: number) => {
        eventsDispatched.push({ type: "scroll", event: `scrollBy(${x},${y})` });
      },
      dispatchEvent: (ev: { type: string }) => {
        eventsDispatched.push({ type: "event", event: ev.type });
        return true;
      },
    };

    const globalAny = globalThis as unknown as {
      document?: unknown;
      window?: unknown;
      MouseEvent?: unknown;
      FocusEvent?: unknown;
      KeyboardEvent?: unknown;
      Event?: unknown;
    };

    const origDoc = globalAny.document;
    const origWin = globalAny.window;
    const origMouseEvent = globalAny.MouseEvent;
    const origFocusEvent = globalAny.FocusEvent;
    const origKeyboardEvent = globalAny.KeyboardEvent;
    const origEvent = globalAny.Event;

    class MockEvent {
      constructor(
        public type: string,
        public init?: unknown,
      ) {}
    }

    globalAny.MouseEvent = MockEvent;
    globalAny.FocusEvent = MockEvent;
    globalAny.KeyboardEvent = MockEvent;
    globalAny.Event = MockEvent;

    globalAny.document = {
      body: mockElement,
      querySelector: (sel: string) => (sel === "#not-found" ? null : mockElement),
      documentElement: {
        classList: {
          toggle: (cls: string, val: boolean) => {
            if (val) classes.add(cls);
            else classes.delete(cls);
          },
        },
        setAttribute: (name: string, val: string) => {
          attributes[name] = val;
        },
      },
    };

    globalAny.window = {
      scrollTo: (x: number, y: number) => {
        eventsDispatched.push({ type: "scroll", event: `window.scrollTo(${x},${y})` });
      },
      scrollBy: (x: number, y: number) => {
        eventsDispatched.push({ type: "scroll", event: `window.scrollBy(${x},${y})` });
      },
    };

    try {
      expect(() => scriptFn(null)).not.toThrow();
      expect(() => scriptFn(undefined)).not.toThrow();
      expect(() => scriptFn({})).not.toThrow();

      scriptFn({ type: "click", selector: "#btn" });

      const noClickMethodEl = { ...mockElement, click: undefined };
      (globalAny.document as { querySelector: (s: string) => unknown }).querySelector = () =>
        noClickMethodEl;
      scriptFn({ type: "click", selector: "#no-click" });

      (globalAny.document as { querySelector: (s: string) => unknown }).querySelector = () =>
        mockElement;
      scriptFn({ type: "hover", selector: "#btn" });
      scriptFn({ type: "mouseleave", selector: "#btn" });

      scriptFn({ type: "scroll", selector: "#btn", scrollX: 10, scrollY: 20 });
      scriptFn({ type: "scroll", selector: "#btn", scrollDeltaX: 5, scrollDeltaY: 15 });
      scriptFn({ type: "scroll", scrollX: 0, scrollY: 100 });
      scriptFn({ type: "scroll", scrollDeltaY: 50 });

      scriptFn({ type: "focus", selector: "#input" });
      scriptFn({ type: "blur", selector: "#input" });

      scriptFn({ type: "input", selector: "#input", text: "abc", key: "Enter" });
      scriptFn({ type: "keyup", selector: "#input", key: "Escape" });

      scriptFn({
        type: "mediaQuery",
        mediaQuery: "screen and (prefers-color-scheme: dark)",
        matches: true,
      });
      expect(classes.has("dark")).toBe(true);
      expect(attributes["data-theme"]).toBe("dark");

      scriptFn({
        type: "mediaQuery",
        mediaQuery: "screen and (prefers-color-scheme: dark)",
        matches: false,
      });
      expect(classes.has("dark")).toBe(false);
      expect(attributes["data-theme"]).toBe("light");

      scriptFn({
        type: "mediaQuery",
        mediaQuery: "(prefers-reduced-motion: reduce)",
        matches: true,
      });
      expect(attributes["data-reduced-motion"]).toBe("true");

      (globalAny.document as { querySelector: (s: string) => unknown }).querySelector = () =>
        null;
      scriptFn({ type: "click", selector: "#not-found" });
      scriptFn({ type: "hover", selector: "#not-found" });
      scriptFn({ type: "focus", selector: "#not-found" });
      scriptFn({ type: "input", selector: "#not-found" });
    } finally {
      globalAny.document = origDoc;
      globalAny.window = origWin;
      globalAny.MouseEvent = origMouseEvent;
      globalAny.FocusEvent = origFocusEvent;
      globalAny.KeyboardEvent = origKeyboardEvent;
      globalAny.Event = origEvent;
    }
  });
});
