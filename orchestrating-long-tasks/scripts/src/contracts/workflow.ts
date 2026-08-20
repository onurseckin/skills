import { extname } from "node:path";
import type { JsonObject } from "./json.ts";

/**
 * B12.2: the validator family. Canonical here (not in `packets/role-contract.ts`, which used to own
 * it) because `workflow/review/begin-validation.ts` needs it to size and key a task's per-domain
 * validation collection, and `packets/` already depends on `workflow/` (`role-grant.ts` imports
 * `WorkflowState`) — so `workflow/` importing the domain type back out of `packets/` would run the
 * dependency the wrong way. `packets/role-contract.ts` re-exports these three so its own callers are
 * unaffected by the move.
 */
export type ValidatorDomain = "code-quality" | "product" | "security" | "system-design" | "ui-design";

/** The full domain roster — extensible by design: a new domain is added here and nowhere else needs
 *  to know the closed set. */
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

// Extensions a UI-design validator's standing checklist actually speaks to (layout, typography,
// spacing, responsive behaviour, motion) per B12.2's own worked example (".tsx/.css draws the UI
// validator"). Kept to markup/style/component file types rather than every frontend-adjacent
// extension, so the signal stays a read of the file kind rather than a guess about intent.
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

// Extensions and path fragments B12.2's worked example names for system-design: "a schema or a
// public contract". `.proto`/`.graphql`/`.gql` files are public API contracts by construction;
// `schema`/`contracts/`/`migrations/` path segments are the most repo-independent signal available
// without assuming any one project's directory layout.
const SYSTEM_DESIGN_EXTENSIONS: ReadonlySet<string> = new Set([".graphql", ".gql", ".proto"]);
const SYSTEM_DESIGN_PATH_MARKERS: readonly string[] = ["schema", "contracts/", "migrations/"];

/**
 * B12.2's derivation: which validator domains a task's write scope draws, so dispatch is a checkable
 * rule instead of a caller remembering `--validator-domain`. `code-quality` is unconditional ("every
 * task draws code-quality"); `ui-design` and `system-design` follow the backlog's own worked example.
 * `product` and `security` are real domains (B12.2 lists both) but the backlog states no structural
 * write-scope signal for either, so they are not guessed here — a run that needs one dispatches it
 * explicitly via `--validator-domain`, which `beginValidation` still accepts for exactly this reason.
 * Order is `VALIDATOR_DOMAINS`'s, so the result is deterministic regardless of write-scope order.
 */
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
