import { createRequire } from "node:module";
import {
  computeDoctorEnginePassed,
  type DoctorCheckEngineResult,
  type DoctorDiagnosticFinding,
} from "./types.ts";

export interface CommandSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly domain: string;
  readonly summary?: string;
  readonly description?: string;
  readonly handler?: unknown;
}

const req = createRequire(import.meta.url);

let cachedRegistry: readonly CommandSpec[] | undefined;
let cachedDomains: readonly string[] | undefined;

function getRegistryModule(): {
  readonly COMMAND_REGISTRY: readonly CommandSpec[];
  readonly COMMAND_DOMAINS: readonly string[];
} {
  return req("../../cli/registry/index.ts") as {
    readonly COMMAND_REGISTRY: readonly CommandSpec[];
    readonly COMMAND_DOMAINS: readonly string[];
  };
}

function getCommandRegistry(): readonly CommandSpec[] {
  if (!cachedRegistry) {
    cachedRegistry = getRegistryModule().COMMAND_REGISTRY;
  }
  return cachedRegistry;
}

function getCommandDomains(): readonly string[] {
  if (!cachedDomains) {
    cachedDomains = getRegistryModule().COMMAND_DOMAINS;
  }
  return cachedDomains;
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

    if (!getCommandDomains().includes(spec.domain)) {
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
    passed: computeDoctorEnginePassed(findings),
    findings,
  };
}
