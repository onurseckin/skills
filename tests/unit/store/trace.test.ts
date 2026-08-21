import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import {
  appendTraceStep,
  writeTrace,
} from "../../../orchestrating-long-tasks/scripts/src/store/trace.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-trace-"));
  roots.push(root);
  return root;
}

function event(overrides: Partial<HarnessEvent> = {}): HarnessEvent {
  return {
    schema: "harness.event",
    version: 1,
    run_id: "run",
    capsule_id: "cap",
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
    const root = scratchRoot();
    writeTrace(root, [event()]);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain("# Step trace");
    expect(body).toContain("| 1 | 2026-08-20T00:00:00.000Z | tester | task-created | T-1 | open |");
  });

  test("falls back to unknown for subject and outcome when the payload has neither key", () => {
    const root = scratchRoot();
    writeTrace(root, [event({ payload: {} })]);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain(
      "| 1 | 2026-08-20T00:00:00.000Z | tester | task-created | unknown | unknown |",
    );
  });

  test("falls back to an empty payload object when the event payload is not an object", () => {
    const root = scratchRoot();
    writeTrace(root, [event({ payload: "not-an-object" as unknown as Record<string, never> })]);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain("unknown | unknown |");
  });

  test("escapes pipes and newlines in actor, kind and cell values", () => {
    const root = scratchRoot();
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
    const root = scratchRoot();
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
    const root = scratchRoot();
    writeTrace(root, []);
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body.endsWith("| ---: | ---- | ----- | ------------- | ------- | ------- |\n")).toBe(
      true,
    );
  });
});

describe("appendTraceStep", () => {
  test("appends a single row to an existing trace file without touching the header", () => {
    const root = scratchRoot();
    writeTrace(root, []);
    appendTraceStep(root, event());
    const body = readFileSync(join(root, "trace.md"), "utf-8");
    expect(body).toContain("# Step trace");
    expect(body).toContain("| 1 | 2026-08-20T00:00:00.000Z | tester | task-created | T-1 | open |");
  });
});
