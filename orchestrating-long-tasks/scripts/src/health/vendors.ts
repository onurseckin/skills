import { existsSync } from "node:fs";
import {
  scanTreeForVendorIdentifiers,
  staleExemptions,
  type VendorIdentifierFinding,
} from "./vendor-identifiers.ts";
import { VENDOR_NAMES } from "./vendor-names.ts";
import { finding, type HealthCheckResult, type HealthFinding } from "./types.ts";

export interface VendorTree {
  /** How the tree is named in the report. */
  readonly label: string;
  readonly root: string;
  /** Root-relative paths whose whole job is to speak one product's protocol. */
  readonly exempt?: readonly string[];
  readonly extensions?: readonly string[];
}

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
