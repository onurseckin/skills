import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanTreeForVendorIdentifiers,
  staleExemptions,
  type VendorIdentifierFinding,
} from "../../../olt/scripts/src/health/vendor-identifiers.ts";
import { VENDOR_NAMES } from "../../../olt/scripts/src/health/vendor-names.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scriptsRoot = join(repoRoot, "olt/scripts");
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
  "src/authority/manifest/constants.ts",
  "src/capture/docker-health.ts",
  "src/capture/persona-registry.ts",
  "src/core/config/host-canon.ts",
  "src/engine/scheduler/host-cadence.ts",
  "src/graph/gate-runtime-grammar.ts",
  "src/installer/runtime-freshness.ts",
  "src/orchestrator/host-schedulers.ts",
  "src/platform/host/antigravity.ts",
  "src/platform/host/chatgpt.ts",
  "src/platform/host/claude-code.ts",
  "src/platform/host/code-edit-tools.ts",
  "src/platform/host/codex.ts",
  "src/platform/host/host-adapter-registry.ts",
  "src/platform/index.ts",
  "src/policy/generator/command-builder.ts",
  "src/policy/generator/default-agents.ts",
  "src/policy/generator/default-docker.ts",
  "src/policy/generator/ecosystem-detect.ts",
  "src/policy/generator/index.ts",
  "src/policy/generator/manifest-readers.ts",
  "src/policy/generator/toolchain-discovery.ts",
  "src/policy/generator/toolchain-presets.ts",
  "src/policy/generator/toolchain-scanner.ts",
  "src/policy/index.ts",
  "src/policy/schema/agent-schema.ts",
  "src/policy/schema/docker-schema.ts",
  "src/policy/schema/index.ts",
  "src/policy/types/index.ts",
  "src/summary/metrics/host-telemetry.ts",
  "src/telemetry/collectors/antigravity.ts",
  "src/telemetry/collectors/claude/claude-collector.ts",
  "src/telemetry/collectors/claude/index.ts",
  "src/telemetry/collectors/claude/stream-parser.ts",
  "src/telemetry/collectors/claude.ts",
  "src/telemetry/collectors/codex.ts",
  "src/telemetry/collectors/common.ts",
  "src/telemetry/collectors/cursor.ts",
  "src/telemetry/collectors/index.ts",
  "src/telemetry/collectors/openai/fallback-parser.ts",
  "src/telemetry/collectors/openai/index.ts",
  "src/telemetry/collectors/openai/openai-collector.ts",
  "src/telemetry/collectors/openai/rollout-parser.ts",
  "src/telemetry/collectors/openai.ts",
  "src/telemetry/index.ts",
];

/**
 * A test that probes one host's configuration has to name that host: the whole point of
 * `host-telemetry.test.ts` is that Codex's settings live somewhere Claude Code's do not, and a
 * generically-named local would obscure which host the case covers. The env-var constants are the
 * hosts' OWN names — values we read, not concepts we coined — and renaming them would break the read.
 *
 * `transcript-telemetry.test.ts` sets and reads `CLAUDE_CODE_SESSION_ID` as a literal env-var /
 * object key, the same "host's own name" shape as the exemption above — the production reader keys
 * off that exact string, so the test must too.
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
 * assertion is about.
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
 *   `antigravityLink` already plays in the exemption above, not a coined concept.
 * - unit/platform/adapters.test.ts and unit/platform/host-adapters.test.ts: test platform adapters
 *   for named hosts.
 */
const TEST_EXEMPTIONS: readonly string[] = [
  "unit/agents/transcript-telemetry.test.ts",
  "unit/agents/whoami-profiling.test.ts",
  "unit/authority/host-bindings.test.ts",
  "unit/authority/thread-identifier.test.ts",
  "unit/capture/docker-health.test.ts",
  "unit/capture/persona-registry.test.ts",
  "unit/cli/install-ops-command.test.ts",
  "unit/cli/quota-ops.test.ts",
  "unit/config/harness-config.test.ts",
  "unit/config/host-canon.test.ts",
  "unit/contracts/core-runtime.test.ts",
  "unit/engine/scheduler/scheduler-all-extended.test.ts",
  "unit/installer/install.test.ts",
  "unit/installer/installation-status.test.ts",
  "unit/installer/client-links.test.ts",
  "unit/installer/runtime-freshness.test.ts",
  "unit/mind/mind-init-scaffolding.test.ts",
  "unit/mind/toolchain-discovery.test.ts",
  "unit/orchestrator/host-schedulers.test.ts",
  "unit/packets/command-authority-host-remediation.test.ts",
  "unit/platform/adapters.test.ts",
  "unit/platform/host-adapters.test.ts",
  "unit/platform/host-autodetect.test.ts",
  "unit/policy/manifest-readers.test.ts",
  "unit/policy/policy-presets-and-audit.test.ts",
  "unit/policy/policy-schema-advanced.test.ts",
  "unit/policy/policy-schema-core.test.ts",
  "unit/policy/repo-policy-detect.test.ts",
  "unit/policy/repo-policy-io.test.ts",
  "unit/policy/toolchain-auto-discovery.test.ts",
  "unit/roles/plan-91-roles.test.ts",
  "unit/scheduler/host-cadence.test.ts",
  "unit/summary/host-telemetry.test.ts",
  "unit/telemetry/claude-collector.test.ts",
  "unit/telemetry/collector-concurrency.test.ts",
  "unit/telemetry/collectors.test.ts",
  "unit/telemetry/engine.test.ts",
  "unit/telemetry/openai-collector.test.ts",
  "unit/telemetry/quota-unknown-safety.test.ts",
  "unit/telemetry/secret-redaction.test.ts",
  "unit/telemetry/trace-context-and-exports.test.ts",
  "unit/telemetry/usage-report.test.ts",
  "unit/tooling/sandbox.test.ts",
  "unit/validation/defect-prose-assertion-audit.test.ts",
  "unit/workflow/agents/transcript-telemetry.test.ts",
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
