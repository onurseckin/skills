import { describe, expect, test } from "bun:test";
import {
  commandLayers,
  effectiveCommandArgv,
} from "../../../orchestrating-long-tasks/scripts/src/runner/command-wrappers.ts";

describe("commandLayers", () => {
  test("returns invalid with no executable indices for an empty argv", () => {
    expect(commandLayers([])).toEqual({ executableIndices: [], effectiveIndex: 0, valid: false });
  });

  test("treats a plain, non-wrapper executable as immediately effective", () => {
    expect(commandLayers(["git", "status"])).toEqual({
      executableIndices: [0],
      effectiveIndex: 0,
      valid: true,
    });
  });

  test("unwraps a single `command` prefix to its target", () => {
    expect(commandLayers(["command", "git", "status"])).toEqual({
      executableIndices: [0, 1],
      effectiveIndex: 1,
      valid: true,
    });
  });

  test("skips -p style flags before the command target", () => {
    expect(commandLayers(["command", "-p", "git", "status"])).toEqual({
      executableIndices: [0, 2],
      effectiveIndex: 2,
      valid: true,
    });
  });

  test("resolves a command target immediately following a bare -- separator", () => {
    expect(commandLayers(["command", "--", "git"])).toEqual({
      executableIndices: [0, 2],
      effectiveIndex: 2,
      valid: true,
    });
  });

  test("is invalid when -- is the final argument with nothing after it", () => {
    expect(commandLayers(["command", "--"]).valid).toBe(false);
  });

  test("is invalid when an unrecognized flag precedes the command target", () => {
    expect(commandLayers(["command", "--unexpected", "git"]).valid).toBe(false);
  });

  test("is invalid when command has no target at all", () => {
    expect(commandLayers(["command"]).valid).toBe(false);
  });

  test("is invalid when only -p flags follow command with no eventual target", () => {
    expect(commandLayers(["command", "-p"]).valid).toBe(false);
  });

  test("unwraps a single `env` prefix to its target, skipping KEY=value assignments", () => {
    expect(commandLayers(["env", "FOO=bar", "git", "status"]).valid).toBe(false);
    expect(commandLayers(["env", "git", "status"])).toEqual({
      executableIndices: [0, 1],
      effectiveIndex: 1,
      valid: true,
    });
  });

  test("resolves an env target immediately following a bare -- separator", () => {
    expect(commandLayers(["env", "--", "git"])).toEqual({
      executableIndices: [0, 2],
      effectiveIndex: 2,
      valid: true,
    });
  });

  test("is invalid when -- is the final argument to env", () => {
    expect(commandLayers(["env", "--"]).valid).toBe(false);
  });

  test("is invalid when env is followed by a flag", () => {
    expect(commandLayers(["env", "-i", "git"]).valid).toBe(false);
  });

  test("unwraps nested command and env wrappers in sequence", () => {
    expect(commandLayers(["command", "env", "git", "status"])).toEqual({
      executableIndices: [0, 1, 2],
      effectiveIndex: 2,
      valid: true,
    });
  });

  test("normalizes wrapper names by case and a trailing .exe suffix", () => {
    expect(commandLayers(["COMMAND", "GIT.EXE"])).toEqual({
      executableIndices: [0, 1],
      effectiveIndex: 1,
      valid: true,
    });
  });
});

describe("effectiveCommandArgv", () => {
  test("slices to the effective executable when the layers are valid", () => {
    expect(effectiveCommandArgv(["command", "git", "status"])).toEqual(["git", "status"]);
  });

  test("returns the full argv unchanged when the layers are invalid", () => {
    const argv = ["command", "--unexpected", "git"];
    expect(effectiveCommandArgv(argv)).toEqual(argv);
  });
});
