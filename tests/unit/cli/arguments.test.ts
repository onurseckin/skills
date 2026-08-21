import { describe, expect, test } from "bun:test";
import {
  nearestFlagNames,
  parseArguments,
  suggestFlag,
} from "../../../orchestrating-long-tasks/scripts/src/cli/arguments.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { shouldReadPromptStdin } from "../../../orchestrating-long-tasks/scripts/src/cli/prompt-input.ts";

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

  test("carries a literal fix alongside every refusal it raises", () => {
    const asFix = (thunk: () => unknown): string | undefined => {
      try {
        thunk();
        throw new Error("expected a HarnessError");
      } catch (error) {
        if (!(error instanceof HarnessError)) throw error;
        return error.fix;
      }
    };
    expect(asFix(() => parseArguments([]))).toBe("run `harness.ts help` to see every command");
    expect(asFix(() => parseArguments(["status", "extra"]))).toContain("--");
    expect(asFix(() => parseArguments(["status", "--run", "a", "--run", "b"]))).toBe(
      "pass --run once",
    );
    expect(asFix(() => parseArguments(["status", "--run"]))).toBe(
      "pass a value, e.g. --run <value>",
    );
    expect(asFix(() => parseArguments(["status", "--=bad"]))).toContain("--[a-z][a-z0-9-]*");
  });

  test("reads prompt stdin only for the init command before the literal argv boundary", () => {
    expect(shouldReadPromptStdin(["init", "--prompt-stdin"])).toBeTrue();
    expect(shouldReadPromptStdin(["run", "--", "--prompt-stdin"])).toBeFalse();
    expect(shouldReadPromptStdin(["status", "--run", "/tmp/run", "--prompt-stdin"])).toBeFalse();
  });
});

describe("nearest-flag suggestions", () => {
  const PLAN_INIT_FLAGS = [
    "run",
    "run-id",
    "repo",
    "prompt-file",
    "prompt-stdin",
    "capture-mode",
    "source-verified",
    "runtime-source",
    "no-runtime-pin",
  ];

  test("suggests every flag a truncated name is a prefix of, closest first", () => {
    expect(nearestFlagNames("prompt", PLAN_INIT_FLAGS)).toEqual(["prompt-file", "prompt-stdin"]);
    expect(suggestFlag("prompt", PLAN_INIT_FLAGS)).toEqual({
      names: ["prompt-file", "prompt-stdin"],
      text: "--prompt-file or --prompt-stdin",
    });
  });

  test("falls back to a close typo match when nothing shares a prefix", () => {
    expect(nearestFlagNames("rn", ["run", "repo"])).toEqual(["run"]);
  });

  test("gives up rather than propose an unrelated flag", () => {
    expect(nearestFlagNames("actor", PLAN_INIT_FLAGS)).toEqual([]);
    expect(suggestFlag("actor", PLAN_INIT_FLAGS)).toBeUndefined();
  });

  test("returns nothing for an empty registry", () => {
    expect(nearestFlagNames("anything", [])).toEqual([]);
  });
});
