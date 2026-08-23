import { delimiter, isAbsolute } from "node:path";
import { RESTRICTED_GIT_ENVIRONMENT } from "../../core/restricted-git.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { OWNERSHIP_ENV } from "./pipe-ownership.ts";

const PASSTHROUGH = ["LANG", "LC_ALL", "LC_CTYPE", "PATH", "TMPDIR", "TZ"] as const;
const TOOL_OVERRIDES: ReadonlyArray<readonly [string, string]> = [
  ["GOENV", "off"],
  ["NPM_CONFIG_GLOBALCONFIG", "/dev/null"],
  ["NPM_CONFIG_USERCONFIG", "/dev/null"],
  ["PYTHONNOUSERSITE", "1"],
  ["PYTEST_DISABLE_PLUGIN_AUTOLOAD", "1"],
];
const EXACT: Readonly<Record<string, string>> = {
  ...RESTRICTED_GIT_ENVIRONMENT,
  ...Object.fromEntries(TOOL_OVERRIDES),
};
const ALLOWED = new Set([...PASSTHROUGH, ...Object.keys(EXACT), OWNERSHIP_ENV]);

function validPath(value: string): boolean {
  const parts = value.split(delimiter);
  return parts.length > 0 && parts.every((part) => Boolean(part) && isAbsolute(part));
}

export function captureGateEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  ownershipToken: string,
): Record<string, string> {
  const result: Record<string, string> = { ...EXACT, [OWNERSHIP_ENV]: ownershipToken };
  for (const key of PASSTHROUGH) {
    const value = source[key];
    if (value !== undefined && value !== "") result[key] = value;
  }
  if (!result.PATH || !validPath(result.PATH))
    throw new HarnessError("PATH_SAFETY", "gate PATH must contain only absolute directories");
  return result;
}

export function gateEnvironmentIssues(environment: Record<string, string> | undefined): string[] {
  if (!environment) return ["gate environment is missing"];
  if (
    Object.entries(environment).some(
      ([key, value]) => !ALLOWED.has(key) || typeof value !== "string" || !value,
    )
  )
    return ["gate environment contains an unbound or invalid variable"];
  if (!validPath(environment.PATH ?? "")) return ["gate environment PATH is unsafe"];
  for (const [key, value] of Object.entries(EXACT))
    if (environment[key] !== value) return [`gate environment ${key} is not restricted`];
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      environment[OWNERSHIP_ENV] ?? "",
    )
  )
    return ["gate environment ownership token is invalid"];
  return [];
}
