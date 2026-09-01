import { afterEach, describe, expect, test } from "bun:test";
import { executePreparedCommand } from "../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type {
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupTempRoots, tempRoot } from "./fixture.ts";

function broadPrepared(repo: string, argv: readonly string[] = ["bun", "test"]): PreparedCommand {
  return {
    commandRoot: "root",
    options: {
      runRoot: repo,
      repositoryRoot: repo,
      argv,
    } as unknown as PreparedCommand["options"],
  };
}

function broadRunner(onExecute: () => Promise<CommandResult>): InternalCommandRunner {
  return {
    prepareCommand: async () => ({}) as PreparedCommand,
    executePreparedCommand: onExecute,
  };
}

afterEach(cleanupTempRoots);

describe("run-command broad scope mutex contenders and signals", () => {
  test("does not install process signal listeners during repeated broad runs", async () => {
    const repo = tempRoot("mutex-signals");
    const signals = ["exit", "SIGINT", "SIGTERM"] as const;
    const before = signals.map((signal) => process.listenerCount(signal));
    for (let iteration = 0; iteration < 2; iteration += 1) {
      await executePreparedCommand(
        broadPrepared(repo),
        broadRunner(
          async () => ({ record: { id: String(iteration) } }) as unknown as CommandResult,
        ),
      );
    }
    expect(signals.map((signal) => process.listenerCount(signal))).toEqual(before);
  });

  test("allows only one contender to enter a held broad run and rejects concurrent contender with LOCK_TIMEOUT", async () => {
    const repo = tempRoot("mutex-contenders");
    const events: string[] = [];
    let releaseHold: () => void = () => {};
    const holdPromise = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    const firstPromise = executePreparedCommand(
      broadPrepared(repo),
      broadRunner(async () => {
        events.push("entered");
        await holdPromise;
        return { record: { id: "first" } } as unknown as CommandResult;
      }),
    );

    // Wait until first contender has entered and acquired the lock
    while (!events.includes("entered")) {
      await Bun.sleep(5);
    }

    // Second contender attempts to run while first holds lock -> must fail with LOCK_TIMEOUT
    try {
      await executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          events.push("second-entered");
          return { record: { id: "second" } } as unknown as CommandResult;
        }),
      );
    } catch (error) {
      if (error instanceof HarnessError) {
        events.push(error.code);
      } else {
        events.push("unknown-error");
      }
    }

    // Release the first contender
    releaseHold();
    const firstResult = await firstPromise;
    expect(firstResult).toBeDefined();
    events.push("success");

    expect(events.filter((event) => event === "entered")).toHaveLength(1);
    expect(events.filter((event) => event === "success")).toHaveLength(1);
    expect(events.filter((event) => event === "LOCK_TIMEOUT")).toHaveLength(1);
  });

  test("releases mutex lock after failure or error for a later broad run", async () => {
    const repo = tempRoot("mutex-release");
    let crashed = false;

    try {
      await executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          crashed = true;
          throw new Error("simulated-crash-error");
        }),
      );
    } catch (error) {
      expect((error as Error).message).toBe("simulated-crash-error");
    }
    expect(crashed).toBe(true);

    let ran = false;
    await executePreparedCommand(
      broadPrepared(repo),
      broadRunner(async () => {
        ran = true;
        return { record: { id: "after-crash" } } as unknown as CommandResult;
      }),
    );
    expect(ran).toBe(true);
  });
});
