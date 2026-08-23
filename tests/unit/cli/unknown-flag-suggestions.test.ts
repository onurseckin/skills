import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { assertFlags } from "../../../olt/scripts/src/cli/options.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

function catchHarnessError(thunk: () => void): HarnessError {
  try {
    thunk();
  } catch (error) {
    if (error instanceof HarnessError) return error;
    throw error;
  }
  throw new Error("expected assertFlags to throw a HarnessError");
}

describe("assertFlags unknown-option suggestions", () => {
  test("proposes the nearest declared flags by name, closest first", () => {
    const error = catchHarnessError(() =>
      assertFlags({ prompt: true }, ["run", "repo", "prompt-file", "prompt-stdin"]),
    );
    expect(error.message).toBe(
      "unknown option: --prompt; did you mean --prompt-file or --prompt-stdin?",
    );
    expect(error.fix).toBe("replace --prompt with --prompt-file or --prompt-stdin");
  });

  test("stays silent about a flag with no plausible match", () => {
    const error = catchHarnessError(() => assertFlags({ nope: true }, ["run"]));
    expect(error.message).toBe("unknown option: --nope");
    expect(error.fix).toBeUndefined();
  });
});

describe("plan:init --prompt refusal reported against the real registry", () => {
  test("suggests --prompt-file or --prompt-stdin instead of reading the harness source", async () => {
    const failure = await execute(["plan:init", "--repo", ".", "--run", "x", "--prompt", "y"]).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(HarnessError);
    const error = failure as HarnessError;
    expect(error.message).toBe(
      "unknown option: --prompt; did you mean --prompt-file or --prompt-stdin?",
    );
    expect(error.fix).toBe("replace --prompt with --prompt-file or --prompt-stdin");
  });

  test("still refuses --actor, which plan:init never declares, without inventing a match", async () => {
    const failure = await execute([
      "plan:init",
      "--repo",
      ".",
      "--run",
      "x",
      "--actor",
      "planner",
    ]).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(HarnessError);
    const error = failure as HarnessError;
    expect(error.message).toBe("unknown option: --actor");
    expect(error.fix).toBeUndefined();
  });
});
