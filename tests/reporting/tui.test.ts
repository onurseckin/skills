import { describe, expect, it } from "bun:test";
import {
  DoubleBufferedCanvas,
  HeartbeatStreamSource,
  KeyBindingRegistry,
  KeyDispatcher,
  MailboxStreamSource,
  parseKeySequence,
  ReactiveRenderLoop,
  StreamMultiplexer,
  TuiController,
  TuiStateStore,
} from "../../olt/scripts/src/reporting/tui/index.ts";

describe("Track 2 Extensions - Terminal Dashboard Keybindings & Live TUI Streams", () => {
  describe("Key Parsing and Keybindings Engine", () => {
    it("parses arrow keys and special VT100 sequences", () => {
      const up = parseKeySequence("\x1b[A");
      expect(up.length).toBe(1);
      expect(up[0]?.special).toBe("up");
      expect(up[0]?.ctrl).toBe(false);

      const ctrlUp = parseKeySequence("\x1b[1;5A");
      expect(ctrlUp.length).toBe(1);
      expect(ctrlUp[0]?.special).toBe("up");
      expect(ctrlUp[0]?.ctrl).toBe(true);

      const compound = parseKeySequence("j\x1b[Bp");
      expect(compound.length).toBe(3);
      expect(compound[0]?.char).toBe("j");
      expect(compound[1]?.special).toBe("down");
      expect(compound[2]?.char).toBe("p");
    });

    it("resolves keybindings and dispatches actions to handlers", () => {
      const registry = new KeyBindingRegistry();
      const dispatcher = new KeyDispatcher(registry);

      let dispatchedAction: string | undefined;
      dispatcher.addHandler((binding) => {
        dispatchedAction = binding.action;
      });

      const strokeK = parseKeySequence("k")[0]!;
      const handledK = dispatcher.dispatch(strokeK);
      expect(handledK).toBe(true);
      expect(dispatchedAction).toBe("navigate_up");

      const strokeP = parseKeySequence("p")[0]!;
      dispatcher.dispatch(strokeP);
      expect(dispatchedAction).toBe("toggle_pause");

      const strokeTab = parseKeySequence("\x1b[1;5A")[0]!;
      const unmapped = dispatcher.dispatch(strokeTab);
      expect(unmapped).toBe(false);
    });
  });

  describe("Double-Buffered Differential Canvas Engine", () => {
    it("allocates grid and writes strings and styled cells", () => {
      const canvas = new DoubleBufferedCanvas(40, 10);
      expect(canvas.getWidth()).toBe(40);
      expect(canvas.getHeight()).toBe(10);

      canvas.writeString(0, 0, "TEST STRING", { bold: true });
      const str = canvas.toString();
      expect(str.startsWith("TEST STRING")).toBe(true);
    });

    it("computes diff and emits minimal ANSI diff updates", () => {
      const canvas = new DoubleBufferedCanvas(20, 5);
      canvas.writeString(0, 0, "HELLO");
      const diff1 = canvas.computeDiff();
      expect(diff1.length).toBe(1);
      expect(diff1[0]?.text).toBe("HELLO");

      const ansi1 = canvas.renderAnsiDiff();
      expect(ansi1).toContain("HELLO");

      const diff2 = canvas.computeDiff();
      expect(diff2.length).toBe(0);
      expect(canvas.renderAnsiDiff()).toBe("");

      canvas.writeString(0, 0, "HELP!");
      const diff3 = canvas.computeDiff();
      expect(diff3.length).toBe(1);
      expect(diff3[0]?.text).toBe("P!");
    });
  });

  describe("Reactive Render Loop", () => {
    it("schedules frames on demand and marks dirty state", async () => {
      let renderCount = 0;
      const loop = new ReactiveRenderLoop(
        () => {
          renderCount += 1;
        },
        { targetFps: 30 },
      );

      expect(loop.isRunning()).toBe(false);
      loop.start();
      expect(loop.isRunning()).toBe(true);

      loop.requestRender(true);
      expect(renderCount).toBeGreaterThanOrEqual(1);

      loop.stop();
      expect(loop.isRunning()).toBe(false);
    });
  });

  describe("Stream Multiplexer Engine", () => {
    it("multiplexes multiple event sources in chronological sequence", () => {
      const mux = new StreamMultiplexer({ maxBufferSize: 100 });
      const mailboxSource = new MailboxStreamSource();
      const heartbeatSource = new HeartbeatStreamSource();

      mux.registerSource(mailboxSource);
      mux.registerSource(heartbeatSource);

      const captured: string[] = [];
      mux.subscribeAll((envelope) => {
        captured.push(`${envelope.channel}:${envelope.actor}`);
      });

      mailboxSource.injectMessage({
        messageId: "m1",
        sender: "impl_13",
        recipient: "val_07",
        subject: "Round 1 Review",
        body: "Ready for verification",
        timestamp: "2026-08-29T12:00:00.000Z",
      });

      heartbeatSource.recordPulse({
        agentId: "val_07",
        role: "validator",
        pulseTimestamp: "2026-08-29T12:00:01.000Z",
        latencyMs: 15,
        status: "healthy",
      });

      const polled = mux.pollSources();
      expect(polled.length).toBe(2);
      expect(captured.length).toBe(2);
      expect(captured[0]).toBe("mailbox:impl_13");
      expect(captured[1]).toBe("heartbeat:val_07");

      const mailboxEvents = mux.getEvents("mailbox");
      expect(mailboxEvents.length).toBe(1);
      expect(mux.getBufferSize()).toBe(2);
    });

    it("respects ring buffer size limits", () => {
      const mux = new StreamMultiplexer({ maxBufferSize: 5 });
      for (let i = 0; i < 10; i++) {
        mux.pushEvent("test", { num: i });
      }
      expect(mux.getBufferSize()).toBe(5);
      expect(mux.getDroppedCount()).toBe(5);
      const remaining = mux.getEvents();
      expect(remaining.length).toBe(5);
    });
  });

  describe("TuiStateStore & View Controller Integration", () => {
    it("updates reactive state and switches view tabs", () => {
      const store = new TuiStateStore({
        tasks: [
          { id: "T-1", label: "Task 1", status: "open", role: "impl", effort: 10 },
          { id: "T-2", label: "Task 2", status: "done", role: "val", effort: 5 },
        ],
      });

      expect(store.getState().viewMode).toBe("dashboard");
      store.setViewMode("tasks");
      expect(store.getState().viewMode).toBe("tasks");

      store.moveCursor(1);
      expect(store.getState().cursorIndex).toBe(1);
      expect(store.getState().selectedItemId).toBe("T-2");

      store.togglePause();
      expect(store.getState().isPaused).toBe(true);
    });

    it("coordinates full controller input and rendering", () => {
      let exited = false;
      const controller = new TuiController({
        width: 80,
        height: 24,
        onExit: () => {
          exited = true;
        },
      });

      controller.start();
      controller.pushEvent("mailbox", { text: "Hello" }, "agent_1", "msg");

      controller.renderFrame();
      const canvasStr = controller.getCanvas().toString();
      expect(canvasStr).toContain("OLT TERMINAL DASHBOARD");
      expect(canvasStr).toContain("[mailbox]");

      controller.handleInput("3");
      expect(controller.getState().viewMode).toBe("tasks");

      controller.handleInput("q");
      expect(exited).toBe(true);

      controller.stop();
    });
  });
});
