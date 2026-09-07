import { main } from "../index.ts";

export { main };

if (import.meta.main) {
  const argv = process.argv.slice(2);
  main(argv).catch((error: unknown) => {
    const isJson = argv.includes("--json");
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { readonly code: unknown }).code)
        : "ERROR";
    const message = error instanceof Error ? error.message : String(error);
    const exitCode =
      typeof error === "object" &&
      error !== null &&
      "exitCode" in error &&
      typeof (error as { readonly exitCode: unknown }).exitCode === "number"
        ? (error as { readonly exitCode: number }).exitCode
        : 1;

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
