import { existsSync } from "node:fs";
import {
  scanTreeForVendorIdentifiers,
  staleExemptions,
  type VendorIdentifierFinding,
} from "./vendor-identifiers.ts";
import { HOST_DISPATCH_TERMS, VENDOR_NAMES } from "./vendor-names.ts";
import { scanTreeForUnqualifiedDispatch, type UnqualifiedDispatchFinding } from "./vendor-prose.ts";
import { finding, type HealthCheckResult, type HealthFinding } from "./types.ts";

export interface VendorTree {
  readonly label: string;
  readonly root: string;
  readonly exempt?: readonly string[];
  readonly extensions?: readonly string[];
}

export const PRODUCT_GRAMMAR_MODULES: readonly string[] = [
  "src/authority/manifest-parser.ts",
  "src/authority/thread-identifier.ts",
  "src/core/config/host-canon.ts",
  "src/graph/gate-runtime-grammar.ts",
  "src/installer/runtime-freshness.ts",
  "src/platform/index.ts",
  "src/platform/index.ts",
  "src/platform/index.ts",
  "src/platform/index.ts",
  "src/platform/index.ts",
  "src/platform/index.ts",
  "src/platform/index.ts",
  "src/platform/index.ts",
  "src/summary/host-telemetry.ts",
  "src/telemetry/collectors/antigravity.ts",
  "src/telemetry/collectors/claude.ts",
  "src/telemetry/collectors/codex.ts",
  "src/telemetry/collectors/common.ts",
  "src/telemetry/collectors/cursor.ts",
  "src/telemetry/collectors/index.ts",
  "src/telemetry/collectors/openai.ts",
];

function describe(entry: VendorIdentifierFinding): string {
  return entry.position === "path"
    ? `the path segment \`${entry.identifier}\` names \`${entry.vendor}\`; a file called after a product makes that product a first-class concept`
    : `\`${entry.identifier}\` carries the vendor name \`${entry.vendor}\`; the schema names categories, and vendors are values inside them`;
}

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
  readonly label: string;
  readonly root: string;
  readonly exempt?: readonly string[];
  readonly extensions?: readonly string[];
}

function describeDispatch(entry: UnqualifiedDispatchFinding): string {
  return `\`${entry.term}\` is ${entry.host}'s own dispatch call, given here with no word nearby saying so; a coordinator running under a different host would be told to call a tool that does not exist there`;
}

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
