import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLayout } from "../../../../olt/scripts/src/engine/store/layout/layout-commands.ts";
import { scratchRoot as makeScratchRoot } from "../../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

describe("commandLayout", () => {
  test("returns no issues when state.commands is absent or not an object", () => {
    const root = scratchRoot("returns-no-issues-when-state-commands-is-absent-or");
    expect(commandLayout(root, undefined)).toEqual([]);
    expect(commandLayout(root, { commands: "not-an-object" })).toEqual([]);
  });

  test("skips non-object command entries", () => {
    const root = scratchRoot("skips-non-object-command-entries");
    expect(commandLayout(root, { commands: { "C-1": "not-an-object" } })).toEqual([]);
  });

  test("reports COMMAND_ID for an id unsafe to address on disk", () => {
    const root = scratchRoot("reports-command-id-for-an-id-unsafe-to-address-on-");
    const found = commandLayout(root, { commands: { "not safe/id": {} } });
    expect(found).toEqual([expect.objectContaining({ code: "COMMAND_ID" })]);
  });

  test("returns no issues when the record has no declared record_path", () => {
    const root = scratchRoot("returns-no-issues-when-the-record-has-no-declared-");
    expect(commandLayout(root, { commands: { "C-1": { status: "succeeded" } } })).toEqual([]);
  });

  test("reports COMMAND_PATH when the declared record_path points outside the command's own directory", () => {
    const root = scratchRoot("reports-command-path-when-the-declared-record-path");
    const found = commandLayout(root, {
      commands: { "C-1": { record_path: "commands/C-2/record.json" } },
    });
    expect(found).toEqual([expect.objectContaining({ code: "COMMAND_PATH" })]);
  });

  test("returns no issues when the declared record file does not exist on disk yet", () => {
    const root = scratchRoot("returns-no-issues-when-the-declared-record-file-do");
    const found = commandLayout(root, {
      commands: { "C-1": { record_path: "commands/C-1/record.json" } },
    });
    expect(found).toEqual([]);
  });

  test("returns no issues when status is missing or not a terminal status", () => {
    const root = scratchRoot("returns-no-issues-when-status-is-missing-or-not-a-");
    mkdirSync(join(root, "commands", "C-1"), { recursive: true });
    writeFileSync(join(root, "commands", "C-1", "record.json"), "{}");
    expect(
      commandLayout(root, { commands: { "C-1": { record_path: "commands/C-1/record.json" } } }),
    ).toEqual([]);
    expect(
      commandLayout(root, {
        commands: { "C-1": { record_path: "commands/C-1/record.json", status: "running" } },
      }),
    ).toEqual([]);
  });

  test("reports COMMAND_RECORD_CONTENT when the on-disk record no longer matches the declared state", () => {
    const root = scratchRoot("reports-command-record-content-when-the-on-disk-re");
    mkdirSync(join(root, "commands", "C-1"), { recursive: true });
    writeFileSync(
      join(root, "commands", "C-1", "record.json"),
      JSON.stringify({ status: "succeeded" }),
    );
    const record = { record_path: "commands/C-1/record.json", status: "succeeded", exit_code: 0 };
    const found = commandLayout(root, { commands: { "C-1": record } });
    expect(found).toEqual([expect.objectContaining({ code: "COMMAND_RECORD_CONTENT" })]);
  });

  test("returns no issues for each terminal status when the on-disk record matches exactly", () => {
    for (const status of ["succeeded", "failed", "timed_out"]) {
      const root = scratchRoot("returns-no-issues-for-each-terminal-status-when-th");
      mkdirSync(join(root, "commands", "C-1"), { recursive: true });
      const record = { record_path: "commands/C-1/record.json", status };
      writeFileSync(join(root, "commands", "C-1", "record.json"), JSON.stringify(record));
      expect(commandLayout(root, { commands: { "C-1": record } })).toEqual([]);
    }
  });

  test("reports COMMAND_UNREADABLE when the on-disk record cannot be read as canonical JSON", () => {
    const root = scratchRoot("reports-command-unreadable-when-the-on-disk-record");
    mkdirSync(join(root, "commands", "C-1"), { recursive: true });
    writeFileSync(join(root, "commands", "C-1", "record.json"), "not json");
    const record = { record_path: "commands/C-1/record.json", status: "succeeded" };
    const found = commandLayout(root, { commands: { "C-1": record } });
    expect(found).toEqual([expect.objectContaining({ code: "COMMAND_UNREADABLE" })]);
  });

  test("checks every declared command independently", () => {
    const root = scratchRoot("checks-every-declared-command-independently");
    const found = commandLayout(root, {
      commands: {
        "C-1": { record_path: "commands/C-2/record.json" },
        "C-2": "not-an-object",
        "not safe": {},
      },
    });
    expect(found).toHaveLength(2);
    expect(found.map((entry) => entry.code).sort()).toEqual(["COMMAND_ID", "COMMAND_PATH"]);
  });
});
