import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandLayout } from "../../../orchestrating-long-tasks/scripts/src/store/layout-commands.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-layout-commands-"));
  roots.push(root);
  return root;
}

describe("commandLayout", () => {
  test("returns no issues when state.commands is absent or not an object", () => {
    const root = scratchRoot();
    expect(commandLayout(root, undefined)).toEqual([]);
    expect(commandLayout(root, { commands: "not-an-object" })).toEqual([]);
  });

  test("skips non-object command entries", () => {
    const root = scratchRoot();
    expect(commandLayout(root, { commands: { "C-1": "not-an-object" } })).toEqual([]);
  });

  test("reports COMMAND_ID for an id unsafe to address on disk", () => {
    const root = scratchRoot();
    const found = commandLayout(root, { commands: { "not safe/id": {} } });
    expect(found).toEqual([expect.objectContaining({ code: "COMMAND_ID" })]);
  });

  test("returns no issues when the record has no declared record_path", () => {
    const root = scratchRoot();
    expect(commandLayout(root, { commands: { "C-1": { status: "succeeded" } } })).toEqual([]);
  });

  test("reports COMMAND_PATH when the declared record_path points outside the command's own directory", () => {
    const root = scratchRoot();
    const found = commandLayout(root, {
      commands: { "C-1": { record_path: "commands/C-2/record.json" } },
    });
    expect(found).toEqual([expect.objectContaining({ code: "COMMAND_PATH" })]);
  });

  test("returns no issues when the declared record file does not exist on disk yet", () => {
    const root = scratchRoot();
    const found = commandLayout(root, {
      commands: { "C-1": { record_path: "commands/C-1/record.json" } },
    });
    expect(found).toEqual([]);
  });

  test("returns no issues when status is missing or not a terminal status", () => {
    const root = scratchRoot();
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
    const root = scratchRoot();
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
      const root = scratchRoot();
      mkdirSync(join(root, "commands", "C-1"), { recursive: true });
      const record = { record_path: "commands/C-1/record.json", status };
      writeFileSync(join(root, "commands", "C-1", "record.json"), JSON.stringify(record));
      expect(commandLayout(root, { commands: { "C-1": record } })).toEqual([]);
    }
  });

  test("reports COMMAND_UNREADABLE when the on-disk record cannot be read as canonical JSON", () => {
    const root = scratchRoot();
    mkdirSync(join(root, "commands", "C-1"), { recursive: true });
    writeFileSync(join(root, "commands", "C-1", "record.json"), "not json");
    const record = { record_path: "commands/C-1/record.json", status: "succeeded" };
    const found = commandLayout(root, { commands: { "C-1": record } });
    expect(found).toEqual([expect.objectContaining({ code: "COMMAND_UNREADABLE" })]);
  });

  test("checks every declared command independently", () => {
    const root = scratchRoot();
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
