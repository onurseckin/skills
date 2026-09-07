import { CliError, executeCommand, helpRequest, renderHelp } from "./scripts/index.ts";

function extractExitCode(error: unknown): number {
  if (error instanceof CliError) {
    return error.exitCode;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    typeof (error as { readonly exitCode: unknown }).exitCode === "number"
  ) {
    return (error as { readonly exitCode: number }).exitCode;
  }
  return 1;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function main(argv: readonly string[]): Promise<void> {
  const help = helpRequest(argv);
  if (help !== null) {
    process.stdout.write(`${renderHelp(help.command)}\n`);
    return;
  }

  const result = await executeCommand(argv);
  const isJson = argv.includes("--json");

  if (isJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (typeof result["markdown"] === "string" && result["markdown"].length > 0) {
    process.stdout.write(`${result["markdown"]}\n`);
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  main(argv).catch((error: unknown) => {
    const isJson = argv.includes("--json");
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { readonly code: unknown }).code)
        : "ERROR";
    const message = extractErrorMessage(error);
    const exitCode = extractExitCode(error);

    if (isJson) {
      process.stderr.write(
        `${JSON.stringify({ ok: false, error: { code, message, exitCode } })}\n`,
      );
    } else {
      process.stderr.write(`error [${code}]: ${message}\n`);
    }
    process.exit(exitCode);
  });
}
