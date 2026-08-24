import * as yaml from 'js-yaml';

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
    readonly commands: readonly string[];
    readonly spawns: readonly string[];
  };
  readonly invariants: readonly string[];
  readonly protocol: {
    readonly cli: string;
    readonly zero_json: boolean;
  };
  readonly instructions: string;
}

export function parseUnifiedAgentManifest(rawYaml: string, filePath?: string): UnifiedAgentManifest {
  try {
    const doc = yaml.load(rawYaml);
    if (!doc || typeof doc !== 'object') {
      throw new Error('YAML document must be an object');
    }
    return doc as unknown as UnifiedAgentManifest;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse manifest${filePath ? ` at ${filePath}` : ''}: ${msg}`);
  }
}

export function validateUnifiedAgentManifest(manifest: UnifiedAgentManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof manifest.name !== 'string') errors.push("Field 'name' must be a string");
  if (typeof manifest.role !== 'string') errors.push("Field 'role' must be a string");
  if (typeof manifest.tier !== 'number' && manifest.tier !== "independent") {
    errors.push("Field 'tier' must be a number or 'independent'");
  }

  if (!Array.isArray(manifest.provider)) {
    errors.push("Field 'provider' must be an array of strings");
  } else if (!manifest.provider.every((p: unknown) => typeof p === 'string')) {
    errors.push("Field 'provider' array must only contain strings");
  }

  if (!manifest.tools || typeof manifest.tools !== 'object') {
    errors.push("Field 'tools' must be an object");
  } else {
    if (typeof manifest.tools.enable_subagent_tools !== 'boolean') {
      errors.push("Field 'tools.enable_subagent_tools' must be a boolean");
    }
    if (typeof manifest.tools.enable_write_tools !== 'boolean') {
      errors.push("Field 'tools.enable_write_tools' must be a boolean");
    }
  }

  if (!manifest.interface || typeof manifest.interface !== 'object') {
    errors.push("Field 'interface' must be an object");
  } else {
    if (typeof manifest.interface.display_name !== 'string') {
      errors.push("Field 'interface.display_name' must be a string");
    }
    if (typeof manifest.interface.short_description !== 'string') {
      errors.push("Field 'interface.short_description' must be a string");
    }
  }

  if (!manifest.permissions || typeof manifest.permissions !== 'object') {
    errors.push("Field 'permissions' must be an object");
  } else {
    const checkStringArray = (val: unknown, path: string) => {
      if (!Array.isArray(val)) {
        errors.push(`Field '${path}' must be an array of strings`);
      } else if (!val.every((p: unknown) => typeof p === 'string')) {
        errors.push(`Field '${path}' array must only contain strings`);
      }
    };
    checkStringArray(manifest.permissions.may, 'permissions.may');
    checkStringArray(manifest.permissions.must_not, 'permissions.must_not');
    checkStringArray(manifest.permissions.commands, 'permissions.commands');
    checkStringArray(manifest.permissions.spawns, 'permissions.spawns');
  }

  if (!Array.isArray(manifest.invariants)) {
    errors.push("Field 'invariants' must be an array of strings");
  } else {
    for (const inv of manifest.invariants as unknown[]) {
      if (typeof inv !== 'string') {
        errors.push(`Field 'invariants' array must only contain strings, found ${typeof inv}`);
      }
    }
  }

  if (!manifest.protocol || typeof manifest.protocol !== 'object') {
    errors.push("Field 'protocol' must be an object");
  } else {
    if (typeof manifest.protocol.cli !== 'string') {
      errors.push("Field 'protocol.cli' must be a string");
    }
    if (typeof manifest.protocol.zero_json !== 'boolean') {
      errors.push("Field 'protocol.zero_json' must be a boolean");
    }
  }

  if (typeof manifest.instructions !== 'string') {
    errors.push("Field 'instructions' must be a string");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
