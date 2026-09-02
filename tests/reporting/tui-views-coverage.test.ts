import { describe, expect, it } from "bun:test";
import { DoubleBufferedCanvas } from "../../olt/scripts/src/reporting/tui/canvas-diff.ts";
import type { MuxEnvelope } from "../../olt/scripts/src/reporting/tui/stream-sources.ts";
import type { TuiState } from "../../olt/scripts/src/reporting/tui/tui-state.ts";
import {
  renderDashboardOverview,
  renderFooterView,
  renderHeaderView,
  renderHelpOverlay,
  renderMailboxStreamView,
  renderTaskMatrixView,
  renderTelemetryStreamView,
} from "../../olt/scripts/src/reporting/tui/views.ts";

function createBaseState(overrides?: Partial<TuiState>): TuiState {
  return {
    viewMode: "dashboard",
    cursorIndex: 0,
    scrollOffset: 0,
    isPaused: false,
    searchFilter: "",
    searchActive: false,
    terminalWidth: 80,
    terminalHeight: 24,
    tasks: [
      {
        id: "task-001",
        label: "Initialize Cluster",
        status: "completed",
        role: "lead",
        effort: 10,
      },
      {
        id: "task-002",
        label: "Run Integration Tests",
        status: "running",
        role: "worker",
        effort: 20,
      },
      {
        id: "task-003",
        label: "Deploy Telemetry Service",
        status: "pending",
        role: "worker",
        effort: 15,
      },
    ],
    totalWork: 450,
    criticalSpan: 120,
    activeLanes: 4,
    ...overrides,
  };
}

