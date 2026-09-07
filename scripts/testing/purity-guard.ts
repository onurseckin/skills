import { runPurityGuardMain } from "./guardrails/index.ts";

const code = await runPurityGuardMain(process.argv.slice(2));
if (code !== 0) {
  process.exit(code);
}
