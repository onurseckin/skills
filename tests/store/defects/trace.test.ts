import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  appendTraceStep,
  writeTrace,
} from "../../../olt/scripts/src/engine/store/recovery/trace.ts";
import { scratchRoot as makeScratchRoot } from "../../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

function event(overrides: Partial<HarnessEvent> = {}): HarnessEvent {
  return {
    schema: "harness.event",
    version: 1,
    run_id: "run",
    capsule_id: "cap",
    mode: "feature",
    sequence: 1,
    revision: 1,
    timestamp: "2026-08-20T00:00:00.000Z",
    actor: "tester",
    kind: "task-created",
    payload: { task_id: "T-1", status: "open" },
    previous_hash: null,
    projection: {
      schema: "harness.state",
      version: 1,
      revision: 1,
      event_sequence: 1,
      event_head: null,
    },
    hash: "a".repeat(64),
    ...overrides,
  };
}

describe("writeTrace", () => {
  test("renders a header and one row per event with subject and outcome columns filled", () => {
    const root = scratchRoot("renders-a-header-and-one-row-per-event-with-subjec");
    writeTrace(root, [event()]);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain("# Step trace");
    expect(body).toContain("| 1 | 2026-08-20T00:00:00.000Z | tester | task-created | T-1 | open |");
  });

  test("falls back to unknown for subject and outcome when the payload has neither key", () => {
    const root = scratchRoot("falls-back-to-unknown-for-subject-and-outcome-when");
    writeTrace(root, [event({ payload: {} })]);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain(
      "| 1 | 2026-08-20T00:00:00.000Z | tester | task-created | unknown | unknown |",
    );
  });

  test("falls back to an empty payload object when the event payload is not an object", () => {
    const root = scratchRoot("falls-back-to-an-empty-payload-object-when-the-eve");
    writeTrace(root, [event({ payload: "not-an-object" as unknown as Record<string, never> })]);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain("unknown | unknown |");
  });

  test("escapes pipes and newlines in actor, kind and cell values", () => {
    const root = scratchRoot("escapes-pipes-and-newlines-in-actor-kind-and-cell-");
    writeTrace(root, [
      event({
        actor: "a|b",
        kind: "line1\nline2",
        payload: { task_id: "has|pipe\nand-newline" },
      }),
    ]);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain("a\\|b");
    expect(body).toContain("line1 line2");
    expect(body).toContain("has\\|pipe and-newline");
  });

  test("renders numeric and boolean payload cells as strings, skipping empty strings and NaN", () => {
    const root = scratchRoot("renders-numeric-and-boolean-payload-cells-as-strin");
    writeTrace(root, [
      event({ payload: { round: 3 } }),
      event({ sequence: 2, payload: { result: true } }),
      event({ sequence: 3, payload: { task_id: "", status: Number.NaN, branch_id: "B-1" } }),
    ]);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain("| 3 |");
    expect(body).toContain("| true |");
    expect(body).toContain("B-1");
  });

  test("writes an empty body (header only) for zero events", () => {
    const root = scratchRoot("writes-an-empty-body-header-only-for-zero-events");
    writeTrace(root, []);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body.endsWith("| ---: | ---- | ----- | ------------- | ------- | ------- |\n")).toBe(
      true,
    );
  });
});

describe("appendTraceStep", () => {
  test("appends a single row to an existing trace file without touching the header", () => {
    const root = scratchRoot("appends-a-single-row-to-an-existing-trace-file-wit");
    writeTrace(root, []);
    appendTraceStep(root, event());
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain("# Step trace");
    expect(body).toContain("| 1 | 2026-08-20T00:00:00.000Z | tester | task-created | T-1 | open |");
  });
});
