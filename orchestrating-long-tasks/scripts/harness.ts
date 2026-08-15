#!/usr/bin/env bun

import { fileURLToPath } from "node:url";
import { HarnessError } from "./src/errors/harness-error.ts";
import { normalizeError } from "./src/errors/normalize-error.ts";
import { execute } from "./src/cli/execute.ts";
import { shouldReadPromptStdin } from "./src/cli/prompt-input.ts";

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
  const isJsonFormat =
    argv.includes("--format=json") ||
    argv.some((arg, idx) => arg === "--format" && argv[idx + 1] === "json");
  const filteredArgv = argv.filter(
    (arg, idx) =>
      arg !== "--format=json" && arg !== "--format" && (idx === 0 || argv[idx - 1] !== "--format"),
  );
  const context = shouldReadPromptStdin(filteredArgv)
    ? { stdin: await stdinBytes(), executingRuntime }
    : { executingRuntime };
  const result = await execute(filteredArgv, context);
  if (
    !isJsonFormat &&
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
