export type RoleTier = 0 | 1 | 2 | 3;

export interface RoleContractFrontmatter {
  readonly role?: string | undefined;
  readonly tier?: number | undefined;
  readonly domain?: string | undefined;
  readonly permissions?:
    | {
        readonly may?: readonly string[] | undefined;
        readonly must_not?: readonly string[] | undefined;
        readonly commands?: readonly string[] | undefined;
        readonly spawns?: readonly string[] | undefined;
      }
    | undefined;
  readonly may?: readonly string[] | undefined;
  readonly must_not?: readonly string[] | undefined;
  readonly commands?: readonly string[] | undefined;
  readonly spawns?: readonly string[] | undefined;
  readonly [key: string]: unknown;
}

export interface RoleContract {
  readonly role: string;
  readonly tier: number;
  readonly domain?: string | undefined;
  readonly may: readonly string[];
  readonly mustNot: readonly string[];
  readonly commands: readonly string[];
  readonly spawns: readonly string[];
  readonly frontmatter: RoleContractFrontmatter;
  readonly body: string;
  readonly filePath?: string | undefined;
  readonly raw: string;
}

export interface AgentToolsConfig {
  readonly enable_subagent_tools?: boolean | undefined;
  readonly enable_write_tools?: boolean | undefined;
  readonly [key: string]: unknown;
}

export interface AgentManifestInterface {
  readonly display_name?: string | undefined;
  readonly short_description?: string | undefined;
  readonly role?: string | undefined;
  readonly tier?: number | undefined;
  readonly tools?: AgentToolsConfig | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  readonly milestone_notifications?: Readonly<Record<string, boolean>> | undefined;
  readonly mind_invariants?: Readonly<Record<string, boolean>> | undefined;
  readonly coordinator_invariants?: Readonly<Record<string, boolean>> | undefined;
  readonly [key: string]: unknown;
}

export interface AgentManifestProtocol {
  readonly cli?: string | undefined;
  readonly zero_json?: boolean | undefined;
  readonly role_contract?: string | undefined;
  readonly instructions?: string | undefined;
  readonly [key: string]: unknown;
}

export interface AgentManifestCommunicationContract {
  readonly protocol: string;
  readonly mailbox_path: string;
  readonly lock_path: string;
  readonly allowed_channels: readonly string[];
  readonly ban_raw_jsonl_reading: boolean;
  readonly forbid_native_messaging?: boolean | undefined;
}

export interface AgentManifestPermissions {
  readonly may?: readonly string[] | undefined;
  readonly must_not?: readonly string[] | undefined;
  readonly commands?: readonly string[] | undefined;
  readonly spawns?: readonly string[] | undefined;
}

export interface AgentManifest {
  readonly name: string;
  readonly role: string;
  readonly tier: number;
  readonly domain?: string | undefined;
  readonly provider?: readonly string[] | undefined;
  readonly tools?: AgentToolsConfig | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  readonly interface?: AgentManifestInterface | undefined;
  readonly permissions?: AgentManifestPermissions | undefined;
  readonly invariants?: readonly string[] | undefined;
  readonly instructions?: string | undefined;
  readonly protocol?: AgentManifestProtocol | undefined;
  readonly communication_contract?: AgentManifestCommunicationContract | undefined;
  readonly mandatory_turn1_actions?: readonly string[] | undefined;
  readonly dispatch_contract?: string | undefined;
  readonly filePath?: string | undefined;
  readonly raw?: string | undefined;
  readonly [key: string]: unknown;
}

export interface UnifiedAgentModel {
  readonly role: string;
  readonly name: string;
  readonly tier: number;
  readonly domain?: string | undefined;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly archetype: string;
  readonly coreMandate: string;
  readonly may: readonly string[];
  readonly mustNot: readonly string[];
  readonly commands: readonly string[];
  readonly spawns: readonly string[];
  readonly instructions: string;
  readonly roleContractBody: string;
  readonly tools: {
    readonly enable_subagent_tools: boolean;
    readonly enable_write_tools: boolean;
  };
  readonly manifest: AgentManifest;
  readonly contract: RoleContract;
  readonly mandatory_turn1_actions?: readonly string[] | undefined;
  readonly dispatch_contract?: string | undefined;
  readonly forbidNativeMessaging?: boolean | undefined;
}

export interface ManifestLoaderOptions {
  readonly skillRoot?: string | undefined;
  readonly agentsDir?: string | undefined;
  readonly rolesDir?: string | undefined;
  readonly bypassCache?: boolean | undefined;
}

export interface ParsedLine {
  readonly originalLine: string;
  readonly indent: number;
  readonly text: string;
  readonly lineNum: number;
}
