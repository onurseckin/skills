import { HarnessError } from "../core/errors/index.ts";
import type { RepositoryGitCommand } from "./repository-git-command.ts";

const HELPER_KEYS =
  "^(diff\\.external|diff\\..*\\.textconv|filter\\..*\\.(clean|smudge|process)|core\\.fsmonitor)$";
const DISABLED = /^(?:0|false|no|off)$/iu;

function records(bytes: Buffer): { key: string; value: string }[] {
  if (bytes.byteLength === 0 || bytes.at(-1) !== 0)
    throw new HarnessError("INTEGRITY", "repository local Git helper config output is invalid");
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, -1));
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `repository local Git helper config is not UTF-8: ${String(error)}`,
    );
  }
  return value.split("\0").map((record) => {
    const separator = record.indexOf("\n");
    if (separator < 1)
      throw new HarnessError("INTEGRITY", "repository local Git helper config output is invalid");
    return { key: record.slice(0, separator), value: record.slice(separator + 1) };
  });
}

export function rejectLocalGitHelpers(
  repo: string,
  path: string,
  maximum: number,
  command: RepositoryGitCommand,
): void {
  const result = command(
    repo,
    ["config", "--file", path, "--no-includes", "--null", "--get-regexp", HELPER_KEYS],
    maximum,
    [0, 1],
  );
  if (result.status !== 0) return;
  for (const { key, value } of records(result.bytes)) {
    const normalized = key.toLowerCase();
    if (normalized === "core.fsmonitor" && DISABLED.test(value.trim())) continue;
    throw new HarnessError(
      "INTEGRITY",
      `repository local Git helper configuration is unsupported: ${key}`,
    );
  }
}
