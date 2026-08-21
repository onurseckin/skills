import { extname } from "node:path";
import type { JsonObject } from "./json.ts";

export type ValidatorDomain =
  | "code-quality"
  | "product"
  | "security"
  | "system-design"
  | "ui-design";

export const VALIDATOR_DOMAINS: readonly ValidatorDomain[] = [
  "code-quality",
  "product",
  "security",
  "system-design",
  "ui-design",
];

export function isValidatorDomain(value: string): value is ValidatorDomain {
  return (VALIDATOR_DOMAINS as readonly string[]).includes(value);
}

const UI_DESIGN_EXTENSIONS: ReadonlySet<string> = new Set([
  ".css",
  ".html",
  ".jsx",
  ".less",
  ".sass",
  ".scss",
  ".svelte",
  ".tsx",
  ".vue",
]);

const SYSTEM_DESIGN_EXTENSIONS: ReadonlySet<string> = new Set([".graphql", ".gql", ".proto"]);
const SYSTEM_DESIGN_PATH_MARKERS: readonly string[] = ["schema", "contracts/", "migrations/"];

export function applicableValidatorDomains(writeScope: readonly string[]): ValidatorDomain[] {
  const domains = new Set<ValidatorDomain>(["code-quality"]);
  for (const rawScope of writeScope) {
    const scope = rawScope.toLowerCase();
    const ext = extname(scope);
    if (UI_DESIGN_EXTENSIONS.has(ext)) domains.add("ui-design");
    if (
      SYSTEM_DESIGN_EXTENSIONS.has(ext) ||
      SYSTEM_DESIGN_PATH_MARKERS.some((marker) => scope.includes(marker))
    )
      domains.add("system-design");
  }
  return VALIDATOR_DOMAINS.filter((domain) => domains.has(domain));
}

export type TaskStatus =
  | "blocked"
  | "branched"
  | "cancelled"
  | "changes_requested"
  | "done"
  | "escalated"
  | "gating"
  | "leased"
  | "proposed"
  | "ready"
  | "retry_ready"
  | "running"
  | "stale"
  | "submitted"
  | "validated"
  | "validating";

export interface Lease extends JsonObject {
  agent_id: string;
  role: string;
  attempt: number;
  token_digest: string;
  issued_at: string;
  expires_at: string;
  heartbeat_at: string;
  duration_seconds: number;
}

export interface Finding extends JsonObject {
  id: string;
  requirement_id: string;
  severity: "critical" | "important" | "minor";
  observation: string;
  evidence: JsonObject[];
  remediation: string;
  revalidation: string;
  status: "open" | "resolved";
}

export interface GateResult extends JsonObject {
  gate_id: string;
  command_id: string;
  status: "passed";
}
