import type { DoubleBufferedCanvas } from "./canvas-diff.ts";
import type { MuxEnvelope } from "./stream-sources.ts";
import type { TuiState } from "./tui-state.ts";

export function renderHeaderView(state: TuiState, canvas: DoubleBufferedCanvas): void {
  const width = canvas.getWidth();
  const title = " OLT TERMINAL DASHBOARD ";
  const pauseIndicator = state.isPaused ? " [PAUSED] " : " [LIVE] ";
  const navTabs = "[1:Dash] [2:DAG] [3:Tasks] [4:Mailbox] [5:Telem] [?:Help]";

  canvas.writeString(0, 0, "┌" + "─".repeat(Math.max(0, width - 2)) + "┐");
  canvas.writeString(1, 0, "│");
  canvas.writeString(1, 2, title, { bold: true });
  canvas.writeString(1, width - pauseIndicator.length - 2, pauseIndicator, {
    bold: true,
    fg: state.isPaused ? [255, 200, 50] : [50, 255, 50],
  });
  canvas.writeString(1, width - 1, "│");

  canvas.writeString(2, 0, "│");
  canvas.writeString(2, 2, navTabs, { dim: true });
  canvas.writeString(2, width - 1, "│");
  canvas.writeString(3, 0, "├" + "─".repeat(Math.max(0, width - 2)) + "┤");
}

export function renderFooterView(state: TuiState, canvas: DoubleBufferedCanvas): void {
  const width = canvas.getWidth();
  const height = canvas.getHeight();
  const footerRow = height - 2;
  const borderRow = height - 3;

  canvas.writeString(borderRow, 0, "├" + "─".repeat(Math.max(0, width - 2)) + "┤");
  canvas.writeString(footerRow, 0, "│");

  const helpHint = " [j/k/↑/↓] Navigate  [p] Pause  [/] Filter  [q] Quit ";
  const filterInfo = state.searchFilter ? ` Filter: "${state.searchFilter}" ` : "";

  canvas.writeString(footerRow, 2, helpHint, { dim: true });
  if (filterInfo) {
    canvas.writeString(footerRow, width - filterInfo.length - 2, filterInfo, { bold: true });
  }
  canvas.writeString(footerRow, width - 1, "│");
  canvas.writeString(height - 1, 0, "└" + "─".repeat(Math.max(0, width - 2)) + "┘");
}

export function renderDashboardOverview(
  state: TuiState,
  events: readonly MuxEnvelope[],
  canvas: DoubleBufferedCanvas,
): void {
  const startRow = 4;
  canvas.writeString(startRow, 2, "Cognitive Work/Span Topology", { bold: true });
  canvas.writeString(
    startRow + 1,
    4,
    `Work (W): ${state.totalWork}ms | Span (S): ${state.criticalSpan}ms | Ideal Concurrency: ${state.activeLanes}`,
  );

  canvas.writeString(startRow + 3, 2, "Live Stream Pulse & Events", { bold: true });
  const recentEvents = events.slice(-8);
  for (let i = 0; i < recentEvents.length; i++) {
    const ev = recentEvents[i];
    if (!ev) continue;
    const line = `[${ev.channel}] [${ev.actor}] ${ev.kind} (seq: ${ev.sequence})`;
    canvas.writeString(startRow + 4 + i, 4, line);
  }
}

