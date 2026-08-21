import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commandEvidenceView,
  commandRecordPath,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/command-evidence.ts";
import { recordCaptures } from "../../../orchestrating-long-tasks/scripts/src/store/captures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "command-evidence-"));
  roots.push(root);
  return root;
}

describe("commandRecordPath", () => {
  test("builds the conventional per-command record path", () => {
    expect(commandRecordPath("C-1")).toBe("commands/C-1/record.json");
  });
});

describe("commandEvidenceView", () => {
  test("annotates a command with its id, path, and any screenshots taken during it", () => {
    const root = runRoot();
    recordCaptures(root, [
      {
        kind: "screenshot",
        name: "shot.png",
        sha256: "a".repeat(64),
        bytes: 10,
        blob_path: "blobs/aa/shot",
        path: "evidence/screenshots/shot.png",
        storage: "hardlink",
        original_path: "/tmp/shot.png",
        command_id: "C-1",
      },
    ]);

    const view = commandEvidenceView(root, { exit_code: 0 }, "C-1");

    expect(view.command_id).toBe("C-1");
    expect(view.path).toBe("commands/C-1");
    expect(view.exit_code).toBe(0);
    expect(view.screenshots).toEqual(["evidence/screenshots/shot.png"]);
    expect((view.screenshot_records as unknown[]).length).toBe(1);
  });

  test("a command with no screenshots gets empty evidence arrays, not omitted ones", () => {
    const root = runRoot();
    const view = commandEvidenceView(root, {}, "C-2");
    expect(view.screenshots).toEqual([]);
    expect(view.screenshot_records).toEqual([]);
  });
});
