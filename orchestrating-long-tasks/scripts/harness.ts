#!/usr/bin/env bun

import { fileURLToPath } from "node:url";
import { HarnessError } from "./src/errors/harness-error.ts";
import { normalizeError } from "./src/errors/normalize-error.ts";
import { execute } from "./src/cli/execute.ts";
import { helpRequest, renderHelp } from "./src/cli/help.ts";
import { stripOutputFormat } from "./src/cli/output-format.ts";
import {
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
  shouldReadPromptStdin,
} from "./src/cli/prompt-input.ts";

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
    process.stdout.write(`${renderHelp(help.command)}\n`);
    return;
  }
  // B16's bare form: an inline free-text prompt is pulled out of argv before execute() ever sees
  // it (the shared parser rejects a bare positional for every other command, on purpose), and a
  // piped stdin with no flags at all is picked up the same way `cat`/`grep` do it — by checking
  // whether stdin is actually a pipe, never by requiring a flag the user has to already know about.
  const { argv: execArgv, inlinePrompt } = extractOrchestrateInlinePrompt(format.argv);
  const readStdin =
    shouldReadPromptStdin(execArgv) ||
    shouldAutoReadOrchestrateStdin(execArgv, process.stdin.isTTY === true);
  const context = {
    executingRuntime,
    ...(inlinePrompt === undefined ? {} : { inlinePrompt }),
    ...(readStdin ? { stdin: await stdinBytes() } : {}),
  };
  const result = await execute(execArgv, context);
  if (
    !format.json &&
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
  main(Bun.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: normalizeError(error) })}\n`);
    process.exitCode = error instanceof HarnessError ? error.exitCode : 70;
  });
}
