import { describe, expect, test } from "bun:test";
import { parseArguments } from "../../orchestrating-long-tasks/scripts/src/cli/arguments.ts";
import { shouldReadPromptStdin } from "../../orchestrating-long-tasks/scripts/src/cli/prompt-input.ts";

describe("CLI argument parsing", () => {
  test("parses flags, booleans, and a literal command tail", () => {
    expect(
      parseArguments([
        "run",
        "--run",
        "/tmp/run",
        "--idempotent",
        "--",
        "printf",
        "%s",
        "hello world",
      ]),
    ).toEqual({
      command: "run",
      flags: { run: "/tmp/run", idempotent: true },
      remainder: ["printf", "%s", "hello world"],
    });
  });

  test("rejects duplicate, positional, blank, and value-less options", () => {
    expect(() => parseArguments([])).toThrow("command");
    expect(() => parseArguments(["status", "extra"])).toThrow("positional");
    expect(() => parseArguments(["status", "--run", "a", "--run", "b"])).toThrow("duplicate");
    expect(() => parseArguments(["status", "--run"])).toThrow("value");
    expect(() => parseArguments(["status", "--=bad"])).toThrow("option");
  });

  test("reads prompt stdin only for the init command before the literal argv boundary", () => {
    expect(shouldReadPromptStdin(["init", "--prompt-stdin"])).toBeTrue();
    expect(shouldReadPromptStdin(["run", "--", "--prompt-stdin"])).toBeFalse();
    expect(shouldReadPromptStdin(["status", "--run", "/tmp/run", "--prompt-stdin"])).toBeFalse();
  });
});
