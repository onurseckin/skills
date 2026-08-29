import { synthesizeDynamicRole } from "./synthesizer.ts";
import type {
  DynamicRoleCatalogExport,
  DynamicRoleContract,
  DynamicRoleFilter,
  DynamicRoleSpec,
  RoleArchetype,
} from "./types.ts";
export function renderDynamicRolesAsciiTable(
  roles: readonly (DynamicRoleContract | DynamicRoleSpec)[],
): string {
  if (roles.length === 0) {
    return "(no dynamic roles registered)";
  }

  const rows = roles.map((r) => {
    const spec = "spec" in r ? r.spec : r;
    return {
      name: spec.name,
      tier: String(spec.tier),
      archetype: spec.archetype,
      commands: String(spec.grantedCommands.length),
      writePolicy: spec.writeScopePolicy,
      domain: spec.domain ?? "-",
    };
  });

  const colNameW = Math.max(4, ...rows.map((r) => r.name.length), "Role".length);
  const colTierW = Math.max(4, ...rows.map((r) => r.tier.length), "Tier".length);
  const colArchW = Math.max(9, ...rows.map((r) => r.archetype.length), "Archetype".length);
  const colCmdW = Math.max(8, ...rows.map((r) => r.commands.length), "Commands".length);
  const colPolicyW = Math.max(12, ...rows.map((r) => r.writePolicy.length), "Write Policy".length);
  const colDomainW = Math.max(6, ...rows.map((r) => r.domain.length), "Domain".length);

  const topBorder = `┌${"─".repeat(colNameW + 2)}┬${"─".repeat(colTierW + 2)}┬${"─".repeat(colArchW + 2)}┬${"─".repeat(colCmdW + 2)}┬${"─".repeat(colPolicyW + 2)}┬${"─".repeat(colDomainW + 2)}┐`;
  const header = `│ ${"Role".padEnd(colNameW)} │ ${"Tier".padEnd(colTierW)} │ ${"Archetype".padEnd(colArchW)} │ ${"Commands".padEnd(colCmdW)} │ ${"Write Policy".padEnd(colPolicyW)} │ ${"Domain".padEnd(colDomainW)} │`;
  const midBorder = `├${"─".repeat(colNameW + 2)}┼${"─".repeat(colTierW + 2)}┼${"─".repeat(colArchW + 2)}┼${"─".repeat(colCmdW + 2)}┼${"─".repeat(colPolicyW + 2)}┼${"─".repeat(colDomainW + 2)}┤`;
  const botBorder = `└${"─".repeat(colNameW + 2)}┴${"─".repeat(colTierW + 2)}┴${"─".repeat(colArchW + 2)}┴${"─".repeat(colCmdW + 2)}┴${"─".repeat(colPolicyW + 2)}┴${"─".repeat(colDomainW + 2)}┘`;

  const dataLines = rows.map((r) => {
    return `│ ${r.name.padEnd(colNameW)} │ ${r.tier.padEnd(colTierW)} │ ${r.archetype.padEnd(colArchW)} │ ${r.commands.padEnd(colCmdW)} │ ${r.writePolicy.padEnd(colPolicyW)} │ ${r.domain.padEnd(colDomainW)} │`;
  });

  return [topBorder, header, midBorder, ...dataLines, botBorder].join("\n");
}

/**
 * In-memory registry catalog for managing dynamic synthesized roles.
 */
export class DynamicRoleRegistry {
  private readonly roles = new Map<string, DynamicRoleContract>();

  public register(roleOrSpec: DynamicRoleContract | DynamicRoleSpec): DynamicRoleContract {
    const contract: DynamicRoleContract =
      "spec" in roleOrSpec
        ? roleOrSpec
        : synthesizeDynamicRole({
            name: roleOrSpec.name,
            archetype: roleOrSpec.archetype,
            tier: roleOrSpec.tier,
            title: roleOrSpec.title,
            summary: roleOrSpec.summary,
            domain: roleOrSpec.domain,
            grantedCommands: roleOrSpec.grantedCommands,
            permittedActivities: roleOrSpec.permittedActivities,
            prohibitedActions: roleOrSpec.prohibitedActions,
            invariants: roleOrSpec.invariants,
            spawns: roleOrSpec.spawns,
            cognitivePillars: roleOrSpec.cognitivePillars,
            writeScopePolicy: roleOrSpec.writeScopePolicy,
            version: roleOrSpec.version,
            parentRole: roleOrSpec.parentRole,
            metadata: roleOrSpec.metadata,
          });

    this.roles.set(contract.role, contract);
    return contract;
  }

  public get(name: string): DynamicRoleContract | undefined {
    return this.roles.get(name);
  }

  public has(name: string): boolean {
    return this.roles.has(name);
  }

  public revoke(name: string): boolean {
    return this.roles.delete(name);
  }

  public count(): number {
    return this.roles.size;
  }

  public clear(): void {
    this.roles.clear();
  }

  public list(filter?: DynamicRoleFilter): readonly DynamicRoleContract[] {
    let list = Array.from(this.roles.values());

    if (filter?.tier !== undefined) {
      list = list.filter((r) => r.tier === filter.tier);
    }
    if (filter?.domain !== undefined) {
      list = list.filter((r) => r.domain === filter.domain);
    }
    if (filter?.archetype !== undefined) {
      list = list.filter((r) => r.spec.archetype === filter.archetype);
    }
    if (filter?.writeScopePolicy !== undefined) {
      list = list.filter((r) => r.writeScopePolicy === filter.writeScopePolicy);
    }

    return list.sort((a, b) => a.role.localeCompare(b.role));
  }

  public filterByTier(tier: number): readonly DynamicRoleContract[] {
    return this.list({ tier });
  }

  public filterByDomain(domain: string): readonly DynamicRoleContract[] {
    return this.list({ domain });
  }

  public filterByArchetype(archetype: RoleArchetype): readonly DynamicRoleContract[] {
    return this.list({ archetype });
  }

  public exportCatalog(): DynamicRoleCatalogExport {
    const allRoles = this.list().map((r) => r.spec);
    return {
      exportedAt: new Date().toISOString(),
      totalRoles: allRoles.length,
      roles: allRoles,
    };
  }

  public importCatalog(catalog: DynamicRoleCatalogExport): number {
    let imported = 0;
    for (const spec of catalog.roles) {
      this.register(spec);
      imported++;
    }
    return imported;
  }

  public renderAsciiTable(): string {
    return renderDynamicRolesAsciiTable(this.list());
  }
}

/**
 * Global singleton dynamic role registry instance.
 */
let globalRegistryInstance: DynamicRoleRegistry | null = null;

export function getGlobalRoleRegistry(): DynamicRoleRegistry {
  if (!globalRegistryInstance) {
    globalRegistryInstance = new DynamicRoleRegistry();
  }
  return globalRegistryInstance;
}

export function resetGlobalRoleRegistry(): void {
  if (globalRegistryInstance) {
    globalRegistryInstance.clear();
  }
  globalRegistryInstance = null;
}
