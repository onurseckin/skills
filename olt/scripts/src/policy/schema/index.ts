import { HarnessError } from "../../core/errors/index.ts";
import { DEFAULT_PLANNING_POLICY, DEFAULT_REVIEW_PROTOCOL_POLICY } from "../generator/index.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  type PackageManager,
  type RepoEcosystem,
  type RepoPolicy,
} from "../types/index.ts";
import { parseAgents } from "./agent-schema.ts";
import { parseDockerEnv } from "./docker-schema.ts";
import { assertAllowedKeys, integrity, isRecord, reqInt, reqString } from "./primitives.ts";
import {
  parseCommandList,
  parseHooks,
  parsePlanning,
  parseReviewProtocol,
  parseTestRunner,
} from "./workflow-schema.ts";

export {
  CANONICAL_HOSTS,
  parseAgentPolicy,
  parseAgents,
  parseHostPolicy,
  parseQuotas,
  parseRbac,
  parseSchedulerPolicy,
} from "./agent-schema.ts";
export {
  parseAuthPaths,
  parseContainerConfig,
  parseCookieTemplate,
  parseDockerEnv,
  parseUserPersona,
} from "./docker-schema.ts";
export {
  assertAllowedKeys,
  integrity,
  invalidArg,
  isRecord,
  reqBool,
  reqInt,
  reqString,
} from "./primitives.ts";
export {
  parseCommandList,
  parseHooks,
  parsePlanning,
  parseReviewProtocol,
  parseTestRunner,
} from "./workflow-schema.ts";
export { validateRepoPolicy } from "./validator.ts";

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "schema_version",
  "ecosystem",
  "package_manager",
  "skill_home_repo_root",
  "test_runner",
  "typecheck_command",
  "lint_command",
  "allowed_commands",
  "forbidden_commands",
  "read_scope_neighborhood_depth",
  "review_protocol",
  "planning",
  "agents",
  "docker_environment",
  "hooks",
  "provenance",
]);

const ECOSYSTEMS: ReadonlySet<string> = new Set(["bun", "node", "python", "cargo", "unknown"]);
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set([
  "bun",
  "npm",
  "pnpm",
  "yarn",
  "poetry",
  "pipenv",
  "pip",
  "cargo",
  "unknown",
]);

export function parseRepoPolicy(raw: unknown): RepoPolicy {
  if (!isRecord(raw)) throw new HarnessError("INVALID_ARGUMENT", "Repo policy must be an object");
  assertAllowedKeys(raw, TOP_LEVEL_KEYS, "$", "invalid_argument");

  const rawVer = raw["schema_version"] !== undefined ? raw["schema_version"] : CURRENT_POLICY_SCHEMA_VERSION;
  const ver = reqInt(rawVer, "$.schema_version", 1);
  if (ver !== CURRENT_POLICY_SCHEMA_VERSION) {
    integrity("$.schema_version", `must equal supported version ${CURRENT_POLICY_SCHEMA_VERSION}`);
  }

  const rawEco =
    raw["ecosystem"] !== undefined ? reqString(raw["ecosystem"], "$.ecosystem") : "unknown";
  if (!ECOSYSTEMS.has(rawEco)) {
    integrity("$.ecosystem", "must be one of bun, node, python, cargo, or unknown");
  }

  let pm: PackageManager | undefined;
  if (raw["package_manager"] !== undefined) {
    const p = reqString(raw["package_manager"], "$.package_manager");
    if (!PACKAGE_MANAGERS.has(p)) integrity("$.package_manager", "invalid package_manager");
    pm = p as PackageManager;
  }

  const testRunner = parseTestRunner(raw["test_runner"], "$.test_runner");
  const allowed = parseCommandList(raw["allowed_commands"], "allowed_commands");
  const forbidden = parseCommandList(raw["forbidden_commands"], "forbidden_commands");

  if (allowed && forbidden) {
    const allowedSet = new Set(allowed);
    for (const c of forbidden) {
      if (allowedSet.has(c)) {
        integrity("$.forbidden_commands", `conflicts with allowed command '${c}'`);
      }
    }
  }

  const agents = parseAgents(raw["agents"], "$.agents");

  return {
    schema_version: ver,
    ecosystem: rawEco as RepoEcosystem,
    ...(pm !== undefined ? { package_manager: pm } : {}),
    ...(raw["skill_home_repo_root"] !== undefined
      ? { skill_home_repo_root: reqString(raw["skill_home_repo_root"], "$.skill_home_repo_root") }
      : {}),
    test_runner: testRunner,
    ...(raw["typecheck_command"] !== undefined
      ? { typecheck_command: reqString(raw["typecheck_command"], "$.typecheck_command") }
      : {}),
    ...(raw["lint_command"] !== undefined
      ? { lint_command: reqString(raw["lint_command"], "$.lint_command") }
      : {}),
    ...(allowed !== undefined ? { allowed_commands: allowed } : {}),
    ...(forbidden !== undefined ? { forbidden_commands: forbidden } : {}),
    read_scope_neighborhood_depth:
      raw["read_scope_neighborhood_depth"] !== undefined
        ? reqInt(raw["read_scope_neighborhood_depth"], "$.read_scope_neighborhood_depth", 0, 64)
        : 2,
    review_protocol:
      raw["review_protocol"] !== undefined
        ? parseReviewProtocol(raw["review_protocol"], "$.review_protocol")
        : { ...DEFAULT_REVIEW_PROTOCOL_POLICY },
    planning:
      raw["planning"] !== undefined
        ? parsePlanning(raw["planning"], "$.planning")
        : { ...DEFAULT_PLANNING_POLICY },
    ...(agents !== undefined ? { agents } : {}),
    ...(raw["docker_environment"] !== undefined
      ? { docker_environment: parseDockerEnv(raw["docker_environment"], "$.docker_environment") }
      : {}),
    ...(raw["hooks"] !== undefined ? { hooks: parseHooks(raw["hooks"], "$.hooks") } : {}),
    ...(raw["provenance"] !== undefined ? { provenance: reqString(raw["provenance"], "$.provenance") } : {}),
  };
}
