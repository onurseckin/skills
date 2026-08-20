import { existsSync } from "node:fs";
import {
  scanTreeForVendorIdentifiers,
  staleExemptions,
  type VendorIdentifierFinding,
} from "./vendor-identifiers.ts";
import { HOST_DISPATCH_TERMS, VENDOR_NAMES } from "./vendor-names.ts";
import {
  scanTreeForUnqualifiedDispatch,
  type UnqualifiedDispatchFinding,
} from "./vendor-prose.ts";
import { finding, type HealthCheckResult, type HealthFinding } from "./types.ts";

export interface VendorTree {
  /** How the tree is named in the report. */
  readonly label: string;
  readonly root: string;
  /** Root-relative paths whose whole job is to speak one product's protocol. */
  readonly exempt?: readonly string[];
  readonly extensions?: readonly string[];
}

/**
 * The only place in the producer tree a product name may appear as an identifier: a module that
 * exists to speak several products' own command grammars, where a generic name would be a lie
 * about what the rule encodes (`gate-runtime-grammar.ts`'s `denoCommand`/`pythonCommand`, one
 * function per grammar it parses). `tests/unit/architecture/vendor-identifiers.test.ts` carries
 * its own `SCRIPT_EXEMPTIONS` under the same reasoning; keep both lists in agreement by hand until
 * they are unified, because a health check that flags what the test suite already excused for a
 * documented reason is the check crying wolf, not a real finding.
 */
export const PRODUCT_GRAMMAR_MODULES: readonly string[] = ["src/graph/gate-runtime-grammar.ts"];

function describe(entry: VendorIdentifierFinding): string {
  return entry.position === "path"
    ? `the path segment \`${entry.identifier}\` names \`${entry.vendor}\`; a file called after a product makes that product a first-class concept`
    : `\`${entry.identifier}\` carries the vendor name \`${entry.vendor}\`; the schema names categories, and vendors are values inside them`;
}

/**
 * B19.4, over both repositories. The scan itself lives in `vendor-identifiers.ts`; this wraps it as
 * a health check rather than repeating it, because a second implementation of the same rule is how
 * the two copies start disagreeing.
 */
export function checkVendorIdentifiers(trees: readonly VendorTree[]): HealthCheckResult {
  const findings: HealthFinding[] = [];
  const seen = new Set<string>();
  const scannedTrees: string[] = [];
  for (const tree of trees) {
    if (!existsSync(tree.root)) {
      findings.push(
        finding(
          "vendor-identifiers",
          `vendor-root-missing:${tree.label}`,
          tree.root,
          `the ${tree.label} tree does not exist at this path, so it was not swept`,
        ),
      );
      continue;
    }
    scannedTrees.push(`${tree.label} (${tree.root})`);
    const options = {
      ...(tree.exempt === undefined ? {} : { exempt: tree.exempt }),
      ...(tree.extensions === undefined ? {} : { extensions: tree.extensions }),
    };
    for (const entry of scanTreeForVendorIdentifiers(tree.root, options)) {
      const key = `vendor-identifier:${tree.label}:${entry.file}:${entry.identifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A path finding is about the file's name, not a line inside it; rendering it as `:0` would
      // point the reader at a location that does not exist.
      findings.push(
        finding(
          "vendor-identifiers",
          key,
          `${tree.label}/${entry.file}`,
          describe(entry),
          entry.position === "path" ? undefined : entry.line,
        ),
      );
    }
    for (const path of staleExemptions(tree.root, tree.exempt ?? [])) {
      findings.push(
        finding(
          "vendor-identifiers",
          `vendor-exemption-stale:${tree.label}:${path}`,
          `${tree.label}/${path}`,
          "the exemption covers a path that no longer exists; a permission must not outlive the thing it covered",
        ),
      );
    }
  }
  return {
    check: "vendor-identifiers",
    title: "Vendor names in identifier positions",
    findings,
    scanned: trees.length,
    limitations: [
      `Only the ${VENDOR_NAMES.length} names on the checked-in list are searched; a vendor nobody listed passes.`,
      "Names the list deliberately omits - the runtime the harness is written in, the tool it executes, and words that are ordinary vocabulary in this domain - cannot be detected here at all.",
      "A vendor name recorded as a value or written in prose is excluded by design; only what NAMES something is in scope.",
      `Trees swept: ${scannedTrees.length === 0 ? "none" : scannedTrees.join(", ")}.`,
    ],
  };
}

export interface ProseTree {
  /** How the tree is named in the report. */
  readonly label: string;
  readonly root: string;
  /** Root-relative paths a reason excuses from the sweep. */
  readonly exempt?: readonly string[];
  readonly extensions?: readonly string[];
}

function describeDispatch(entry: UnqualifiedDispatchFinding): string {
  return `\`${entry.term}\` is ${entry.host}'s own dispatch call, given here with no word nearby saying so; a coordinator running under a different host would be told to call a tool that does not exist there`;
}

/**
 * The prose half of "a vendor name is a value, never a concept": `vendor-identifiers.ts` catches
 * the defect in `.ts` source, this catches it in the documents a coordinator actually reads -
 * `agents/coordinator.yaml` and `references/run-playbook.md` both regressed to a bare
 * `invoke_subagent({...})` presented as universal, and neither is `.ts`.
 */
export function checkUnqualifiedDispatch(trees: readonly ProseTree[]): HealthCheckResult {
  const findings: HealthFinding[] = [];
  const scannedTrees: string[] = [];
  for (const tree of trees) {
    if (!existsSync(tree.root)) {
      findings.push(
        finding(
          "vendor-prose",
          `dispatch-root-missing:${tree.label}`,
          tree.root,
          `the ${tree.label} tree does not exist at this path, so it was not swept`,
        ),
      );
      continue;
    }
    scannedTrees.push(`${tree.label} (${tree.root})`);
    const options = {
      ...(tree.exempt === undefined ? {} : { exempt: tree.exempt }),
      ...(tree.extensions === undefined ? {} : { extensions: tree.extensions }),
    };
    for (const entry of scanTreeForUnqualifiedDispatch(tree.root, options)) {
      findings.push(
        finding(
          "vendor-prose",
          `unqualified-dispatch:${tree.label}:${entry.file}:${entry.line}:${entry.term}`,
          `${tree.label}/${entry.file}`,
          describeDispatch(entry),
          entry.line,
        ),
      );
    }
    for (const path of staleExemptions(tree.root, tree.exempt ?? [])) {
      findings.push(
        finding(
          "vendor-prose",
          `dispatch-exemption-stale:${tree.label}:${path}`,
          `${tree.label}/${path}`,
          "the exemption covers a path that no longer exists; a permission must not outlive the thing it covered",
        ),
      );
    }
  }
  const hosts = HOST_DISPATCH_TERMS.map((entry) => entry.host).join(", ");
  return {
    check: "vendor-prose",
    title: "Unqualified host-dispatch calls in docs and role contracts",
    findings,
    scanned: trees.length,
    limitations: [
      `Only the dispatch identifiers tracked for ${hosts} are searched; an unlisted host or term passes silently.`,
      "Qualification is judged by paragraph and, in Markdown, the nearest heading above it; a host named further up the same document is not credited.",
      "A markdown table row is judged over the whole contiguous table, not the single row, so an adapter table naming several hosts qualifies every row in it.",
      `Trees swept: ${scannedTrees.length === 0 ? "none" : scannedTrees.join(", ")}.`,
    ],
  };
}
