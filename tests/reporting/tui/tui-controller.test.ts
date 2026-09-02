import { describe, expect, it } from "bun:test";
import { TuiController } from "../../../olt/scripts/src/reporting/tui/controller.ts";
import type { KeyStroke } from "../../../olt/scripts/src/reporting/tui/key-parser.ts";
import type {
  MuxEnvelope,
  StreamSource,
} from "../../../olt/scripts/src/reporting/tui/stream-sources.ts";

class DummyStreamSource implements StreamSource {
  public readonly channelName = "dummy_stream";
  public pollNewEvents(): readonly MuxEnvelope[] {
    return [
      {
        id: "d-1",
        channel: "dummy_stream",
        timestamp: new Date().toISOString(),
        sequence: 1,
        actor: "tester",
        kind: "test",
        payload: { ok: true },
      },
    ];
  }
}

describe("TUI Controller Coverage (controller.ts)", () => {
  describe("Initialization, Lifecycle & Accessors", () => {
    it("initializes with default options and exposes getters", () => {
      const controller = new TuiController();
      expect(controller.getState().terminalWidth).toBe(80);
      expect(controller.getState().terminalHeight).toBe(24);
      expect(controller.getStateStore()).toBeDefined();
      expect(controller.getCanvas()).toBeDefined();
      expect(controller.getMultiplexer()).toBeDefined();
      expect(controller.getDispatcher()).toBeDefined();

      controller.start();
      controller.stop();
    });

    it("handles resize, source attachment, and stream polling in active/paused states", () => {
      const controller = new TuiController({ width: 100, height: 30 });
      expect(controller.getState().terminalWidth).toBe(100);

      controller.resize(120, 40);
      expect(controller.getState().terminalWidth).toBe(120);
      expect(controller.getCanvas().getWidth()).toBe(120);

      const src = new DummyStreamSource();
      controller.attachSource(src);

      // Active state event push & poll
      controller.pushEvent("custom_chan", { val: 1 });
      controller.pollStreams();
      expect(controller.getMultiplexer().getEvents().length).toBe(2);

      // Paused state event push & poll
      controller.getStateStore().togglePause();
      expect(controller.getState().isPaused).toBe(true);
      controller.pushEvent("custom_chan", { val: 2 });
      controller.pollStreams();
      expect(controller.getMultiplexer().getEvents().length).toBe(4);
    });
  });

  describe("Rendering Views Coverage", () => {
    it("renders all distinct view modes correctly", () => {
      const controller = new TuiController({ width: 90, height: 25 });
      controller.pushEvent("telemetry", { event: "ping" }, "agent-1", "telemetry_pulse");
      controller.pushEvent("mailbox", { subject: "msg" }, "agent-2", "mailbox_envelope");

      // Default dashboard view
      const frameDash = controller.renderFrame();
      expect(typeof frameDash).toBe("string");

      // Tasks view
      controller.getStateStore().setViewMode("tasks");
      const frameTasks = controller.renderFrame();
      expect(typeof frameTasks).toBe("string");

      // Mailboxes view
      controller.getStateStore().setViewMode("mailboxes");
      const frameMail = controller.renderFrame();
      expect(typeof frameMail).toBe("string");

      // Telemetry view
      controller.getStateStore().setViewMode("telemetry");
      const frameTelem = controller.renderFrame();
      expect(typeof frameTelem).toBe("string");

      // Help overlay view
      controller.getStateStore().setViewMode("help");
      const frameHelp = controller.renderFrame();
      expect(typeof frameHelp).toBe("string");
    });
  });

  describe("Input Handling & Keybinding Dispatching", () => {
    it("processes string and Uint8Array input and navigates cursor / views", () => {
      let exitTriggered = false;
      const controller = new TuiController({
        onExit: () => {
          exitTriggered = true;
        },
      });

      // Populate dummy tasks to enable cursor navigation
      controller.getStateStore().setState({
        tasks: [
          { id: "T1", label: "Task 1", status: "open", role: "dev", effort: 5 },
          { id: "T2", label: "Task 2", status: "done", role: "qa", effort: 3 },
        ],
      });

      // Navigate down and up
      controller.handleInput("j");
      expect(controller.getState().cursorIndex).toBe(1);

      controller.handleInput("k");
      expect(controller.getState().cursorIndex).toBe(0);

      // Toggle pause and help
      controller.handleInput("p");
      expect(controller.getState().isPaused).toBe(true);

      controller.handleInput("?");
      expect(controller.getState().viewMode).toBe("help");

      // Uint8Array input for view switching
      const encoder = new TextEncoder();
      controller.handleInput(encoder.encode("3")); // Tasks view
      expect(controller.getState().viewMode).toBe("tasks");

      controller.handleInput("4"); // Mailbox view
      expect(controller.getState().viewMode).toBe("mailboxes");

      controller.handleInput("5"); // Telemetry view
      expect(controller.getState().viewMode).toBe("telemetry");

      controller.handleInput("1"); // Dashboard view
      expect(controller.getState().viewMode).toBe("dashboard");

      // Quit key
      controller.handleInput("q");
      expect(exitTriggered).toBe(true);
    });

    it("covers unhandled actions and targetView edge case", () => {
      const controller = new TuiController();
      const dispatcher = controller.getDispatcher();

      // Register binding without targetView
      dispatcher.getRegistry().register({
        key: "x",
        action: "switch_view",
        description: "Missing target view",
      });

      // Register custom action hitting default branch
      dispatcher.getRegistry().register({
        key: "z",
        action: "select",
        description: "Select action",
      });

      const strokeX: KeyStroke = { raw: "x", char: "x", ctrl: false, alt: false, shift: false };
      const strokeZ: KeyStroke = { raw: "z", char: "z", ctrl: false, alt: false, shift: false };

      dispatcher.dispatch(strokeX);
      dispatcher.dispatch(strokeZ);

      // State mode remains unchanged
      expect(controller.getState().viewMode).toBe("dashboard");
    });
  });
});
