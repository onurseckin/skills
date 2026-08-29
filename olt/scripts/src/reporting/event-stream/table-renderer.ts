import type { HarnessEvent } from "../../core/contracts/index.ts";

function summarizeEventPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload || typeof payload !== "object") return "-";
  const parts: string[] = [];
  if (typeof payload.task_id === "string") parts.push(`task: ${payload.task_id}`);
  if (typeof payload.role === "string") parts.push(`role: ${payload.role}`);
  if (typeof payload.actor === "string") parts.push(`actor: ${payload.actor}`);
  if (typeof payload.status === "string") parts.push(`status: ${payload.status}`);
  if (typeof payload.command === "string") parts.push(`cmd: ${payload.command}`);
  if (typeof payload.reason === "string") parts.push(`reason: ${payload.reason}`);

  if (parts.length > 0) return parts.join(", ");
  const raw = JSON.stringify(payload);
  return raw.length > 40 ? `${raw.slice(0, 37)}...` : raw;
}

function formatIsoTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  } catch {
    return iso;
  }
}

export function renderAsciiEventStreamTable(
  events: readonly (HarnessEvent | Record<string, unknown>)[],
  options: { maxLines?: number | undefined; title?: string | undefined } = {},
): string {
  if (events.length === 0) {
    return "+-----------------------------------------------------------------------------------------+\n| No events found matching stream criteria                                                |\n+-----------------------------------------------------------------------------------------+";
  }

  const rows: { seq: string; time: string; actor: string; kind: string; summary: string }[] = [];
  for (const ev of events) {
    const rec = ev as Record<string, unknown>;
    const seq = String(rec.sequence ?? "-");
    const time = typeof rec.timestamp === "string" ? formatIsoTime(rec.timestamp) : "-";
    const actor = typeof rec.actor === "string" ? rec.actor : "-";
    const kind = typeof rec.kind === "string" ? rec.kind : "-";
    const payload =
      typeof rec.payload === "object" && rec.payload !== null
        ? (rec.payload as Record<string, unknown>)
        : undefined;
    const summary = summarizeEventPayload(payload);
    rows.push({ seq, time, actor, kind, summary });
  }

  const colSeqWidth = Math.max(3, ...rows.map((r) => r.seq.length));
  const colTimeWidth = Math.max(19, ...rows.map((r) => r.time.length));
  const colActorWidth = Math.min(22, Math.max(5, ...rows.map((r) => r.actor.length)));
  const colKindWidth = Math.min(22, Math.max(4, ...rows.map((r) => r.kind.length)));
  const colSummaryWidth = Math.min(38, Math.max(7, ...rows.map((r) => r.summary.length)));

  const pad = (str: string, width: number) => {
    if (str.length > width) return `${str.slice(0, width - 3)}...`;
    return str.padEnd(width, " ");
  };

  const divider = `+${"-".repeat(colSeqWidth + 2)}+${"-".repeat(colTimeWidth + 2)}+${"-".repeat(colActorWidth + 2)}+${"-".repeat(colKindWidth + 2)}+${"-".repeat(colSummaryWidth + 2)}+`;
  const header = `| ${pad("Seq", colSeqWidth)} | ${pad("Time (UTC)", colTimeWidth)} | ${pad("Actor", colActorWidth)} | ${pad("Kind", colKindWidth)} | ${pad("Summary", colSummaryWidth)} |`;

  const lines: string[] = [];
  if (options.title) {
    lines.push(`=== ${options.title} ===`);
  }
  lines.push(divider);
  lines.push(header);
  lines.push(divider);

  const displayRows =
    options.maxLines !== undefined && options.maxLines > 0 ? rows.slice(0, options.maxLines) : rows;
  for (const r of displayRows) {
    lines.push(
      `| ${pad(r.seq, colSeqWidth)} | ${pad(r.time, colTimeWidth)} | ${pad(r.actor, colActorWidth)} | ${pad(r.kind, colKindWidth)} | ${pad(r.summary, colSummaryWidth)} |`,
    );
  }
  lines.push(divider);

  if (displayRows.length < rows.length) {
    lines.push(`... [${rows.length - displayRows.length} more events truncated]`);
  }

  return lines.join("\n");
}
