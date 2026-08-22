import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { HarnessEvent } from "../contracts/capsule.ts";
import { HarnessError } from "../errors/harness-error.ts";

export interface EventStreamOptions {
  readonly fromSeq?: number | undefined;
  readonly toSeq?: number | undefined;
  readonly maxEvents?: number | undefined;
  readonly filterType?: string | readonly string[] | undefined;
  readonly filterActor?: string | readonly string[] | undefined;
  readonly all?: boolean | undefined;
}

export interface CapsuleEventsResult {
  readonly runRoot: string;
  readonly runId: string;
  readonly capsuleId?: string | undefined;
  readonly totalAvailable: number;
  readonly matchingEvents: readonly HarnessEvent[];
  readonly fromSeq?: number | undefined;
  readonly toSeq?: number | undefined;
  readonly latestSeq: number;
  readonly hasMore: boolean;
}

export interface WebhookDeliveryOptions {
  readonly customFetch?: typeof fetch | undefined;
  readonly retries?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly batchSize?: number | undefined;
  readonly backoffBaseMs?: number | undefined;
}

export interface WebhookDeliveryResult {
  readonly success: boolean;
  readonly deliveredCount: number;
  readonly statusCode?: number | undefined;
  readonly receiptId?: string | undefined;
  readonly attempts: number;
  readonly error?: string | undefined;
  readonly durationMs: number;
}

export function isHarnessEvent(value: unknown): value is HarnessEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.schema === "string" &&
    typeof rec.sequence === "number" &&
    typeof rec.timestamp === "string" &&
    typeof rec.actor === "string" &&
    typeof rec.kind === "string"
  );
}

export function resolveCapsulePath(runInput: string, repoRoot: string = process.cwd()): string {
  if (isAbsolute(runInput)) {
    if (existsSync(runInput)) {
      const st = lstatSync(runInput);
      if (st.isFile() && basename(runInput) === "events.jsonl") {
        return dirname(realpathSync(runInput));
      }
      return realpathSync(runInput);
    }
  }

  const direct = resolve(repoRoot, runInput);
  if (existsSync(direct)) {
    const st = lstatSync(direct);
    if (st.isFile() && basename(direct) === "events.jsonl") {
      return dirname(realpathSync(direct));
    }
    return realpathSync(direct);
  }

  const inCapsules = resolve(repoRoot, ".capsules", runInput);
  if (existsSync(inCapsules)) {
    return realpathSync(inCapsules);
  }

  throw new HarnessError(
    "INVALID_ARGUMENT",
    `capsule run directory not found: ${runInput}`,
  );
}

export function readCapsuleEvents(
  runPath: string,
  options: EventStreamOptions = {},
): CapsuleEventsResult {
  const resolvedRoot = resolveCapsulePath(runPath);
  const eventsFile = join(resolvedRoot, "events.jsonl");

  if (!existsSync(eventsFile)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `events.jsonl not found in capsule directory: ${resolvedRoot}`,
    );
  }

  let manifestRunId = basename(resolvedRoot);
  let manifestCapsuleId: string | undefined;
  const manifestFile = join(resolvedRoot, "manifest.json");
  if (existsSync(manifestFile)) {
    try {
      const manifestRaw = JSON.parse(readFileSync(manifestFile, "utf8")) as unknown;
      if (typeof manifestRaw === "object" && manifestRaw !== null) {
        const manifestObj = manifestRaw as Record<string, unknown>;
        if (typeof manifestObj.run_id === "string") {
          manifestRunId = manifestObj.run_id;
        }
        if (typeof manifestObj.capsule_id === "string") {
          manifestCapsuleId = manifestObj.capsule_id;
        }
      }
    } catch {
      // Best-effort manifest extraction
    }
  }

  const fileContent = readFileSync(eventsFile, "utf8");
  const rawLines = fileContent.split("\n");
  const allEvents: HarnessEvent[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]?.trim();
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isHarnessEvent(parsed)) {
        allEvents.push(parsed);
      } else if (typeof parsed === "object" && parsed !== null) {
        // Safe cast for legacy or partial event records
        const eventCandidate = parsed as unknown as HarnessEvent;
        if (typeof eventCandidate.sequence === "number" && typeof eventCandidate.kind === "string") {
          allEvents.push(eventCandidate);
        }
      }
    } catch (err) {
      throw new HarnessError(
        "INTEGRITY",
        `failed to parse event at line ${i + 1} in ${eventsFile}: ${String(err)}`,
      );
    }
  }

  const totalAvailable = allEvents.length;
  let latestSeq = 0;
  for (const ev of allEvents) {
    if (ev.sequence > latestSeq) {
      latestSeq = ev.sequence;
    }
  }

  const typeFilters = options.filterType
    ? (Array.isArray(options.filterType) ? options.filterType : [options.filterType])
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : [];

  const actorFilters = options.filterActor
    ? (Array.isArray(options.filterActor) ? options.filterActor : [options.filterActor])
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)
    : [];

  let filtered = allEvents.filter((ev) => {
    if (options.fromSeq !== undefined && ev.sequence < options.fromSeq) {
      return false;
    }
    if (options.toSeq !== undefined && ev.sequence > options.toSeq) {
      return false;
    }
    if (typeFilters.length > 0 && !typeFilters.includes(ev.kind.toLowerCase())) {
      return false;
    }
    if (actorFilters.length > 0 && !actorFilters.includes(ev.actor.toLowerCase())) {
      return false;
    }
    return true;
  });

  let hasMore = false;
  if (!options.all && options.maxEvents !== undefined && options.maxEvents > 0) {
    if (filtered.length > options.maxEvents) {
      hasMore = true;
      filtered = filtered.slice(0, options.maxEvents);
    }
  }

  return {
    runRoot: resolvedRoot,
    runId: manifestRunId,
    ...(manifestCapsuleId !== undefined ? { capsuleId: manifestCapsuleId } : {}),
    totalAvailable,
    matchingEvents: filtered,
    ...(options.fromSeq !== undefined ? { fromSeq: options.fromSeq } : {}),
    ...(options.toSeq !== undefined ? { toSeq: options.toSeq } : {}),
    latestSeq,
    hasMore,
  };
}

