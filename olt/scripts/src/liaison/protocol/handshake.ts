import type {
  EndpointConfig,
  HandshakeAccept,
  HandshakeOffer,
  HandshakeReject,
  HandshakeResult,
} from "./types.ts";

export function parseSemanticVersion(
  version: string,
): { readonly major: number; readonly minor: number; readonly patch: number } | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-.*)?$/);
  if (!match) return null;
  const majorStr = match[1];
  const minorStr = match[2];
  const patchStr = match[3];
  if (majorStr === undefined || minorStr === undefined || patchStr === undefined) {
    return null;
  }

  return {
    major: parseInt(majorStr, 10),
    minor: parseInt(minorStr, 10),
    patch: parseInt(patchStr, 10),
  };
}

export function compareSemanticVersions(a: string, b: string): number {
  const parsedA = parseSemanticVersion(a);
  const parsedB = parseSemanticVersion(b);

  if (!parsedA && !parsedB) return a.localeCompare(b);
  if (!parsedA) return -1;
  if (!parsedB) return 1;

  if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor;
  return parsedA.patch - parsedB.patch;
}

export function createHandshakeOffer(params: {
  readonly endpoint_id: string;
  readonly protocol_version: string;
  readonly supported_versions?: readonly string[] | undefined;
  readonly capabilities: readonly string[];
  readonly heartbeat_interval_ms: number;
  readonly timestamp?: string | undefined;
}): HandshakeOffer {
  const supported =
    params.supported_versions && params.supported_versions.length > 0
      ? params.supported_versions
      : [params.protocol_version];

  const uniqueVersions = Array.from(new Set([params.protocol_version, ...supported]));

  return {
    endpoint_id: params.endpoint_id,
    protocol_version: params.protocol_version,
    supported_versions: uniqueVersions,
    capabilities: params.capabilities,
    heartbeat_interval_ms: params.heartbeat_interval_ms,
    timestamp: params.timestamp ?? new Date().toISOString(),
  };
}

export function isHandshakeAccept(result: HandshakeResult): result is HandshakeAccept {
  return result.accepted === true;
}

export function isHandshakeReject(result: HandshakeResult): result is HandshakeReject {
  return result.accepted === false;
}

export function negotiateHandshake(
  offer: HandshakeOffer,
  config: EndpointConfig,
  nowIso: string = new Date().toISOString(),
): HandshakeResult {
  // 1. Verify required capabilities
  if (config.required_capabilities && config.required_capabilities.length > 0) {
    const offerCapSet = new Set(offer.capabilities);
    for (const required of config.required_capabilities) {
      if (!offerCapSet.has(required)) {
        return {
          accepted: false,
          reject_reason: `Missing required capability: "${required}"`,
          endpoint_id: config.endpoint_id,
          timestamp: nowIso,
        };
      }
    }
  }

  // 2. Negotiate mutually supported protocol version
  const clientVersions = Array.from(new Set([offer.protocol_version, ...offer.supported_versions]));
  const serverVersions = new Set(config.supported_versions);
  const commonVersions = clientVersions.filter((v) => serverVersions.has(v));

  if (commonVersions.length === 0) {
    return {
      accepted: false,
      reject_reason: `Incompatible protocol versions. Offered: [${clientVersions.join(", ")}], Supported: [${config.supported_versions.join(", ")}]`,
      endpoint_id: config.endpoint_id,
      timestamp: nowIso,
    };
  }

  // Pick the highest mutually supported version
  commonVersions.sort((a, b) => compareSemanticVersions(b, a));
  const selectedVersion = commonVersions[0];
  if (!selectedVersion) {
    return {
      accepted: false,
      reject_reason: "Failed to resolve mutual protocol version",
      endpoint_id: config.endpoint_id,
      timestamp: nowIso,
    };
  }

  // 3. Negotiate agreed capabilities
  const serverCapSet = new Set(config.capabilities);
  const agreedCapabilities = offer.capabilities.filter((c) => serverCapSet.has(c));

  // 4. Negotiate heartbeat interval (clamp within server bounds)
  const clampedHeartbeat = Math.max(
    config.min_heartbeat_interval_ms,
    Math.min(config.max_heartbeat_interval_ms, offer.heartbeat_interval_ms),
  );

  return {
    accepted: true,
    selected_version: selectedVersion,
    agreed_capabilities: agreedCapabilities,
    agreed_heartbeat_interval_ms: clampedHeartbeat,
    endpoint_id: config.endpoint_id,
    timestamp: nowIso,
  };
}
