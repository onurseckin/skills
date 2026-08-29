import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  type CommandSpec,
} from "../../cli/registry/index.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface CliRegistryTaxonomyCheckOptions {
  readonly registry?: readonly CommandSpec[] | undefined;
}

export function checkCliRegistryTaxonomy(
  options: CliRegistryTaxonomyCheckOptions = {},
): DoctorCheckEngineResult {
  const registry = options.registry ?? COMMAND_REGISTRY;
  const findings: DoctorDiagnosticFinding[] = [];
  const registeredNames = new Set<string>();

  for (const spec of registry) {
    if (spec.aliases.length > 0) {
      findings.push({
        code: "CLI_ALIAS_PROLIFERATION",
        severity: "ERROR",
        engine: "checkCliRegistryTaxonomy",
        message: `Command '${spec.name}' declares non-empty aliases [${spec.aliases.join(", ")}]; zero-alias invariant violated`,
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
