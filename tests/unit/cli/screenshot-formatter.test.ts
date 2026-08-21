import { describe, expect, test } from "bun:test";
import type { ScreenshotRecord } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-types.ts";
import { formatScreenshotsListBrief } from "../../../orchestrating-long-tasks/scripts/src/cli/formatters/screenshot-formatter.ts";

function screenshot(overrides: Partial<ScreenshotRecord> = {}): ScreenshotRecord {
  return {
    kind: "screenshot",
    name: "shot.png",
    sha256: "a".repeat(64),
    bytes: 10,
    blob_path: "blobs/aa/shot",
    path: "evidence/screenshots/shot.png",
    storage: "hardlink",
    original_path: "/tmp/shot.png",
    ...overrides,
  };
}

describe("formatScreenshotsListBrief", () => {
  test("says plainly when there are no screenshots, with no scope suffix", () => {
    const brief = formatScreenshotsListBrief({ screenshots: [], count: 0 });
    expect(brief).toContain("### Run Screenshots: 0 total");
    expect(brief).toContain("No screenshots recorded for this run.");
  });

  test("scopes the heading to a task when given one", () => {
    const brief = formatScreenshotsListBrief({ screenshots: [], count: 0, taskId: "task-1" });
    expect(brief).toContain("### Run Screenshots: 0 total (Task: `task-1`)");
  });

  test("scopes the heading to a command when there is no task but a command", () => {
    const brief = formatScreenshotsListBrief({ screenshots: [], count: 0, commandId: "C-1" });
    expect(brief).toContain("### Run Screenshots: 0 total (Command: `C-1`)");
  });

  test("task scope takes precedence over command scope when both are given", () => {
    const brief = formatScreenshotsListBrief({
      screenshots: [],
      count: 0,
      taskId: "task-1",
      commandId: "C-1",
    });
    expect(brief).toContain("(Task: `task-1`)");
    expect(brief).not.toContain("Command:");
  });

  test("shows only the ownership fields that are present on each record", () => {
    const brief = formatScreenshotsListBrief({
      screenshots: [
        screenshot({ name: "full.png", command_id: "C-1", task_id: "task-1", actor: "worker-1" }),
        screenshot({ name: "bare.png", sha256: "b".repeat(64) }),
      ],
      count: 2,
    });

    expect(brief).toContain(
      "**`full.png`** (Command: `C-1` | Task: `task-1` | Actor: `worker-1`): `evidence/screenshots/shot.png`",
    );
    expect(brief).toContain("**`bare.png`**: `evidence/screenshots/shot.png`");
  });

  test("lists up to fifteen screenshots and summarises the remainder", () => {
    const screenshots = Array.from({ length: 17 }, (_, index) =>
      screenshot({ name: `s${index}.png`, sha256: index.toString().padStart(64, "0") }),
    );

    const brief = formatScreenshotsListBrief({ screenshots, count: 17 });

    expect(brief).toContain("`s0.png`");
    expect(brief).toContain("`s14.png`");
    expect(brief).not.toContain("`s15.png`");
    expect(brief).toContain("... and 2 more screenshots.");
  });
});
