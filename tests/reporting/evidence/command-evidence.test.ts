import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  commandEvidenceView,
  commandRecordPath,
} from "../../../olt/scripts/src/reporting/command-evidence.ts";
import { recordCaptures } from "../../../olt/scripts/src/engine/store/capsule/captures.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../browser/browser-virtual-fs.ts";

export const commandEvidenceSuiteName = "commandRecordPath & commandEvidenceView";

describe(commandEvidenceSuiteName, () => {
  test("builds the conventional per-command record path", () => {
    expect(commandRecordPath("C-1")).toBe("commands/C-1/record.json");
  });
});

describe("commandEvidenceView", () => {
  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  test("annotates a command with its id, path, and any screenshots taken during it", () => {
    const root = tempDir("command-evidence");
    recordCaptures(root, [
      {
        kind: "screenshot",
        name: "shot.png",
        sha256: "a".repeat(64),
        bytes: 10,
        blob_path: "blobs/aa/shot",
        path: "evidence/screenshots/shot.png",
        storage: "hardlink",
        original_path: "/virtual/shot.png",
        command_id: "C-1",
      },
    ]);

    const view = commandEvidenceView(root, { exit_code: 0 }, "C-1");

    expect(view.command_id).toBe("C-1");
    expect(view.path).toBe("commands/C-1");
    expect(view.exit_code).toBe(0);
    const records = view.screenshot_records as { path: string }[];
    expect(records.length).toBe(1);
    expect(records[0]?.path).toBe("evidence/screenshots/shot.png");
  });

  test("carries only the full screenshot records, not a redundant path-only projection", () => {
    const root = tempDir("command-evidence-empty");
    const view = commandEvidenceView(root, {}, "C-3");
    expect("screenshots" in view).toBe(false);
  });

  test("a command with no screenshots gets an empty evidence array, not an omitted one", () => {
    const root = tempDir("command-evidence-none");
    const view = commandEvidenceView(root, {}, "C-2");
    expect(view.screenshot_records).toEqual([]);
  });
});
