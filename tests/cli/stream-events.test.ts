import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import { streamEventsCommand } from "../../olt/scripts/src/cli/commands/stream-events.ts";
import { setupCompiledRun } from "./file-persistence-fixture.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterAll(async () => cleanupRoots(roots));

describe("stream:events CLI command", () => {
  test("streams events with sequence ranges, filters, and formats", async () => {
    const { repo, run } = await setupCompiledRun("stream-events-test", roots);

    // Initial stream query
    const baseResult = await streamEventsCommand({
      run,
    });

    expect(baseResult.run_root).toBeDefined();
    expect(baseResult.total_events).toBeGreaterThan(0);
    expect(baseResult.matched_events).toBeGreaterThan(0);
    expect(baseResult.markdown).toContain("Event Stream");

    // Query with from-seq and to-seq
    const rangeResult = await streamEventsCommand({
      run,
      "from-seq": "1",
      "to-seq": "2",
      "max-events": "2",
    });
    expect(rangeResult.matched_events).toBeLessThanOrEqual(2);

    // Query with filter-type and filter-actor
    const filtered = await streamEventsCommand({
      run,
      "filter-type": "plan-created",
      "filter-actor": "planner",
    });
    expect(filtered.matched_events).toBeDefined();

    // Query with --now
    const nowResult = await streamEventsCommand({
      run,
      now: true,
    });
    expect(nowResult.matched_events).toBeLessThanOrEqual(1);

    // Query with format ndjson
    const ndjsonResult = await streamEventsCommand({
      run,
      format: "ndjson",
    });
    expect(ndjsonResult.ndjson).toBeDefined();

    // Query with --all
    const allResult = await streamEventsCommand({
      run,
      all: true,
    });
    expect(allResult.markdown).toBeDefined();
  });

  test("stream:events handles webhook delivery options", async () => {
    const { repo, run } = await setupCompiledRun("stream-webhook-test", roots);

    // Delivery to a local non-listening webhook URL
    const webhookResult = await streamEventsCommand({
      run,
      "webhook-url": "http://127.0.0.1:59999/nonexistent-webhook",
      "webhook-retries": "0",
      "webhook-timeout": "100",
    });

    expect(webhookResult.webhook_delivery).toBeDefined();
    expect(webhookResult.webhook_delivery?.success).toBe(false);
    expect(webhookResult.markdown).toContain("Webhook Delivery");
    expect(webhookResult.markdown).toContain("FAILED");
  });

  test("dispatches events:stream via execute", async () => {
    const { repo, run } = await setupCompiledRun("stream-dispatch-test", roots);

    const execRes = await execute(["events:stream", "--run", run]);
    expect(execRes.total_events).toBeDefined();
  });
});
