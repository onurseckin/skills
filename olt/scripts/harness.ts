#!/usr/bin/env bun

import { fileURLToPath } from "node:url";
import { HarnessError } from "./src/core/errors/harness-error.ts";
import { execute } from "./src/cli/execute.ts";
import { helpRequest, renderHelp } from "./src/cli/help.ts";
import { stripOutputFormat } from "./src/cli/output-format.ts";
import {
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
  shouldReadPromptStdin,
} from "./src/cli/prompt-input.ts";
import { formatCliError, propagateCliExitCode, setupSignalTraps } from "./src/cli/signals/index.ts";

async function stdinBytes(maximum = 64 * 1024 * 1024): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.byteLength;
    if (total > maximum) throw new HarnessError("INVALID_ARGUMENT", "stdin exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function main(argv: readonly string[]): Promise<void> {
  const executingRuntime = fileURLToPath(new URL(".", import.meta.url));
  const format = stripOutputFormat(argv);
  const help = helpRequest(format.argv);
  if (help !== null) {
    process.stdout.write(
      `${renderHelp(help.command, help.internal !== undefined ? { internal: help.internal } : undefined)}\n`,
    );
    return;
  }
  const { argv: execArgv, inlinePrompt } = extractOrchestrateInlinePrompt(format.argv);
  const readStdin =
    inlinePrompt === undefined &&
    (shouldReadPromptStdin(execArgv) ||
      shouldAutoReadOrchestrateStdin(format.argv, process.stdin.isTTY === true));
  const context = {
    executingRuntime,
    ...(inlinePrompt === undefined ? {} : { inlinePrompt }),
    ...(readStdin ? { stdin: await stdinBytes() } : {}),
  };
  const result = await execute(execArgv, context);
  const isJsonOutput =
    format.json ||
    (typeof result === "object" && result !== null && "json" in result && result.json === true);
  if (
    !isJsonOutput &&
    typeof result === "object" &&
    result !== null &&
    "markdown" in result &&
    typeof result.markdown === "string"
  ) {
    process.stdout.write(`${result.markdown}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  }
}

if (import.meta.main) {
  setupSignalTraps();
  const argv = Bun.argv.slice(2);
  main(argv).catch((error: unknown) => {
    const isJson = stripOutputFormat(argv).json;
    process.stderr.write(formatCliError(error, { json: isJson }));
    propagateCliExitCode(error);
  });
}
