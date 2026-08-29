import type {
  AgentToolsConfig,
  AgentManifestProtocol,
  RoleContractFrontmatter,
} from "../authority/manifest-parser.ts";

export interface AgentIdentity {
  readonly name: string;
  readonly role: string;
  readonly tier: number;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly provider?: readonly string[] | undefined;
  readonly tools?: AgentToolsConfig | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  readonly protocol?: AgentManifestProtocol | undefined;
  readonly milestoneNotifications?: Readonly<Record<string, boolean>> | undefined;
  readonly invariants?: Readonly<Record<string, unknown>> | undefined;
  readonly filePath?: string | undefined;
  readonly rawYaml?: string | undefined;
}

export interface AgentRoleDefinition {
  readonly role: string;
  readonly tier: number;
  readonly domain?: string | undefined;
  readonly may: readonly string[];
  readonly mustNot: readonly string[];
  readonly commands: readonly string[];
  readonly spawns: readonly string[];
  readonly body: string;
  readonly filePath?: string | undefined;
  readonly frontmatter?: RoleContractFrontmatter | undefined;
  readonly raw?: string | undefined;
}

export interface AgentReferenceDoc {
  readonly id: string;
  readonly title: string;
  readonly filePath: string;
  readonly category: string;
  readonly description?: string | undefined;
  readonly sizeBytes: number;
  readonly format: "markdown" | "json";
  readonly content?: string | undefined;
  readonly referencedRoles?: readonly string[] | undefined;
}

export interface AgentTriadBundle {
  readonly role: string;
  readonly tier: number;
  readonly identity: AgentIdentity;
  readonly definition: AgentRoleDefinition;
  readonly references: readonly AgentReferenceDoc[];
  readonly isComplete: boolean;
  readonly validationIssues?: readonly string[] | undefined;
}

export interface TriadValidationResult {
  readonly valid: boolean;
  readonly role: string;
  readonly tier: number;
  readonly hasIdentity: boolean;
  readonly hasDefinition: boolean;
  readonly hasReferences: boolean;
  readonly referenceCount: number;
  readonly identityPath?: string | undefined;
  readonly definitionPath?: string | undefined;
  readonly referencePaths: readonly string[];
  readonly tierConsistent: boolean;
  readonly roleContractRefConsistent: boolean;
  readonly issues: readonly string[];
  readonly warnings: readonly string[];
}

export interface TriadAuditReport {
  readonly timestamp: string;
  readonly skillRoot: string;
  readonly totalRoles: number;
  readonly completeTriads: number;
  readonly incompleteTriads: number;
  readonly healthy: boolean;
  readonly triads: readonly TriadValidationResult[];
  readonly orphanedManifests: readonly string[];
  readonly orphanedContracts: readonly string[];
  readonly unreferencedReferences: readonly string[];
  readonly missingReferences: readonly string[];
  readonly issues: readonly string[];
  readonly summary: string;
}

export interface AgentTriadOptions {
  readonly skillRoot?: string | undefined;
  readonly agentsDir?: string | undefined;
  readonly rolesDir?: string | undefined;
  readonly referencesDir?: string | undefined;
  readonly strict?: boolean | undefined;
  readonly bypassCache?: boolean | undefined;
}
