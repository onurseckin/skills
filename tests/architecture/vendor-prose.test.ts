import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  scanProseForUnqualifiedDispatch,
  scanTreeForUnqualifiedDispatch,
} from "../../../olt/scripts/src/health/vendor-prose.ts";
import { staleExemptions } from "../../../olt/scripts/src/health/vendor-identifiers.ts";
import {
  HOST_DISPATCH_TERMS,
  HOST_NAME_ALIASES,
} from "../../../olt/scripts/src/health/vendor-names.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const skillRoot = `${repoRoot}olt`;

/**
 * Nothing is exempted today: every `.md`/`.yaml` file under the skill root already qualifies every
 * host-dispatch term it mentions (see `references/host-adapters.md`). If a future file needs one,
 * it goes here with a reason, the same convention `vendor-identifiers.test.ts`'s own lists use.
 */
const PROSE_EXEMPTIONS: readonly string[] = ["agents"];

function describeFindings(findings: ReturnType<typeof scanTreeForUnqualifiedDispatch>): string[] {
  return findings.map((f) => `${f.file}:${f.line} ${f.term} (${f.host})`);
}

describe("a host's dispatch call is never given as the shape of the call, unqualified", () => {
  test("nothing under the skill root names a host-dispatch term without naming the host", () => {
    const findings = scanTreeForUnqualifiedDispatch(skillRoot, { exempt: PROSE_EXEMPTIONS });
    expect(describeFindings(findings)).toEqual([]);
  });

  test("every exemption still covers a path that exists", () => {
    expect(staleExemptions(skillRoot, PROSE_EXEMPTIONS)).toEqual([]);
  });

  test("the tracked terms are non-empty, and no term is claimed by two hosts", () => {
    const hosts = HOST_DISPATCH_TERMS.map((entry) => entry.host);
    expect(new Set(hosts).size).toBe(hosts.length);
    const allTerms = HOST_DISPATCH_TERMS.flatMap((entry) => entry.terms);
    expect(allTerms.length).toBeGreaterThan(0);
    expect(new Set(allTerms).size).toBe(allTerms.length);
    for (const entry of HOST_DISPATCH_TERMS) expect(entry.terms.length).toBeGreaterThan(0);
  });

  test("every tracked host has an alias to be recognised by in prose", () => {
    const aliasHosts = new Set(HOST_NAME_ALIASES.map((entry) => entry.host));
    for (const entry of HOST_DISPATCH_TERMS) expect(aliasHosts.has(entry.host)).toBe(true);
  });
});

/**
 * The exact two regressions the item names, reproduced verbatim (not paraphrased) from `git log -p`
 * on `agents/coordinator.yaml` (fixed in commit 0fa50f9) and the working-tree diff that fixed
 * `references/run-playbook.md`'s identical shape. Reinjecting each here and asserting the check
 * fails is the "reinject, confirm it fails, restore" the item asks for — done against a throwaway
 * string rather than the live files, since another wave is mid-edit on both today; scanning the
 * real files (below) stands in for "restore", proving the guard is silent once the fix is in place.
 */
describe("the exact two regressions this check exists to catch", () => {
  test("coordinator.yaml's regression: invoke_subagent given as the batch-dispatch shape, no host named", () => {
    const source = [
      "interface:",
      "  phases:",
      "      - Dispatch every task the snapshot shows as claimable, one implementer and one validator per",
      "        task, launched together so the pair is registered atomically. A single subagent call may",
      "        launch several pairs at once when the host allows it — that is a batching convenience, not a",
      "        synchronisation requirement:",
      "        ```typescript",
      "        invoke_subagent({",
      "          Subagents: [",
      '            { Role: "Implementer 1 (Task T-01)", TypeName: "self", Prompt: "Claim and implement task T-01 in run $RUN..." },',
      "          ]",
      "        });",
      "        ```",
    ].join("\n");
    const findings = scanProseForUnqualifiedDispatch(source, "coordinator.yaml", false);
    expect(findings).toEqual([
      { file: "coordinator.yaml", line: 8, term: "invoke_subagent", host: "antigravity" },
    ]);
  });

  test("run-playbook.md's regression: the identical bare call under a host-agnostic phase heading", () => {
    const source = [
      "## Phase 2 — Continuous dispatch",
      "",
      "Dispatch each claimable task as a pair — one implementer and its own independent validator, never an",
      "implementer alone. The Triad Floor and the Pairing Invariant are stated in",
      "[`protocol.md`](protocol.md); this is the shape of the call:",
      "",
      "```typescript",
      "invoke_subagent({",
      "  Subagents: [",
      '    { Role: "Implementer 1 (Task T-01)", TypeName: "self", Prompt: "Claim and implement T-01 in $RUN..." },',
      "  ],",
      "});",
      "```",
    ].join("\n");
    const findings = scanProseForUnqualifiedDispatch(source, "run-playbook.md", true);
    expect(findings).toEqual([
      { file: "run-playbook.md", line: 8, term: "invoke_subagent", host: "antigravity" },
    ]);
  });

  test("restored: references/host-adapters.md, read directly off disk, names every host it uses", () => {
    const findings = scanTreeForUnqualifiedDispatch(`${skillRoot}/references`, {
      extensions: [".md"],
    });
    expect(describeFindings(findings)).toEqual([]);
  });
});
