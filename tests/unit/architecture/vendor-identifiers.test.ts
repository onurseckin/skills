import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanTreeForVendorIdentifiers,
  staleExemptions,
  type VendorIdentifierFinding,
} from "../../../orchestrating-long-tasks/scripts/src/health/vendor-identifiers.ts";
import { VENDOR_NAMES } from "../../../orchestrating-long-tasks/scripts/src/health/vendor-names.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scriptsRoot = join(repoRoot, "orchestrating-long-tasks/scripts");
const testsRoot = join(repoRoot, "tests");

/**
 * The only places a product may name a symbol: modules that exist to speak several products' own
 * grammars and identities, where a generic name would be a lie about what the rule encodes.
 * `host-telemetry.ts` keys TELEMETRY_PROBES by each host's own tool name and looks it up as
 * `TELEMETRY_PROBES[identity.hostTool]`, so the key IS the value; renaming it breaks the lookup. Every entry is
 * a deliberate decision, and an entry pointing at a file that no longer exists fails the suite.
 */
const SCRIPT_EXEMPTIONS: readonly string[] = [
  "src/graph/gate-runtime-grammar.ts",
  "src/summary/host-telemetry.ts",
];

/**
 * A test that probes one host's configuration has to name that host: the whole point of
 * `host-telemetry-probe.test.ts` is that Codex's settings live somewhere Claude Code's do not, and a
 * generically-named local would obscure which host the case covers. The env-var constants are the
 * hosts' OWN names — values we read, not concepts we coined — and renaming them would break the read.
 *
 * `transcript-telemetry.test.ts` and `transcript-telemetry-cli.test.ts` set and read
 * `CLAUDE_CODE_SESSION_ID` as a literal env-var / object key, the same "host's own name" shape as
 * the two exemptions above — the production reader keys off that exact string, so the tests must too.
 */
const TEST_EXEMPTIONS: readonly string[] = [
  "integration/agents-host-telemetry-probe.test.ts",
  "unit/summary/host-telemetry.test.ts",
  "unit/agents/transcript-telemetry.test.ts",
  "integration/agents-transcript-telemetry-cli.test.ts",
];

function describeFindings(findings: readonly VendorIdentifierFinding[]): string[] {
  return findings.map(
    (finding) =>
      `${finding.file}:${finding.line} ${finding.identifier} names "${finding.vendor}" (${finding.position})`,
  );
}

/**
 * `PlaywrightMetadata` was the shape of the mistake: a type named after one runner, holding fields
 * true of every runner in its category. This is the check that keeps it from coming back — under
 * any product's name, in either repository, in a type, a field, a constant or a module name.
 */
describe("vendor names never name a concept", () => {
  test("the production tree names nothing after a product", () => {
    const findings = scanTreeForVendorIdentifiers(scriptsRoot, { exempt: SCRIPT_EXEMPTIONS });
    expect(describeFindings(findings)).toEqual([]);
  });

  test("the test tree names nothing after a product", () => {
    const findings = scanTreeForVendorIdentifiers(testsRoot, { exempt: TEST_EXEMPTIONS });
    expect(describeFindings(findings)).toEqual([]);
  });

  test("every exemption still covers a file that exists", () => {
    expect(staleExemptions(scriptsRoot, SCRIPT_EXEMPTIONS)).toEqual([]);
    expect(staleExemptions(testsRoot, TEST_EXEMPTIONS)).toEqual([]);
  });

  test("the exempt module is exempt because it really does carry product names", () => {
    const findings = scanTreeForVendorIdentifiers(scriptsRoot, { exempt: [] });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(SCRIPT_EXEMPTIONS).toContain(finding.file);
    }
  });

  test("the vendor list is lowercase, unique and sorted so a name cannot hide in it twice", () => {
    expect(VENDOR_NAMES.map((name) => name.toLowerCase())).toEqual([...VENDOR_NAMES]);
    expect(new Set(VENDOR_NAMES).size).toBe(VENDOR_NAMES.length);
    expect([...VENDOR_NAMES].sort()).toEqual([...VENDOR_NAMES]);
  });

  test("names excluded on purpose stay excluded, so the check reports no noise", () => {
    // Each of these is an ordinary word of this domain first; matching them would bury the real
    // findings under identifiers nobody would ever call a vendor concept.
    for (const excluded of ["bun", "git", "node", "edge", "chrome", "cursor", "webkit", "rollup"]) {
      expect(VENDOR_NAMES).not.toContain(excluded);
    }
  });
});
