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
 *
 * `runtime-freshness.ts` hits the identical shape one level removed, same as the installer test
 * files below: `candidateRoots()` reads `clients.claude` and `clients.antigravity` off
 * `clientLinkPaths(home)`'s host-keyed record to build the list of install roots to check for
 * drift. Those are real install-root identities (`.claude/skills/...`, `.gemini/config/skills/...`),
 * not concepts this file coined — it is addressing each host's own install directory, the same
 * distinction `gate-runtime-grammar.ts` and `host-telemetry.ts` already draw. The `InstallRootKind`
 * union and the `kind: "claude"` / `kind: "antigravity"` literals it produces are quoted strings,
 * invisible to this scan; only the bare `.claude` / `.antigravity` property reads are in scope, and
 * those cannot be renamed without breaking the lookup.
 */
const SCRIPT_EXEMPTIONS: readonly string[] = [
  "src/graph/gate-runtime-grammar.ts",
  "src/installer/runtime-freshness.ts",
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
 *
 * The four installer test files below all hit the identical shape one level removed: `client-links.ts`
 * types its link map as `Record<"antigravity" | "claude", string>` (`clientLinkPaths()`), and
 * `installation-status.ts` builds `status.links` off that same union plus production's own
 * `CLIENT_NAMES` ("antigravity" | "chatgpt" | "claude" | "codex"). Those keys are real install-root
 * identities — `.claude/skills/...`, `.gemini/config/skills/...` — not names the tests coined, and
 * reading one back is a plain property access (`clientLinkPaths(home).claude`,
 * `status.links.antigravity`): the key IS the value, exactly the `host-telemetry.ts` shape, so it
 * cannot be renamed without breaking the read. `client-links.test.ts` additionally assigns one such
 * read to a local (`antigravityLink`) inside the test that asserts an earlier-applied plan rolls back
 * when a later plan for a *different* named host fails; the local documents which host's path the
 * assertion is about, the same role `codexHome()` already plays in the exempted probe test above.
 * - unit/cli/install-ops-command.test.ts: reads `links.claude` off the CLI's own status output.
 * - unit/installer/install.test.ts: reads `clientLinkPaths(...).claude` to assert install/rollback.
 * - unit/installer/installation-status.test.ts: reads `status.links.<client>` for every client in
 *   `CLIENT_NAMES`, plus `clientLinkPaths(...).claude` to plant fixtures at the real link path.
 * - unit/installer/client-links.test.ts: reads `clientLinkPaths(...).claude` /`.antigravity` and
 *   `plan.client`/`paths.claude` throughout, since `preflightClientLinks`/`applyClientLinks` are
 *   exercised per host by construction.
 * - unit/installer/runtime-freshness.test.ts: reads `clientLinkPaths(home).claude`/`.antigravity`
 *   to plant fixtures at the real link path, the same property-read shape as the four files above.
 *   It also assigns several of those reads to locals named `claude`/`antigravity`
 *   (`const claude = report.roots.find((entry) => entry.kind === "claude")!`) so an assertion a few
 *   lines later can say which host's root it is checking — the same documenting role
 *   `antigravityLink` and `codexHome()` already play in the exemptions above, not a coined concept.
 */
const TEST_EXEMPTIONS: readonly string[] = [
  "integration/agents-host-telemetry-probe.test.ts",
  "unit/summary/host-telemetry.test.ts",
  "unit/agents/transcript-telemetry.test.ts",
  "integration/agents-transcript-telemetry-cli.test.ts",
  "unit/cli/install-ops-command.test.ts",
  "unit/installer/install.test.ts",
  "unit/installer/installation-status.test.ts",
  "unit/installer/client-links.test.ts",
  "unit/installer/runtime-freshness.test.ts",
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
