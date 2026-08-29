import { enforceLineLimit } from "../formatters/line-limiter.ts";
import {
  boolFlag,
  integerFlag,
  listFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";
import {
  deliverEventsToWebhook,
  formatEventsToNdjsonStream,
  readCapsuleEvents,
  renderAsciiEventStreamTable,
  resolveCapsulePath,
  type EventStreamOptions,
  type WebhookDeliveryResult,
} from "../../reporting/event-stream.ts";

export interface StreamEventsResult extends Record<string, unknown> {
  readonly markdown: string;
  readonly run_root: string;
  readonly run_id: string;
  readonly total_events: number;
  readonly matched_events: number;
  readonly from_seq?: number | undefined;
  readonly to_seq?: number | undefined;
  readonly latest_seq: number;
  readonly events: readonly unknown[];
  readonly ndjson?: string | undefined;
  readonly webhook_delivery?: WebhookDeliveryResult | undefined;
}

export async function streamEventsCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<StreamEventsResult> {
  const runFlag = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);
  const repo = textFlag(flags, "repo", false) ?? process.cwd();

  const runPath = runFlag ?? repo;
  const resolvedRun = resolveCapsulePath(runPath, repo);

  const fromSeq = integerFlag(flags, "from-seq", { minimum: 0 });
  const toSeq = integerFlag(flags, "to-seq", { minimum: 0 });
  const maxEvents = integerFlag(flags, "max-events", { minimum: 1 });
  const filterType = listFlag(flags, "filter-type", false) ?? textFlag(flags, "filter-type", false);
  const filterActor =
    listFlag(flags, "filter-actor", false) ?? textFlag(flags, "filter-actor", false);
  const all = boolFlag(flags, "all");
  const isJson = boolFlag(flags, "json");
  const isNow = boolFlag(flags, "now");
  const format = textFlag(flags, "format", false) ?? (isJson ? "json" : "markdown");

  const webhookUrl = textFlag(flags, "webhook-url", false);
  const webhookRetries = integerFlag(flags, "webhook-retries", { minimum: 0 });
  const webhookTimeout = integerFlag(flags, "webhook-timeout", { minimum: 100 });

  const queryOptions: EventStreamOptions = {
    ...(isNow ? {} : fromSeq !== undefined ? { fromSeq } : {}),
    ...(toSeq !== undefined ? { toSeq } : {}),
    ...(all ? { all: true } : maxEvents !== undefined ? { maxEvents } : { maxEvents: 50 }),
    ...(filterType !== undefined
      ? { filterType: Array.isArray(filterType) ? filterType : [filterType] }
      : {}),
    ...(filterActor !== undefined
      ? { filterActor: Array.isArray(filterActor) ? filterActor : [filterActor] }
      : {}),
  };

  const streamResult = readCapsuleEvents(resolvedRun, queryOptions);
  let matchingEvents = streamResult.matchingEvents;

  if (isNow && matchingEvents.length > 0) {
    matchingEvents = matchingEvents.slice(-1);
  }

  let webhookDelivery: WebhookDeliveryResult | undefined;
  if (webhookUrl) {
    webhookDelivery = await deliverEventsToWebhook(matchingEvents, webhookUrl, {
      ...(webhookRetries !== undefined ? { retries: webhookRetries } : { retries: 3 }),
      ...(webhookTimeout !== undefined ? { timeoutMs: webhookTimeout } : { timeoutMs: 5000 }),
    });
  }

  const ndjsonContent = formatEventsToNdjsonStream(matchingEvents);

  const mdLines: string[] = [
    `### Event Stream: \`${streamResult.runId}\``,
    `- **Run Root**: \`${streamResult.runRoot}\``,
    `- **Total Events in Log**: ${streamResult.totalAvailable}`,
    `- **Matched Events**: ${matchingEvents.length}`,
    `- **Sequence Range**: ${streamResult.fromSeq ?? 1} .. ${streamResult.latestSeq}`,
  ];

  if (webhookDelivery) {
    mdLines.push("");
    mdLines.push(`#### Webhook Delivery (${webhookUrl})`);
    mdLines.push(
      `- **Status**: ${webhookDelivery.success ? "SUCCESS" : "FAILED"}${webhookDelivery.statusCode ? ` (HTTP ${webhookDelivery.statusCode})` : ""}`,
    );
    mdLines.push(`- **Delivered Events**: ${webhookDelivery.deliveredCount}`);
    mdLines.push(`- **Receipt ID**: \`${webhookDelivery.receiptId ?? "none"}\``);
    mdLines.push(`- **Attempts**: ${webhookDelivery.attempts}`);
    if (webhookDelivery.error) {
      mdLines.push(`- **Error**: ${webhookDelivery.error}`);
    }
  }

  mdLines.push("");
  mdLines.push("```");
  mdLines.push(
    renderAsciiEventStreamTable(matchingEvents, {
      ...(all ? {} : { maxLines: 20 }),
      title: `Event Stream [${matchingEvents.length} events]`,
    }),
  );
  mdLines.push("```");

  const markdown = all ? mdLines.join("\n") : enforceLineLimit(mdLines.join("\n"), 30);

  return {
    markdown,
    run_root: streamResult.runRoot,
    run_id: streamResult.runId,
    total_events: streamResult.totalAvailable,
    matched_events: matchingEvents.length,
    ...(streamResult.fromSeq !== undefined ? { from_seq: streamResult.fromSeq } : {}),
    ...(streamResult.toSeq !== undefined ? { to_seq: streamResult.toSeq } : {}),
    latest_seq: streamResult.latestSeq,
    events: matchingEvents,
    ...(format === "ndjson" ? { ndjson: ndjsonContent } : {}),
    ...(webhookDelivery !== undefined ? { webhook_delivery: webhookDelivery } : {}),
  };
}
