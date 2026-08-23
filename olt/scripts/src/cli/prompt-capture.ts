import { existsSync, readFileSync } from "node:fs";
import { HarnessError } from "../errors/harness-error.ts";

export async function capturePromptWithTimeout(
  inlineText: string | undefined,
  options: {
    promptFile?: string | undefined;
    promptStdin?: boolean | undefined;
    timeoutMs?: number | undefined;
  } = {},
): Promise<string> {
  // 1. Explicit inline prompt takes immediate precedence
  if (inlineText && inlineText.trim().length > 0) {
    return inlineText.trim();
  }

  // 2. Explicit file prompt
  if (options.promptFile) {
    if (!existsSync(options.promptFile)) {
      throw new HarnessError("INVALID_ARGUMENT", `prompt file not found: ${options.promptFile}`);
    }
    return readFileSync(options.promptFile, "utf-8").trim();
  }

  // 3. Stdin with non-blocking race timeout
  const timeoutMs = options.timeoutMs ?? 500;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new HarnessError(
          "INVALID_ARGUMENT",
          `orchestrate init timed out after ${timeoutMs}ms waiting on stdin input. Pass prompt as inline argument: bun harness.ts orchestrate "<prompt>"`,
        ),
      );
    }, timeoutMs);

    let buffer = "";
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
    };

    const onEnd = () => {
      cleanup();
      if (buffer.trim().length === 0) {
        reject(
          new HarnessError(
            "INVALID_ARGUMENT",
            "received empty prompt from stdin. Pass prompt as inline argument.",
          ),
        );
      } else {
        resolve(buffer.trim());
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(new HarnessError("INVALID_ARGUMENT", `failed reading stdin: ${err.message}`));
    };

    function cleanup() {
      clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      process.stdin.pause();
    }

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}
