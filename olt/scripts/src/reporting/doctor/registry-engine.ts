import { createRequire } from "node:module";
import { COMMAND_DOMAINS, type CommandSpec } from "../../cli/registry/types.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

const req = createRequire(import.meta.url);

let cachedRegistry: readonly CommandSpec[] | undefined;

function getCommandRegistry(): readonly CommandSpec[] {
  if (cachedRegistry) return cachedRegistry;
  const mod = req("../../cli/registry/index.ts") as {
    readonly COMMAND_REGISTRY: readonly CommandSpec[];
  };
  cachedRegistry = mod.COMMAND_REGISTRY;
  return cachedRegistry;
}

const CANONICAL_ALIAS_ALLOWLIST: ReadonlyMap<string, readonly string[]> = new Map([
  ["report:unified", ["report"]],
]);

export interface CliRegistryTaxonomyCheckOptions {
  readonly registry?: readonly CommandSpec[] | undefined;
}

export function checkCliRegistryTaxonomy(
  options: CliRegistryTaxonomyCheckOptions = {},
): DoctorCheckEngineResult {
  const registry = options.registry ?? getCommandRegistry();
  const findings: DoctorDiagnosticFinding[] = [];
  const registeredNames = new Set<string>();

  for (const spec of registry) {
    const allowedAliases = CANONICAL_ALIAS_ALLOWLIST.get(spec.name) ?? [];
    const nonAllowedAliases = spec.aliases.filter((a) => !allowedAliases.includes(a));
    if (nonAllowedAliases.length > 0) {
      findings.push({
        code: "CLI_ALIAS_PROLIFERATION",
        severity: "ERROR",
        engine: "checkCliRegistryTaxonomy",
        message: `Command '${spec.name}' declares non-empty aliases [${nonAllowedAliases.join(", ")}]; zero-alias invariant violated`,
        details: { command: spec.name, aliases: spec.aliases },
      });
    }

    const isTopLevel = /^[a-z]+(-[a-z]+)*$/.test(spec.name);
    const isColonScoped = /^[a-z0-9-]+:[a-z0-9-]+(:[a-z0-9-]+)*$/.test(spec.name);
    if (!isTopLevel && !isColonScoped) {
      findings.push({
        code: "CLI_TAXONOMY_VIOLATION",
        severity: "ERROR",
        engine: "checkCliRegistryTaxonomy",
        message: `Command '${spec.name}' violates canonical colon-namespace taxonomy`,
        details: { command: spec.name, domain: spec.domain },
      });
    }

    if (!COMMAND_DOMAINS.includes(spec.domain)) {
      findings.push({
        code: "CLI_UNKNOWN_DOMAIN",
        severity: "ERROR",
        engine: "checkCliRegistryTaxonomy",
        message: `Command '${spec.name}' references unregistered domain '${spec.domain}'`,
        details: { command: spec.name, domain: spec.domain },
      });
    }

    if (registeredNames.has(spec.name)) {
      findings.push({
        code: "CLI_DUPLICATE_COMMAND",
        severity: "ERROR",
        engine: "checkCliRegistryTaxonomy",
        message: `Duplicate command name '${spec.name}' detected in registry`,
        details: { command: spec.name },
      });
    }
    registeredNames.add(spec.name);

    if (!spec.summary || spec.summary.trim().length === 0) {
      findings.push({
        code: "CLI_MISSING_SUMMARY",
        severity: "ERROR",
        engine: "checkCliRegistryTaxonomy",
        message: `Command '${spec.name}' has empty or missing summary`,
        details: { command: spec.name },
      });
    }

    if (!spec.description || spec.description.trim().length === 0) {
      findings.push({
        code: "CLI_MISSING_DESCRIPTION",
        severity: "ERROR",
        engine: "checkCliRegistryTaxonomy",
        message: `Command '${spec.name}' has empty or missing description`,
        details: { command: spec.name },
      });
    }

    if (typeof spec.handler !== "function") {
      findings.push({
        code: "CLI_INVALID_HANDLER",
        severity: "ERROR",
        engine: "checkCliRegistryTaxonomy",
        message: `Command '${spec.name}' does not declare a callable handler function`,
        details: { command: spec.name },
      });
    }
  }

  return {
    engine: "checkCliRegistryTaxonomy",
    passed: findings.length === 0,
    findings,
  };
}
