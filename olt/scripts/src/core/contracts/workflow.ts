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

const UI_TEXT_MARKERS: readonly RegExp[] = [
  /\bui\b/i,
  /\bux\b/i,
  /\bscreenshots?\b/i,
  /\bvisual(ly)?\b/i,
  /\bfront-?end\b/i,
  /\bviewports?\b/i,
  /\bresponsive\b/i,
  /\bwcag\b/i,
  /\bcontrast ratio\b/i,
  /\baccessib(le|ility)\b/i,
  /\bdom metrics\b/i,
  /\bdual-channel\b/i,
];

function isDocOnlyScope(writeScope: readonly string[]): boolean {
  return (
    writeScope.length > 0 &&
    writeScope.every((raw) => {
      const s = raw.toLowerCase();
      return (
        s.startsWith("docs") ||
        s.includes("/docs") ||
        s.endsWith(".md") ||
        s.endsWith(".mdx") ||
        s.endsWith(".txt")
      );
    })
  );
}

export function textSignalsUiDomain(texts: readonly string[]): boolean {
  return texts.some((text) => UI_TEXT_MARKERS.some((marker) => marker.test(text)));
}

export function applicableValidatorDomains(
  writeScope: readonly string[],
  requirementTexts: readonly string[] = [],
): ValidatorDomain[] {
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
  if (!isDocOnlyScope(writeScope) && textSignalsUiDomain(requirementTexts)) {
    domains.add("ui-design");
  }
  return VALIDATOR_DOMAINS.filter((domain) => domains.has(domain));
}

export function uiDomainApplies(
  writeScope: readonly string[],
  requirementTexts: readonly string[] = [],
): boolean {
  return applicableValidatorDomains(writeScope, requirementTexts).includes("ui-design");
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
  micro_cycles?: MicroCycleRecord[];
  micro_cycle_round?: number;
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
  kind?: "defect" | "cognitive_probe" | "adversarial_probe" | string;
}

export interface GateResult extends JsonObject {
  gate_id: string;
  command_id: string;
  status: "passed";
}

export type CoordinatorPushbackCause = "procedural" | "substantive";

export function isCoordinatorPushbackCause(value: unknown): value is CoordinatorPushbackCause {
  return value === "procedural" || value === "substantive";
}

export interface CoordinatorPushback extends JsonObject {
  id: string;
  validator_id: string;
  domain: ValidatorDomain;
  cause: CoordinatorPushbackCause;
  observation: string;
  remediation: string;
  review_round: number;
  created_at: string;
}

export type MicroCycleStatus = "open" | "addressed";

export interface MicroCycleRecord extends JsonObject {
  round: number;
  validator_id: string;
  critique: string;
  suggested_remediation?: string;
  observed_defect?: string;
  created_at: string;
  status: MicroCycleStatus;
}

export function isMicroCycleRecord(value: unknown): value is MicroCycleRecord {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec["round"] === "number" &&
    Number.isSafeInteger(rec["round"]) &&
    rec["round"] > 0 &&
    typeof rec["validator_id"] === "string" &&
    rec["validator_id"].trim().length > 0 &&
    typeof rec["critique"] === "string" &&
    rec["critique"].trim().length > 0 &&
    (rec["status"] === "open" || rec["status"] === "addressed") &&
    typeof rec["created_at"] === "string" &&
    (rec["suggested_remediation"] === undefined ||
      typeof rec["suggested_remediation"] === "string") &&
    (rec["observed_defect"] === undefined || typeof rec["observed_defect"] === "string")
  );
}

export function isStructuredFinding(value: unknown): value is Finding {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec["id"] === "string" &&
    rec["id"].trim().length > 0 &&
    typeof rec["requirement_id"] === "string" &&
    rec["requirement_id"].trim().length > 0 &&
    (rec["severity"] === "critical" ||
      rec["severity"] === "important" ||
      rec["severity"] === "minor") &&
    typeof rec["observation"] === "string" &&
    rec["observation"].trim().length > 0 &&
    Array.isArray(rec["evidence"]) &&
    typeof rec["remediation"] === "string" &&
    rec["remediation"].trim().length > 0 &&
    typeof rec["revalidation"] === "string" &&
    rec["revalidation"].trim().length > 0 &&
    (rec["status"] === "open" || rec["status"] === "resolved")
  );
}

export function isCoordinatorPushback(value: unknown): value is CoordinatorPushback {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec["id"] === "string" &&
    rec["id"].trim().length > 0 &&
    typeof rec["validator_id"] === "string" &&
    rec["validator_id"].trim().length > 0 &&
    typeof rec["domain"] === "string" &&
    isValidatorDomain(rec["domain"]) &&
    isCoordinatorPushbackCause(rec["cause"]) &&
    typeof rec["observation"] === "string" &&
    rec["observation"].trim().length > 0 &&
    typeof rec["remediation"] === "string" &&
    rec["remediation"].trim().length > 0 &&
    typeof rec["review_round"] === "number" &&
    Number.isSafeInteger(rec["review_round"]) &&
    typeof rec["created_at"] === "string"
  );
}
