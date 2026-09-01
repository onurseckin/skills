import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { helpRequest, renderHelp } from "../../../olt/scripts/src/cli/help.ts";
import { COMMAND_REGISTRY } from "../../../olt/scripts/src/cli/registry/index.ts";

import {
  formatCliError,
  propagateCliExitCode,
} from "../../../olt/scripts/src/cli/signals/index.ts";
import { stripOutputFormat } from "../../../olt/scripts/src/cli/output-format.ts";
import { main } from "../../../olt/scripts/harness.ts";

async function harness(
  args: readonly string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const origExitCode = process.exitCode;
  process.exitCode = 0;
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    await main(args);
  } catch (error: unknown) {
    const isJson = stripOutputFormat(args).json;
    process.stderr.write(formatCliError(error, { json: isJson }));
    propagateCliExitCode(error);
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
  const exit = process.exitCode ?? 0;
  process.exitCode = origExitCode;
  return { exit, stdout, stderr };
}

describe("CLI help", () => {
  test("recognises the help command and the --help intercept", () => {
    expect(helpRequest(["help"])).toEqual({ command: null });
    expect(helpRequest(["help", "task:claim"])).toEqual({ command: "task:claim" });
    expect(helpRequest(["--help"])).toEqual({ command: null });
    expect(helpRequest(["task:claim", "--help"])).toEqual({ command: "task:claim" });
    expect(helpRequest(["run:status", "--run", "/tmp/run"])).toBeNull();
  });

  test("ignores a --help that belongs to a child command", () => {
    expect(
      helpRequest(["run:exec", "--run", "/tmp/run", "--", "bun", "test", "--help"]),
    ).toBeNull();
  });

  test("renders the command list as a brief of at most 30 lines", () => {
    const overview = renderHelp(null);
    const lines = overview.split("\n");
    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines[0]).toBe("### Harness CLI");
    for (const domain of ["plan", "queue", "task", "run", "doctor", "mind"]) {
      expect(overview).toContain(`| ${domain} |`);
    }
    expect(overview).toContain("`plan:compile`");
    expect(overview).toContain("bun harness.ts help <command>");

    const internalOverview = renderHelp(null, { internal: true });
    const internalLines = internalOverview.split("\n");
    expect(internalLines.length).toBeLessThanOrEqual(30);
    expect(internalLines[0]).toBe("### Harness CLI (Internal Tier)");
    for (const domain of ["agent", "authority", "branch", "critic", "diagnostics", "install"]) {
      expect(internalOverview).toContain(`| ${domain} |`);
    }
  });

  test("renders full flag detail for a single command", () => {
    const detail = renderHelp("run:exec");
    expect(detail).toContain("### `run:exec`");
    expect(detail).toContain("| `--gate` | string | no | no |");
    expect(detail).toContain("**Arguments after `--`**: forwarded to the child process");
    expect(detail).toContain("**Exit codes**");
    expect(detail).toContain("bun harness.ts run:exec --run .olt/capsules/<run-id>");
  });

  test("reports the stdin rule", () => {
    expect(renderHelp("orchestrator:run")).toContain(
      "**Stdin**: reads stdin when `--prompt-stdin` is set",
    );
    expect(renderHelp("plan:status")).toContain("**Stdin**: not read");
  });

  test("documents every registered command", () => {
    for (const spec of COMMAND_REGISTRY) {
      expect(renderHelp(spec.name)).toContain(spec.summary);
    }
  });

  test("serves help from the entrypoint before the parser sees the argv", async () => {
    const listing = await harness(["help"]);
    expect(listing.exit).toBe(0);
    expect(listing.stdout).toContain("### Harness CLI");

    const detail = await harness(["queue:pop", "--help"]);
    expect(detail.exit).toBe(0);
    expect(detail.stdout).toContain("### `queue:pop`");

    const bare = await harness(["--help"]);
    expect(bare.exit).toBe(0);
    expect(bare.stdout).toContain("### Harness CLI");

    const unknown = await harness(["help", "nope"]);
    expect(unknown.exit).toBe(3);
    expect(unknown.stderr).toContain("INVALID_ARGUMENT");
    expect(unknown.stderr).toContain("unknown command: nope");
  });

  test("ignores a --help standing in a flag value position", () => {
    expect(helpRequest(["plan:add", "--label", "--help", "--run", "/tmp/run"])).toBeNull();
    expect(helpRequest(["plan:add", "--goal", "--help"])).toBeNull();
    expect(helpRequest(["plan:add", "--label", "--help", "--help"])).toEqual({
      command: "plan:add",
    });
    expect(helpRequest(["plan:add", "--run", "/tmp/run", "--help"])).toEqual({
      command: "plan:add",
    });
  });

  test("runs the command instead of printing help when --help is a flag value", async () => {
    const run = await harness([
      "plan:add",
      "--label",
      "--help",
      "--run",
      "/tmp/run",
      "--actor",
      "planner",
    ]);
    expect(run.exit).toBe(3);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("INVALID_ARGUMENT");
  });

  test("refuses an unknown command", () => {
    expect(() => renderHelp("nope")).toThrow("unknown command: nope");
  });
});