export function formatEventToNdjson(event: HarnessEvent | Record<string, unknown>): string {
  return `${JSON.stringify(event)}\n`;
}

export function formatEventsToNdjsonStream(
  events: readonly (HarnessEvent | Record<string, unknown>)[],
): string {
  if (events.length === 0) return "";
  return events.map((ev) => JSON.stringify(ev)).join("\n") + "\n";
}

export function parseNdjsonStream(ndjson: string): HarnessEvent[] {
  const lines = ndjson.split("\n");
  const result: HarnessEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim();
    if (!trimmed) continue;
    const parsed: unknown = JSON.parse(trimmed);
    if (isHarnessEvent(parsed)) {
      result.push(parsed);
    } else if (typeof parsed === "object" && parsed !== null) {
      result.push(parsed as unknown as HarnessEvent);
    }
  }
  return result;
}

export async function deliverEventsToWebhook(
  events: readonly (HarnessEvent | Record<string, unknown>)[],
  webhookUrl: string,
  options: WebhookDeliveryOptions = {},
): Promise<WebhookDeliveryResult> {
  const startTime = Date.now();
  if (events.length === 0) {
    return {
      success: true,
      deliveredCount: 0,
      attempts: 0,
      receiptId: "rcpt_empty_batch",
      durationMs: 0,
    };
  }

  const fetchFn = options.customFetch ?? fetch;
  const maxRetries = Math.max(0, options.retries ?? 3);
  const timeoutMs = options.timeoutMs ?? 5000;
  const backoffBase = options.backoffBaseMs ?? 50;

  const payload = {
    events,
    count: events.length,
    delivered_at: new Date().toISOString(),
    batch_id: `batch_${randomUUID().slice(0, 8)}`,
  };

  const bodyStr = JSON.stringify(payload);
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain",
          "User-Agent": "orchestrating-long-tasks/event-stream-bridge",
          ...(options.headers ?? {}),
        },
        body: bodyStr,
        signal: controller.signal,
      });

      clearTimeout(timer);
      lastStatusCode = response.status;

      if (response.ok) {
        let receiptId = response.headers.get("x-receipt-id") ?? response.headers.get("x-delivery-receipt");
        if (!receiptId) {
          try {
            const resJson: unknown = await response.json();
            if (typeof resJson === "object" && resJson !== null) {
              const obj = resJson as Record<string, unknown>;
              if (typeof obj.receipt_id === "string") receiptId = obj.receipt_id;
              else if (typeof obj.receiptId === "string") receiptId = obj.receiptId;
              else if (typeof obj.id === "string") receiptId = obj.id;
            }
          } catch {
            // Non-JSON or empty response body
          }
        }
        if (!receiptId) {
          receiptId = `rcpt_${randomUUID().slice(0, 12)}`;
        }

        return {
          success: true,
          deliveredCount: events.length,
          statusCode: response.status,
          receiptId,
          attempts,
          durationMs: Date.now() - startTime,
        };
      }

      // If client error that is not rate limit (429), fail immediately without retry
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return {
          success: false,
          deliveredCount: 0,
          statusCode: response.status,
          attempts,
          error: `Webhook rejected payload with HTTP ${response.status}: ${response.statusText}`,
          durationMs: Date.now() - startTime,
        };
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt <= maxRetries) {
      const delay = backoffBase * Math.pow(2, attempt - 1);
      await new Promise((resolveSleep) => setTimeout(resolveSleep, delay));
    }
  }

  return {
    success: false,
    deliveredCount: 0,
    ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}),
    attempts,
    error: lastError !== undefined ? lastError : "Webhook delivery failed after maximum retries",
    durationMs: Date.now() - startTime,
  };
}

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
    const payload = typeof rec.payload === "object" && rec.payload !== null ? (rec.payload as Record<string, unknown>) : undefined;
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

  const displayRows = options.maxLines !== undefined && options.maxLines > 0 ? rows.slice(0, options.maxLines) : rows;
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
