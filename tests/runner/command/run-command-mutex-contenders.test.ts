import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executePreparedCommand } from "../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type {
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";

const runCommandModule = new URL(
  "../../../../olt/scripts/src/engine/runner/models/execution/run-command.ts",
  import.meta.url,
).href;

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

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for child lock state");
    await Bun.sleep(10);
  }
}

function childContenderProgram(
  repo: string,
  marker: string,
  release: string,
  crash = false,
): string {
  return `
    import { appendFileSync, existsSync } from "node:fs";
    import { executePreparedCommand } from ${JSON.stringify(runCommandModule)};
    const prepared = {
      commandRoot: "root",
      options: { runRoot: ${JSON.stringify(repo)}, repositoryRoot: ${JSON.stringify(repo)}, argv: ["bun", "test"] },
    };
    const runner = {
      prepareCommand: async () => ({}),
      executePreparedCommand: async () => {
        appendFileSync(${JSON.stringify(marker)}, "entered\\n");
        ${crash ? "process.exit(22);" : `while (!existsSync(${JSON.stringify(release)})) await Bun.sleep(5);`}
        return { record: { id: "child" } };
      },
    };
    try {
      await executePreparedCommand(prepared, runner);
      appendFileSync(${JSON.stringify(marker)}, "success\\n");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
      appendFileSync(${JSON.stringify(marker)}, String(code) + "\\n");
    }
  `;
}

describe("run-command broad scope mutex contenders and signals", () => {
  test("does not install process signal listeners during repeated broad runs", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-listeners");
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

  test("allows only one of two real child contenders to enter a held broad run", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-child-contenders");
    const marker = join(repo, "marker.log");
    const release = join(repo, "release");
    const first = Bun.spawn(
      [process.execPath, "--eval", childContenderProgram(repo, marker, release)],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const second = Bun.spawn(
      [process.execPath, "--eval", childContenderProgram(repo, marker, release)],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await waitFor(() => existsSync(marker) && readFileSync(marker, "utf-8").includes("entered\n"));
    await waitFor(() => readFileSync(marker, "utf-8").includes("LOCK_TIMEOUT\n"));
    writeFileSync(release, "release", "utf-8");
    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    const events = readFileSync(marker, "utf-8").trim().split("\n");
    expect(events.filter((event) => event === "entered")).toHaveLength(1);
    expect(events.filter((event) => event === "success")).toHaveLength(1);
    expect(events.filter((event) => event === "LOCK_TIMEOUT")).toHaveLength(1);
  });

  test("kernel releases a crash holder's flock for a later broad run", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-crash-release");
    const marker = join(repo, "crash-marker.log");
    const child = Bun.spawn(
      [process.execPath, "--eval", childContenderProgram(repo, marker, join(repo, "unused"), true)],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(22);
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
