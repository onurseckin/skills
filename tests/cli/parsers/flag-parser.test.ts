import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { parseCommandFlags } from "../../../olt/scripts/src/cli/registry/flag-parser.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CliErrorEnvelope,
  type CommandSpec,
} from "../../../olt/scripts/src/cli/registry/types.ts";

const SAMPLE_SPEC: CommandSpec = {
  name: "test:action",
  aliases: [],
  domain: "task",
  summary: "Sample test command",
  description: "Sample test command for unit testing flag parser",
  flags: [
    requiredFlag("track", "string", "Track identifier"),
    optionalFlag("count", "int", "Item count", 10),
    optionalFlag("dry-run", "bool", "Perform dry run"),
    repeatableFlag("tag", "string", "Item tags"),
    repeatableFlag("priority", "int", "Priority levels"),
    optionalFlag("run", "string", "Capsule run root"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [],
  handler: () => ({ ok: true }),
};

const REMAINDER_SPEC: CommandSpec = {
  name: "test:exec",
  aliases: [],
  domain: "run",
  summary: "Command taking remainder",
  description: "Command taking remainder arguments",
  flags: [
    requiredFlag("actor", "string", "Actor identifier"),
    optionalFlag("timeout", "int", "Timeout in seconds"),
  ],
  readsStdin: false,
  takesRemainder: true,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [],
  handler: () => ({ ok: true }),
};

describe("parseCommandFlags", () => {
  it("parses valid flags into strongly typed structure", () => {
    interface Parsed {
      readonly track: string;
      readonly count: number;
      readonly "dry-run": boolean;
      readonly tag?: readonly string[];
      readonly priority?: readonly number[];
      readonly run?: string;
    }

    const result = parseCommandFlags<Parsed>(
      [
        "test:action",
        "--track",
        "TRK-01",
        "--count",
        "42",
        "--dry-run",
        "--tag",
        "alpha",
        "--tag",
        "beta",
        "--priority",
        "1",
        "--priority",
        "2",
      ],
      SAMPLE_SPEC,
    );

    expect(result.track).toBe("TRK-01");
    expect(result.count).toBe(42);
    expect(result["dry-run"]).toBe(true);
    expect(result.tag).toEqual(["alpha", "beta"]);
    expect(result.priority).toEqual([1, 2]);
  });

  it("parses --key=value syntax correctly", () => {
    interface Parsed {
      readonly track: string;
      readonly count: number;
      readonly "dry-run": boolean;
      readonly tag?: readonly string[];
    }

    const result = parseCommandFlags<Parsed>(
      ["test:action", "--track=TRK-99", "--count=7", "--dry-run=true", "--tag=gamma"],
      SAMPLE_SPEC,
    );

    expect(result.track).toBe("TRK-99");
    expect(result.count).toBe(7);
    expect(result["dry-run"]).toBe(true);
    expect(result.tag).toEqual(["gamma"]);
  });

  it("applies default values for omitted optional flags", () => {
    interface Parsed {
      readonly track: string;
      readonly count: number;
      readonly "dry-run": boolean;
    }

    const result = parseCommandFlags<Parsed>(["--track", "TRK-02"], SAMPLE_SPEC);

    expect(result.track).toBe("TRK-02");
    expect(result.count).toBe(10);
    expect(result["dry-run"]).toBe(false);
  });

  it("throws HarnessError with typed error envelope on missing required flag", () => {
    try {
      parseCommandFlags(["--count", "5"], SAMPLE_SPEC);
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HarnessError);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_ARGUMENT");
      expect(harnessErr.message).toContain("missing required option: --track");

      const envelope: CliErrorEnvelope = {
        ok: false,
        error: {
          code: harnessErr.code,
          message: harnessErr.message,
          severity: "error",
          exitCode: harnessErr.exitCode ?? 3,
          fix: harnessErr.fix,
        },
      };
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
      expect(envelope.error.exitCode).toBe(3);
    }
  });

  it("throws HarnessError on invalid integer value", () => {
    expect(() =>
      parseCommandFlags(["--track", "TRK-01", "--count", "invalid"], SAMPLE_SPEC),
    ).toThrow(HarnessError);
  });

  it("throws HarnessError on blank string value", () => {
    expect(() => parseCommandFlags(["--track", "   "], SAMPLE_SPEC)).toThrow(HarnessError);
  });

  it("throws HarnessError on unknown option and provides suggestion", () => {
    try {
      parseCommandFlags(["--track", "TRK-01", "--coun", "5"], SAMPLE_SPEC);
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
      expect((err as HarnessError).message).toContain("unknown option: --coun");
      expect((err as HarnessError).message).toContain("count");
    }
  });

  it("throws HarnessError on duplicate non-repeatable flag", () => {
    expect(() =>
      parseCommandFlags(["--track", "TRK-01", "--track", "TRK-02"], SAMPLE_SPEC),
    ).toThrow(HarnessError);
  });

  it("throws HarnessError on unexpected positional arguments", () => {
    expect(() => parseCommandFlags(["--track", "TRK-01", "unexpected-arg"], SAMPLE_SPEC)).toThrow(
      HarnessError,
    );
  });

  it("resolves run-id alias to run flag", () => {
    interface Parsed {
      readonly track: string;
      readonly run?: string;
    }

    const result = parseCommandFlags<Parsed>(
      ["--track", "TRK-01", "--run-id", ".olt/capsules/test-run"],
      SAMPLE_SPEC,
    );

    expect(result.run).toBe(".olt/capsules/test-run");
  });

  it("captures remainder when spec.takesRemainder is true", () => {
    interface Parsed {
      readonly actor: string;
      readonly remainder?: readonly string[];
    }

    const result = parseCommandFlags<Parsed>(
      ["test:exec", "--actor", "worker-1", "--", "bun", "test", "file.test.ts"],
      REMAINDER_SPEC,
    );

    expect(result.actor).toBe("worker-1");
    expect(result.remainder).toEqual(["bun", "test", "file.test.ts"]);
  });

  it("rejects remainder when spec.takesRemainder is false", () => {
    expect(() => parseCommandFlags(["--track", "TRK-01", "--", "extra"], SAMPLE_SPEC)).toThrow(
      HarnessError,
    );
  });

  it("handles command name stripping from start of argv", () => {
    interface Parsed {
      readonly track: string;
    }

    const result = parseCommandFlags<Parsed>(["test:action", "--track", "TRK-99"], SAMPLE_SPEC);

    expect(result.track).toBe("TRK-99");
  });

  it("accurately preserves explicit zero and negative integers without default fallback", () => {
    interface Parsed {
      readonly track: string;
      readonly count: number;
    }

    const zeroResult = parseCommandFlags<Parsed>(
      ["--track", "TRK-ZERO", "--count", "0"],
      SAMPLE_SPEC,
    );
    expect(zeroResult.count).toBe(0);

    const negativeResult = parseCommandFlags<Parsed>(
      ["--track", "TRK-NEG", "--count=-5"],
      SAMPLE_SPEC,
    );
    expect(negativeResult.count).toBe(-5);
  });

  it("handles boolean flag value edge cases and rejects non-true inline values", () => {
    interface Parsed {
      readonly track: string;
      readonly "dry-run": boolean;
    }

    const bareResult = parseCommandFlags<Parsed>(["--track", "TRK-BOOL", "--dry-run"], SAMPLE_SPEC);
    expect(bareResult["dry-run"]).toBe(true);

    expect(() =>
      parseCommandFlags<Parsed>(["--track", "TRK-BOOL", "--dry-run=false"], SAMPLE_SPEC),
    ).toThrow("option --dry-run does not take a value");

    expect(() =>
      parseCommandFlags<Parsed>(["--track", "TRK-BOOL", "--dry-run=random"], SAMPLE_SPEC),
    ).toThrow("option --dry-run does not take a value");
  });
});
