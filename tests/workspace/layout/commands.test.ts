import { describe, expect, it } from "bun:test";
import { commandLayout } from "../../../olt/scripts/src/engine/store/layout/layout-commands.ts";

describe("Workspace Layout: Commands Directory & Attempt Records", () => {
  it("evaluates clean state with empty commands list", () => {
    const issues = commandLayout("/tmp/run-root", { commands: {} });
    expect(issues.length).toBe(0);
  });

  it("evaluates undefined state gracefully", () => {
    const issues = commandLayout("/tmp/run-root", undefined);
    expect(issues.length).toBe(0);
  });

  it("detects invalid command ID formats", () => {
    const state = {
      commands: {
        invalid_id_format: {
          record_path: "commands/invalid/record.json",
        },
      },
    };
    const issues = commandLayout("/tmp/run-root", state);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].code).toBe("COMMAND_ID");
  });

  it("detects command record declaring paths outside its directory", () => {
    const state = {
      commands: {
        "C-123": {
          record_path: "commands/C-999/record.json",
        },
      },
    };
    const issues = commandLayout("/tmp/run-root", state);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].code).toBe("COMMAND_PATH");
  });
});
