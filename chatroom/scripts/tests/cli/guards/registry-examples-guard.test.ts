import { describe, expect, it } from "bun:test";
import { parseArguments, splitCommandLine, validateArguments } from "../../../src/cli/index.ts";
import { CHAT_COMMANDS, CliError, taskSpec, watchSpec } from "../../../src/cli/registry/index.ts";

describe("Registry Examples Guard", () => {
  for (const spec of CHAT_COMMANDS) {
    if (!spec.examples || spec.examples.length === 0) {
      continue;
    }

    for (const example of spec.examples) {
      it(`validates ${spec.name} example: ${example}`, () => {
        const args = splitCommandLine(example);
        const parsed = parseArguments(spec, args);
        validateArguments(spec, parsed);
      });
    }
  }

  it("rejects an example containing an undeclared flag", () => {
    const fakeSpec = {
      ...watchSpec,
      examples: ["chat:watch --room build-review --ack-mode flushed"],
    };
    const args = splitCommandLine(fakeSpec.examples[0] ?? "");
    const parsed = parseArguments(fakeSpec, args);
    expect(() => validateArguments(fakeSpec, parsed)).toThrow(CliError);
  });

  it("collects remainder from chat:task with flags and positional args", () => {
    const parsed = parseArguments(taskSpec, [
      "chat:task",
      "--room",
      "alpha-room",
      "T-3c9e",
      "in_progress",
    ]);
    expect(parsed.command).toBe("chat:task");
    expect(parsed.flags.room).toBe("alpha-room");
    expect(parsed.remainder).toEqual(["T-3c9e", "in_progress"]);
  });

  it("collects remainder from bare chat task with positional args", () => {
    const parsed = parseArguments(taskSpec, ["chat", "task", "T-3c9e", "in_progress"]);
    expect(parsed.command).toBe("chat task");
    expect(parsed.remainder).toEqual(["T-3c9e", "in_progress"]);
  });

  it("collects remainder when flags appear after positional args", () => {
    const parsed = parseArguments(taskSpec, [
      "chat:task",
      "--room",
      "alpha-room",
      "T-3c9e",
      "--note",
      "Root cause identified",
    ]);
    expect(parsed.command).toBe("chat:task");
    expect(parsed.flags.room).toBe("alpha-room");
    expect(parsed.flags.note).toBe("Root cause identified");
    expect(parsed.remainder).toEqual(["T-3c9e"]);
  });

  it("pushes all tokens after separator into remainder", () => {
    const parsed = parseArguments(taskSpec, [
      "chat:task",
      "--room",
      "alpha-room",
      "--",
      "T-3c9e",
      "--not-a-flag",
    ]);
    expect(parsed.command).toBe("chat:task");
    expect(parsed.flags.room).toBe("alpha-room");
    expect(parsed.remainder).toEqual(["T-3c9e", "--not-a-flag"]);
  });

  it("throws unexpected positional argument when takesRemainder is false", () => {
    const initSpec = CHAT_COMMANDS.find((c) => c.name === "chat:init");
    expect(initSpec).toBeDefined();
    if (initSpec !== undefined) {
      let caught: unknown;
      try {
        parseArguments(initSpec, ["chat:init", "--room", "alpha-room", "unexpected"]);
      } catch (err: unknown) {
        caught = err;
      }
      expect(caught instanceof CliError).toBe(true);
      if (caught instanceof CliError) {
        expect(caught.code).toBe("INVALID_ARGUMENT");
        expect(caught.message).toContain("unexpected positional argument: unexpected");
      }
    }
  });

  it("handles quoted strings and whitespace properly in splitCommandLine", () => {
    expect(splitCommandLine('chat:say --room dev --text "hello world"')).toEqual([
      "chat:say",
      "--room",
      "dev",
      "--text",
      "hello world",
    ]);
    expect(splitCommandLine("chat:say --room dev --text 'hello world'")).toEqual([
      "chat:say",
      "--room",
      "dev",
      "--text",
      "hello world",
    ]);
    expect(splitCommandLine('chat:task --room dev --note ""')).toEqual([
      "chat:task",
      "--room",
      "dev",
      "--note",
      "",
    ]);
  });
});