export function renderTaskMatrixView(state: TuiState, canvas: DoubleBufferedCanvas): void {
  const startRow = 4;
  const width = canvas.getWidth();
  const height = canvas.getHeight();
  const availableRows = height - 8;

  canvas.writeString(startRow, 2, "TASK ID", { bold: true });
  canvas.writeString(startRow, 16, "LABEL", { bold: true });
  canvas.writeString(startRow, width - 28, "ROLE", { bold: true });
  canvas.writeString(startRow, width - 16, "STATUS", { bold: true });
  canvas.writeString(startRow + 1, 2, "─".repeat(Math.max(0, width - 4)), { dim: true });

  const tasks = state.searchFilter
    ? state.tasks.filter(
        (t) =>
          t.id.toLowerCase().includes(state.searchFilter.toLowerCase()) ||
          t.label.toLowerCase().includes(state.searchFilter.toLowerCase()),
      )
    : state.tasks;

  const visibleTasks = tasks.slice(state.scrollOffset, state.scrollOffset + availableRows);

  for (let i = 0; i < visibleTasks.length; i++) {
    const task = visibleTasks[i];
    if (!task) continue;
    const actualIndex = state.scrollOffset + i;
    const isSelected = actualIndex === state.cursorIndex;
    const row = startRow + 2 + i;

    const rowStyle = isSelected
      ? { bold: true, fg: [0, 0, 0] as const, bg: [255, 255, 255] as const }
      : {};

    const marker = isSelected ? "► " : "  ";
    canvas.writeString(row, 2, marker + task.id.padEnd(12).slice(0, 12), rowStyle);
    canvas.writeString(row, 16, task.label.padEnd(width - 46).slice(0, width - 46), rowStyle);
    canvas.writeString(row, width - 28, task.role.padEnd(10).slice(0, 10), rowStyle);
    canvas.writeString(row, width - 16, task.status.padEnd(12).slice(0, 12), rowStyle);
  }
}

export function renderMailboxStreamView(
  _state: TuiState,
  events: readonly MuxEnvelope[],
  canvas: DoubleBufferedCanvas,
): void {
  const startRow = 4;
  canvas.writeString(startRow, 2, "INTER-AGENT FLOCK MAILBOX STREAM", { bold: true });
  canvas.writeString(startRow + 1, 2, "─".repeat(Math.max(0, canvas.getWidth() - 4)), { dim: true });

  const mailboxEvents = events.filter((e) => e.channel === "mailbox").slice(-12);
  for (let i = 0; i < mailboxEvents.length; i++) {
    const ev = mailboxEvents[i];
    if (!ev) continue;
    const row = startRow + 2 + i;
    canvas.writeString(
      row,
      4,
      `[${ev.timestamp.slice(11, 19)}] From: ${ev.actor} | Kind: ${ev.kind} (seq #${ev.sequence})`,
    );
  }
}

export function renderTelemetryStreamView(
  _state: TuiState,
  events: readonly MuxEnvelope[],
  canvas: DoubleBufferedCanvas,
): void {
  const startRow = 4;
  canvas.writeString(startRow, 2, "TELEMETRY & HEALTH PULSE STREAM", { bold: true });
  canvas.writeString(startRow + 1, 2, "─".repeat(Math.max(0, canvas.getWidth() - 4)), { dim: true });

  const telemEvents = events.filter((e) => e.channel === "telemetry" || e.channel === "heartbeat").slice(-12);
  for (let i = 0; i < telemEvents.length; i++) {
    const ev = telemEvents[i];
    if (!ev) continue;
    const row = startRow + 2 + i;
    canvas.writeString(
      row,
      4,
      `[${ev.timestamp.slice(11, 19)}] [${ev.channel.toUpperCase()}] Actor: ${ev.actor} | Action: ${ev.kind}`,
    );
  }
}

export function renderHelpOverlay(canvas: DoubleBufferedCanvas): void {
  const width = canvas.getWidth();
  const height = canvas.getHeight();
  const startRow = 5;

  canvas.writeString(startRow, 4, "KEYBINDINGS & NAVIGATION HELP", { bold: true });
  canvas.writeString(startRow + 1, 4, "─".repeat(Math.max(0, width - 8)), { dim: true });

  const lines = [
    "  1-5           : Switch view tabs (1=Dash, 2=DAG, 3=Tasks, 4=Mailbox, 5=Telem)",
    "  ↑ / k         : Move selection up",
    "  ↓ / j         : Move selection down",
    "  ← / h         : Pan / scroll left",
    "  → / l         : Pan / scroll right",
    "  p             : Toggle Pause/Resume on live stream multiplexer",
    "  /             : Search and filter tasks",
    "  Enter / Space : Select and expand highlighted item",
    "  ?             : Toggle this help overlay",
    "  q / Ctrl+C    : Exit terminal dashboard",
  ];

  for (let i = 0; i < lines.length && startRow + 3 + i < height - 3; i++) {
    const l = lines[i];
    if (l) canvas.writeString(startRow + 3 + i, 4, l);
  }
}
