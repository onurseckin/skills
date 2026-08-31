import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  flagPositions,
  parseArguments,
  type FlagShapes,
} from "../../../olt/scripts/src/cli/arguments.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { boolFlag, listFlag, textFlag } from "../../../olt/scripts/src/cli/options.ts";
import {
  flagShapes,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
} from "../../../olt/scripts/src/cli/registry/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const ENHANCE_FLAGS = [
  requiredFlag("run", "string", "Capsule run root."),
  optionalFlag("summary", "string", "One-line summary of the enhancement."),
  optionalFlag("dry-run", "bool", "Report without writing."),
  repeatableFlag("observation", "string", "An observation the agent actually made."),
  repeatableFlag("source", "string", "A file the agent actually read."),
];

const SHAPES: FlagShapes = flagShapes(ENHANCE_FLAGS);

describe("repeatable flags", () => {
  test("collects every occurrence in order and reads back as a list", () => {
    const parsed = parseArguments(
      [
        "plan:enhance",
        "--run",
        "/tmp/run",
        "--observation",
        "first",
        "--source",
        "a.ts",
        "--observation",
        "second",
        "--source",
        "b.ts",
        "--observation",
        "third",
      ],
      SHAPES,
    );
    expect(parsed.flags).toEqual({
      run: "/tmp/run",
      observation: ["first", "second", "third"],
      source: ["a.ts", "b.ts"],
    });
    expect(listFlag(parsed.flags, "observation")).toEqual(["first", "second", "third"]);
    expect(listFlag(parsed.flags, "source")).toEqual(["a.ts", "b.ts"]);
    expect(listFlag(parsed.flags, "todo")).toBeUndefined();
  });

  test("keeps a single occurrence of a repeatable flag a list", () => {
    const parsed = parseArguments(["plan:enhance", "--observation", "only"], SHAPES);
    expect(parsed.flags.observation).toEqual(["only"]);
    expect(listFlag(parsed.flags, "observation")).toEqual(["only"]);
  });

  test("rejects a repeat of a flag the spec does not declare repeatable", () => {
    expect(() =>
      parseArguments(["plan:enhance", "--summary", "a", "--summary", "b"], SHAPES),
    ).toThrow("duplicate option: --summary");
    expect(() => parseArguments(["plan:enhance", "--run", "a", "--run", "b"], SHAPES)).toThrow(
      "duplicate option: --run",
    );
  });

  test("refuses to read a repeatable flag as a single value", () => {
    const parsed = parseArguments(["plan:enhance", "--observation", "one"], SHAPES);
    expect(() => textFlag(parsed.flags, "observation")).toThrow(
      "--observation is repeatable; read it as a list",
    );
  });

  test("rejects a bare occurrence that carries no text", () => {
    const parsed = parseArguments(["plan:enhance", "--observation", "--dry-run"], SHAPES);
    expect(parsed.flags.observation).toEqual([true]);
    expect(() => listFlag(parsed.flags, "observation")).toThrow(
      "--observation must have a non-blank value",
    );
  });

  test("requires a value for a declared value-taking flag at the end of argv", () => {
    expect(() => parseArguments(["plan:enhance", "--summary"], SHAPES)).toThrow(
      "option --summary requires a value",
    );
    expect(parseArguments(["plan:enhance", "--dry-run"], SHAPES).flags).toEqual({
      "dry-run": true,
    });
  });

  test("treats an undeclared dashed token as the value of a value-taking flag", () => {
    expect(parseArguments(["plan:enhance", "--summary", "--help"], SHAPES).flags).toEqual({
      summary: "--help",
    });
    // A declared flag is never swallowed as another flag's value.
    expect(parseArguments(["plan:enhance", "--summary", "--dry-run"], SHAPES).flags).toEqual({
      summary: true,
      "dry-run": true,
    });
  });

  test("never swallows the literal argv boundary", () => {
    const parsed = parseArguments(["plan:enhance", "--summary", "--", "child", "--arg"], SHAPES);
    expect(parsed.flags).toEqual({ summary: true });
    expect(parsed.remainder).toEqual(["child", "--arg"]);
  });

  test("reports which tokens the walk treats as flags", () => {
    expect(flagPositions(["--run", "/tmp/run", "--summary", "--help"], SHAPES)).toEqual([
      "run",
      "summary",
    ]);
    expect(flagPositions(["--run", "/tmp/run", "--help"], SHAPES)).toEqual(["run", "help"]);
    // With no spec, a dashed token is always a flag.
    expect(flagPositions(["--summary", "--help"])).toEqual(["summary", "help"]);
  });
});

describe("registry-driven required flags", () => {
  test("rejects a missing required flag before the handler runs", async () => {
    await expect(execute(["plan:add", "--run", "/tmp/run", "--actor", "planner"])).rejects.toThrow(
      "--id is required",
    );
    await expect(execute(["installation-status", "--source", "."])).rejects.toThrow(
      "--home is required",
    );
  });

  test("still reports an undeclared flag as unknown", async () => {
    await expect(execute(["plan:status", "--run", "/tmp/run", "--nope", "x"])).rejects.toThrow(
      "unknown option: --nope",
    );
  });

  test("dispatches a real invocation against an existing capsule", async () => {
    const repo = scratchRoot(import.meta.path, "repeatable-flags-run-status");
    mkdirSync(repo, { recursive: true });
    const promptPath = join(repo, "prompt.txt");
    writeFileSync(promptPath, "Just enough to dispatch run:status against.");
    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "dispatch-check",
      "--prompt-file",
      promptPath,
    ]);
    const result = await execute(["plan:status", "--run", init.run_root as string]);
    expect(typeof result.markdown).toBe("string");
  });
});

describe("flag reads are own-key only", () => {
  // A plain `flags[name]` read resolves an absent `--constructor` to Object.prototype.constructor,
  // which would crash listFlag and mis-report textFlag.
  test("an unsupplied flag named after an Object.prototype member reads as absent", () => {
    const parsed = parseArguments(["plan:enhance", "--run", "/tmp/run"], SHAPES);
    expect(listFlag(parsed.flags, "constructor")).toBeUndefined();
    expect(textFlag(parsed.flags, "constructor", false)).toBeUndefined();
    expect(boolFlag(parsed.flags, "constructor")).toBe(false);
  });

  test("a supplied flag of that name is still read back", () => {
    const parsed = parseArguments(["plan:enhance", "--constructor", "v"], SHAPES);
    expect(parsed.flags).toEqual({ constructor: "v" });
    expect(textFlag(parsed.flags, "constructor")).toBe("v");
    expect(() =>
      parseArguments(["plan:enhance", "--constructor", "a", "--constructor", "b"], SHAPES),
    ).toThrow("duplicate option: --constructor");
  });
});
