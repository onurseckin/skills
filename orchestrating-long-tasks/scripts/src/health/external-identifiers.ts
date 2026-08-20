/**
 * Names that belong to another application's contract and that this repo will never define. B30's
 * host-capability research and B27's concurrency research cite tool names, parameter names and
 * environment variables the HOST owns (Claude Code, Antigravity, Codex, ...) so the backlog can
 * reason about them. This repo reaches a host through its own adapters, never by declaring the
 * host's identifier, so intent-drift would otherwise read every such citation as a missing
 * implementation.
 *
 * A name belongs here only when a requirement doc names it to describe a HOST's own surface AND no
 * file in this repo reads it. The moment this repo touches the name it becomes checkable - the
 * requirement can be held to a call site and a test - and exempting it would hide that gap instead
 * of a false positive. That is why every host variable `summary/host-telemetry.ts` probes - the
 * model variables and both subagent ceilings - is deliberately absent from this list: each is read
 * here, so each stays judged. Spelling one out in this comment would make it "present" by prose
 * alone, which is the same evasion in a different place.
 *
 * When in doubt, leave it out: an unlisted external name still reports as drift, which is a false
 * positive to fix here, not a silent pass.
 */
export const EXTERNAL_IDENTIFIERS: readonly string[] = [
  // Claude Code's own tools and spend cap, cited by B26, B30 and B32 (`maxBudgetUsd`).
  "SendMessage",
  "ListAgents",
  "maxBudgetUsd",
  // Antigravity's own `invoke_subagent` parameters and resume mechanism (B30.5).
  "Workspace",
  "ReusedSubagentId",
];
