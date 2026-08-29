import * as yaml from "js-yaml";

export interface AgentManifestCommunicationContract {
  readonly protocol: string;
  readonly mailbox_path: string;
  readonly lock_path: string;
  readonly allowed_channels: readonly string[];
  readonly ban_raw_jsonl_reading: boolean;
  readonly forbid_native_messaging?: boolean | undefined;
}

export interface UnifiedAgentManifest {
  readonly name: string;
  readonly role: string;
  readonly tier: number | "independent";
  readonly provider: readonly string[];
  readonly tools: {
    readonly enable_subagent_tools: boolean;
    readonly enable_write_tools: boolean;
  };
  readonly interface: {
    readonly display_name: string;
    readonly short_description: string;
  };
  readonly permissions: {
    readonly may: readonly string[];
    readonly must_not: readonly string[];
    readonly commands?: readonly string[] | undefined;
    readonly spawns: readonly string[];
  };
  readonly invariants: readonly string[];
  readonly domain?: string | undefined;
  readonly protocol: {
    readonly cli: string;
    readonly zero_json: boolean;
  };
  readonly instructions: string;
  readonly communication_contract?: AgentManifestCommunicationContract | undefined;
  readonly mandatory_turn1_actions?: readonly string[] | undefined;
  readonly dispatch_contract?: string | undefined;
}

function isObjectRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && val !== undefined && typeof val === "object" && !Array.isArray(val);
}

