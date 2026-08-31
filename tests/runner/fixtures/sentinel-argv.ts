import { basename } from "node:path";

export function sentinelCommandArgv(processArgv: readonly string[]): string[] {
  const separator = processArgv.indexOf("--");
  const forwarded = processArgv.slice(separator >= 0 ? separator + 1 : 2);
  if (forwarded[0] === "--") forwarded.shift();
  return forwarded.length >= 3 && basename(forwarded[0] ?? "") === "bun" && forwarded[1] === "test"
    ? forwarded
    : [];
}