describe("Reporting TUI - Views Rendering", () => {
  it("renders header view for live and paused states", () => {
    const canvas = new DoubleBufferedCanvas(80, 24);
    const liveState = createBaseState({ isPaused: false });
    renderHeaderView(liveState, canvas);
    const liveOutput = canvas.toString();
    expect(liveOutput).toContain("OLT TERMINAL DASHBOARD");
    expect(liveOutput).toContain("[LIVE]");
    expect(liveOutput).toContain("[1:Dash] [2:DAG] [3:Tasks]");

    canvas.clear();
    const pausedState = createBaseState({ isPaused: true });
    renderHeaderView(pausedState, canvas);
    const pausedOutput = canvas.toString();
    expect(pausedOutput).toContain("[PAUSED]");
  });

  it("renders footer view with and without search filter", () => {
    const canvas = new DoubleBufferedCanvas(80, 24);
    const noFilterState = createBaseState({ searchFilter: "" });
    renderFooterView(noFilterState, canvas);
    const noFilterOutput = canvas.toString();
    expect(noFilterOutput).toContain("Navigate");
    expect(noFilterOutput).toContain("[q] Quit");
    expect(noFilterOutput).not.toContain("Filter:");

    canvas.clear();
    const withFilterState = createBaseState({ searchFilter: "Integration" });
    renderFooterView(withFilterState, canvas);
    const withFilterOutput = canvas.toString();
    expect(withFilterOutput).toContain('Filter: "Integration"');
  });

  it("renders dashboard overview with cognitive work topology and recent events", () => {
    const canvas = new DoubleBufferedCanvas(80, 24);
    const state = createBaseState({ totalWork: 1000, criticalSpan: 250, activeLanes: 4 });
    const events: MuxEnvelope[] = [
      {
        id: "e1",
        channel: "capsule",
        timestamp: "2026-09-01T20:00:01.000Z",
        sequence: 1,
        actor: "agent-1",
        kind: "spawn",
        payload: {},
      },
      {
        id: "e2",
        channel: "capsule",
        timestamp: "2026-09-01T20:00:02.000Z",
        sequence: 2,
        actor: "agent-2",
        kind: "exec",
        payload: {},
      },
    ];

    renderDashboardOverview(state, events, canvas);
    const output = canvas.toString();
    expect(output).toContain("Cognitive Work/Span Topology");
    expect(output).toContain("Work (W): 1000ms");
    expect(output).toContain("Span (S): 250ms");
    expect(output).toContain("Ideal Concurrency: 4");
    expect(output).toContain("[capsule] [agent-1] spawn (seq: 1)");
    expect(output).toContain("[capsule] [agent-2] exec (seq: 2)");
  });

  it("renders task matrix view with cursor selection and search filtering", () => {
    const canvas = new DoubleBufferedCanvas(80, 24);
    const state = createBaseState({ cursorIndex: 1 });
    renderTaskMatrixView(state, canvas);
    const output = canvas.toString();
    expect(output).toContain("TASK ID");
    expect(output).toContain("LABEL");
    expect(output).toContain("ROLE");
    expect(output).toContain("STATUS");
    expect(output).toContain("task-001");
    expect(output).toContain("task-002");
    expect(output).toContain("► task-002");

    canvas.clear();
    const filterState = createBaseState({ searchFilter: "Deploy" });
    renderTaskMatrixView(filterState, canvas);
    const filterOutput = canvas.toString();
    expect(filterOutput).toContain("task-003");
    expect(filterOutput).not.toContain("task-001");
  });

  it("renders mailbox stream view filtering for mailbox channel events", () => {
    const canvas = new DoubleBufferedCanvas(80, 24);
    const events: MuxEnvelope[] = [
      {
        id: "m1",
        channel: "mailbox",
        timestamp: "2026-09-01T12:34:56.789Z",
        sequence: 10,
        actor: "coordinator",
        kind: "dispatch_msg",
        payload: {},
      },
      {
        id: "t1",
        channel: "telemetry",
        timestamp: "2026-09-01T12:34:57.000Z",
        sequence: 11,
        actor: "worker",
        kind: "pulse",
        payload: {},
      },
    ];

    renderMailboxStreamView(createBaseState(), events, canvas);
    const output = canvas.toString();
    expect(output).toContain("INTER-AGENT FLOCK MAILBOX STREAM");
    expect(output).toContain("[12:34:56] From: coordinator | Kind: dispatch_msg (seq #10)");
    expect(output).not.toContain("pulse");
  });

  it("renders telemetry stream view filtering for telemetry and heartbeat channel events", () => {
    const canvas = new DoubleBufferedCanvas(80, 24);
    const events: MuxEnvelope[] = [
      {
        id: "t1",
        channel: "telemetry",
        timestamp: "2026-09-01T14:15:16.000Z",
        sequence: 20,
        actor: "evaluator",
        kind: "check_health",
        payload: {},
      },
      {
        id: "h1",
        channel: "heartbeat",
        timestamp: "2026-09-01T14:15:17.000Z",
        sequence: 21,
        actor: "supervisor",
        kind: "pulse_ack",
        payload: {},
      },
      {
        id: "m1",
        channel: "mailbox",
        timestamp: "2026-09-01T14:15:18.000Z",
        sequence: 22,
        actor: "other",
        kind: "msg",
        payload: {},
      },
    ];

    renderTelemetryStreamView(createBaseState(), events, canvas);
    const output = canvas.toString();
    expect(output).toContain("TELEMETRY & HEALTH PULSE STREAM");
    expect(output).toContain("[14:15:16] [TELEMETRY] Actor: evaluator | Action: check_health");
    expect(output).toContain("[14:15:17] [HEARTBEAT] Actor: supervisor | Action: pulse_ack");
    expect(output).not.toContain("other");
  });

  it("renders help overlay with keybindings guide", () => {
    const canvas = new DoubleBufferedCanvas(80, 24);
    renderHelpOverlay(canvas);
    const output = canvas.toString();
    expect(output).toContain("KEYBINDINGS & NAVIGATION HELP");
    expect(output).toContain("Switch view tabs");
    expect(output).toContain("Toggle Pause/Resume");
    expect(output).toContain("Exit terminal dashboard");

    const smallCanvas = new DoubleBufferedCanvas(80, 10);
    renderHelpOverlay(smallCanvas);
    expect(smallCanvas.toString()).toContain("KEYBINDINGS & NAVIGATION HELP");
  });
});
