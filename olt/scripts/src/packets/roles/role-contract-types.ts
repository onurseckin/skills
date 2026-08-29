import { fileURLToPath } from "node:url";
import {
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  type AgentRole,
} from "../../core/contracts/index.ts";
import {
  isValidatorDomain,
  VALIDATOR_DOMAINS,
  type ValidatorDomain,
} from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";

export const AGENTS_ROOT = fileURLToPath(new URL("../../../../agents", import.meta.url));
export const CHECKLISTS_ROOT = fileURLToPath(new URL("../../../../checklists", import.meta.url));
export const LIST_FIELDS = ["may", "must_not", "commands", "spawns"] as const;
export const KEY_LINE = /^([a-z][a-z_-]*):(?:[ \t]+(.*))?$/u;
export const ITEM_LINE = /^[ \t]+- (.*)$/u;
export const CONTINUATION_LINE = /^[ \t]+(\S.*)$/u;

export type ListField = (typeof LIST_FIELDS)[number];
export type DocumentKind = "role contract" | "checklist";

export { isValidatorDomain, VALIDATOR_DOMAINS, type ValidatorDomain };

export const DOMAIN_ID_PREFIX: Readonly<Record<ValidatorDomain, string>> = {
  "code-quality": "CQ",
  product: "PROD",
  security: "SEC",
  "system-design": "SYS",
  "ui-design": "UI",
};

export interface RoleContract {
  role: AgentRole;
  tier: number;
  may: readonly string[];
  must_not: readonly string[];
  commands: readonly string[];
  spawns: readonly AgentRole[];
  domain?: ValidatorDomain | undefined;
  checklist?: Checklist | undefined;
  text: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface ChecklistItem {
  id: string;
  rule: string;
  rationale: string;
  howToCheck: string;
  severity: "critical" | "important" | "minor";
  sources: readonly string[];
}

export interface Checklist {
  domain: ValidatorDomain;
  title: string;
  items: readonly ChecklistItem[];
  text: string;
  bytes: Uint8Array;
  sha256: string;
}

export function invalid(kind: DocumentKind, source: string, detail: string): never {
  throw new HarnessError("INTEGRITY", `${kind} ${source} is invalid: ${detail}`);
}

export interface ParsedFrontmatter {
  scalars: Map<string, string>;
  lists: Map<string, string[]>;
}

export function isCognitiveValidatorContract(contract: RoleContract): boolean {
  return isCognitiveValidatorRole(contract.role);
}

export function isMechanicValidatorContract(contract: RoleContract): boolean {
  return isMechanicValidatorRole(contract.role);
}

export const CHECKLIST_ITEM_LIST_FIELDS = new Set(["sources"]);
export const CHECKLIST_ITEM_SCALAR_FIELDS = [
  "rule",
  "rationale",
  "how-to-check",
  "severity",
] as const;
export const CHECKLIST_SEVERITIES = new Set(["critical", "important", "minor"]);
export const CHECKLIST_ID = /^[A-Z]{2,6}(?:-[A-Z0-9]+)+-[0-9]{3}$/u;
export const CHECKLIST_DOMAIN_LINE = /^Domain: ([a-z-]+)$/u;