export function parseUnifiedAgentManifest(
  rawYaml: string,
  filePath?: string,
): UnifiedAgentManifest {
  try {
    const doc = yaml.load(rawYaml) as Record<string, unknown>;
    if (!doc || typeof doc !== "object" || Array.isArray(doc))
      throw new Error("YAML document must be an object");

    const rawPerms = isObjectRecord(doc.permissions) ? doc.permissions : {};
    const rawTools = isObjectRecord(doc.tools) ? doc.tools : {};
    const rawInterface = isObjectRecord(doc.interface) ? doc.interface : {};
    const rawProtocol = isObjectRecord(doc.protocol) ? doc.protocol : {};
    const rawComm = isObjectRecord(doc.communication_contract)
      ? doc.communication_contract
      : undefined;

    const commProtocol =
      rawComm && typeof rawComm.protocol === "string" && rawComm.protocol.length > 0
        ? rawComm.protocol
        : "mailbox_ipc";
    const commMailbox =
      rawComm && typeof rawComm.mailbox_path === "string" && rawComm.mailbox_path.length > 0
        ? rawComm.mailbox_path
        : ".olt/mailboxes/{agent_id}/";
    const commLock =
      rawComm && typeof rawComm.lock_path === "string" && rawComm.lock_path.length > 0
        ? rawComm.lock_path
        : ".olt/locks/mailboxes/{agent_id}.lock";
    const commChannels =
      rawComm && Array.isArray(rawComm.allowed_channels)
        ? (rawComm.allowed_channels as readonly string[])
        : ["msg:send", "msg:recv", "msg:poll"];
    const commBan = rawComm ? rawComm.ban_raw_jsonl_reading !== false : true;
    const commForbidNative =
      rawComm && rawComm.forbid_native_messaging !== undefined
        ? Boolean(rawComm.forbid_native_messaging)
        : undefined;

    const communication_contract: AgentManifestCommunicationContract | undefined = rawComm
      ? {
          protocol: commProtocol,
          mailbox_path: commMailbox,
          lock_path: commLock,
          allowed_channels: commChannels,
          ban_raw_jsonl_reading: commBan,
          forbid_native_messaging: commForbidNative,
        }
      : undefined;

    const manifestName = typeof doc.name === "string" ? doc.name : "";
    const manifestRole =
      typeof doc.role === "string" ? doc.role : typeof doc.name === "string" ? doc.name : "";
    let manifestTier: number | "independent" = 3;
    if (doc.tier === "independent") manifestTier = "independent";
    else if (typeof doc.tier === "number") manifestTier = doc.tier;
    const manifestProvider = Array.isArray(doc.provider)
      ? doc.provider
      : ["antigravity", "agy", "claude", "codex", "cursor", "generic"];

    const ifaceDisplayName =
      typeof rawInterface.display_name === "string" && rawInterface.display_name.length > 0
        ? rawInterface.display_name
        : manifestName;
    const ifaceShortDesc =
      typeof rawInterface.short_description === "string" &&
      rawInterface.short_description.length > 0
        ? rawInterface.short_description
        : manifestRole;
    const protoCli =
      typeof rawProtocol.cli === "string" && rawProtocol.cli.length > 0
        ? rawProtocol.cli
        : "bun ~/.agents/skills/olt/scripts/harness.ts";
    const mandatoryTurn1 = Array.isArray(doc.mandatory_turn1_actions)
      ? (doc.mandatory_turn1_actions as readonly string[])
      : undefined;
    const dispatchContract =
      typeof doc.dispatch_contract === "string" && doc.dispatch_contract.length > 0
        ? doc.dispatch_contract
        : undefined;

    return {
      name: manifestName,
      role: manifestRole,
      tier: manifestTier,
      provider: manifestProvider,
      tools: {
        enable_subagent_tools: Boolean(rawTools.enable_subagent_tools),
        enable_write_tools: Boolean(rawTools.enable_write_tools),
      },
      interface: { display_name: ifaceDisplayName, short_description: ifaceShortDesc },
      permissions: {
        may: Array.isArray(rawPerms.may) ? rawPerms.may : [],
        must_not: Array.isArray(rawPerms.must_not) ? rawPerms.must_not : [],
        commands: Array.isArray(rawPerms.commands)
          ? rawPerms.commands
          : Array.isArray(doc.commands)
            ? (doc.commands as readonly string[])
            : undefined,
        spawns: Array.isArray(rawPerms.spawns) ? rawPerms.spawns : [],
      },
      invariants: Array.isArray(doc.invariants) ? doc.invariants : [],
      domain: typeof doc.domain === "string" ? doc.domain : undefined,
      protocol: { cli: protoCli, zero_json: rawProtocol.zero_json !== false },
      instructions: typeof doc.instructions === "string" ? doc.instructions : "",
      communication_contract,
      mandatory_turn1_actions: mandatoryTurn1,
      dispatch_contract: dispatchContract,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse manifest${filePath ? ` at ${filePath}` : ""}: ${msg}`);
  }
}

export function validateUnifiedAgentManifest(manifest: UnifiedAgentManifest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (typeof manifest.name !== "string") errors.push("Field 'name' must be a string");
  if (typeof manifest.role !== "string") errors.push("Field 'role' must be a string");
  if (typeof manifest.tier !== "number" && manifest.tier !== "independent")
    errors.push("Field 'tier' must be a number or 'independent'");

  if (!Array.isArray(manifest.provider))
    errors.push("Field 'provider' must be an array of strings");
  else if (!manifest.provider.every((p: unknown) => typeof p === "string"))
    errors.push("Field 'provider' array must only contain strings");

  if (!isObjectRecord(manifest.tools)) errors.push("Field 'tools' must be an object");
  else {
    if (typeof manifest.tools.enable_subagent_tools !== "boolean")
      errors.push("Field 'tools.enable_subagent_tools' must be a boolean");
    if (typeof manifest.tools.enable_write_tools !== "boolean")
      errors.push("Field 'tools.enable_write_tools' must be a boolean");
  }

  if (!isObjectRecord(manifest.interface)) errors.push("Field 'interface' must be an object");
  else {
    if (typeof manifest.interface.display_name !== "string")
      errors.push("Field 'interface.display_name' must be a string");
    if (typeof manifest.interface.short_description !== "string")
      errors.push("Field 'interface.short_description' must be a string");
  }

  if (!isObjectRecord(manifest.permissions)) errors.push("Field 'permissions' must be an object");
  else {
    const checkStringArray = (val: unknown, path: string) => {
      if (!Array.isArray(val)) errors.push(`Field '${path}' must be an array of strings`);
      else if (!val.every((p: unknown) => typeof p === "string"))
        errors.push(`Field '${path}' array must only contain strings`);
    };
    checkStringArray(manifest.permissions.may, "permissions.may");
    checkStringArray(manifest.permissions.must_not, "permissions.must_not");
    if (manifest.permissions.commands !== undefined)
      checkStringArray(manifest.permissions.commands, "permissions.commands");
    checkStringArray(manifest.permissions.spawns, "permissions.spawns");
  }

  if (!Array.isArray(manifest.invariants))
    errors.push("Field 'invariants' must be an array of strings");
  else {
    for (const inv of manifest.invariants as unknown[]) {
      if (typeof inv !== "string")
        errors.push(`Field 'invariants' array must only contain strings, found ${typeof inv}`);
    }
  }

  if (!isObjectRecord(manifest.protocol)) errors.push("Field 'protocol' must be an object");
  else {
    if (typeof manifest.protocol.cli !== "string")
      errors.push("Field 'protocol.cli' must be a string");
    if (typeof manifest.protocol.zero_json !== "boolean")
      errors.push("Field 'protocol.zero_json' must be a boolean");
  }

  if (typeof manifest.instructions !== "string")
    errors.push("Field 'instructions' must be a string");

  if (manifest.communication_contract !== undefined) {
    if (!isObjectRecord(manifest.communication_contract))
      errors.push("Field 'communication_contract' must be an object");
    else {
      if (typeof manifest.communication_contract.protocol !== "string")
        errors.push("Field 'communication_contract.protocol' must be a string");
      if (typeof manifest.communication_contract.mailbox_path !== "string")
        errors.push("Field 'communication_contract.mailbox_path' must be a string");
      if (typeof manifest.communication_contract.lock_path !== "string")
        errors.push("Field 'communication_contract.lock_path' must be a string");
      if (!Array.isArray(manifest.communication_contract.allowed_channels))
        errors.push("Field 'communication_contract.allowed_channels' must be an array of strings");
      else if (
        !manifest.communication_contract.allowed_channels.every(
          (c: unknown) => typeof c === "string",
        )
      )
        errors.push(
          "Field 'communication_contract.allowed_channels' array must only contain strings",
        );
      if (typeof manifest.communication_contract.ban_raw_jsonl_reading !== "boolean")
        errors.push("Field 'communication_contract.ban_raw_jsonl_reading' must be a boolean");
      if (
        manifest.communication_contract.forbid_native_messaging !== undefined &&
        typeof manifest.communication_contract.forbid_native_messaging !== "boolean"
      ) {
        errors.push("Field 'communication_contract.forbid_native_messaging' must be a boolean");
      }
    }
  }

  if (manifest.mandatory_turn1_actions !== undefined) {
    if (!Array.isArray(manifest.mandatory_turn1_actions))
      errors.push("Field 'mandatory_turn1_actions' must be an array of strings");
    else if (!manifest.mandatory_turn1_actions.every((a: unknown) => typeof a === "string"))
      errors.push("Field 'mandatory_turn1_actions' array must only contain strings");
  }

  if (manifest.dispatch_contract !== undefined && typeof manifest.dispatch_contract !== "string") {
    errors.push("Field 'dispatch_contract' must be a string");
  }

  return { valid: errors.length === 0, errors };
}
