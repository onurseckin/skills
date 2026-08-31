/**
 * Docker ps output and JSON normalization parser.
 */

import type { DockerContainerInfo, DockerPortMapping } from "./types.ts";
import {
  parseApiPortsArray,
  parseDockerPortMappings,
  parsePortRange,
  parseSingleDockerPortMapping,
} from "./port-mapping.ts";

export {
  parseApiPortsArray,
  parseDockerPortMappings,
  parsePortRange,
  parseSingleDockerPortMapping,
};

function extractString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const val = record[key];
    if (typeof val === "string") return val.trim();
  }
  return undefined;
}

function extractField(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const val = record[key];
    if (val !== undefined && val !== null) return val;
  }
  return undefined;
}

/**
 * Normalizes a single Docker container record into structured DockerContainerInfo.
 */
export function normalizeContainerRecord(
  record: Record<string, unknown>,
): DockerContainerInfo | null {
  const rawId = extractString(record, [
    "ID",
    "Id",
    "id",
    "containerId",
    "ContainerId",
    "CONTAINER ID",
  ]);
  const containerId = rawId ?? "";

  const rawName = extractString(record, [
    "Names",
    "Name",
    "names",
    "name",
    "containerName",
    "ContainerName",
    "NAMES",
  ]);
  const containerName = (rawName ?? "").replace(/^\//, "");

  const rawImage = extractString(record, ["Image", "image", "ImageName", "imageName", "IMAGE"]);
  const image = rawImage ?? "";

  const status = extractString(record, ["Status", "status", "StatusText", "STATUS"]);
  const state = extractString(record, ["State", "state", "STATE"]);

  if (containerId.length === 0 && containerName.length === 0 && image.length === 0) {
    return null;
  }

  const portsField = extractField(record, ["Ports", "ports", "PortBindings", "PORTS"]);

  let portMappings: DockerPortMapping[] = [];
  let rawPorts: string | undefined = undefined;

  if (typeof portsField === "string") {
    rawPorts = portsField;
    portMappings = parseDockerPortMappings(portsField);
  } else if (Array.isArray(portsField)) {
    portMappings = parseApiPortsArray(portsField);
    rawPorts = JSON.stringify(portsField);
  }

  return {
    containerId,
    containerName,
    image,
    portMappings,
    ...(status !== undefined ? { status } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(rawPorts !== undefined ? { rawPorts } : {}),
  };
}

/**
 * Parses raw plain-text tabular output fallback from `docker ps`.
 */
export function parseTableLine(line: string): DockerContainerInfo | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const tokens = trimmed
    .split(/\s{2,}/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length < 2) return null;

  const containerId = tokens[0] ?? "";
  const image = tokens[1] ?? "";

  let rawPorts = "";
  let containerName = "";

  for (let i = 2; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok !== undefined && tok.includes("->")) {
      rawPorts = tok;
      const lastTok = tokens[tokens.length - 1];
      if (lastTok !== undefined && i !== tokens.length - 1) {
        containerName = lastTok;
      }
      break;
    }
  }

  if (containerName.length === 0 && tokens.length >= 3) {
    const lastTok = tokens[tokens.length - 1];
    if (lastTok !== undefined) containerName = lastTok;
  }

  if (containerId.length === 0 && image.length === 0) return null;

  const portMappings = rawPorts.length > 0 ? parseDockerPortMappings(rawPorts) : [];

  return {
    containerId,
    containerName: containerName.replace(/^\//, ""),
    image,
    portMappings,
    ...(rawPorts.length > 0 ? { rawPorts } : {}),
  };
}

/**
 * Parses raw `docker ps` output (NDJSON lines, JSON array, or plain-text table).
 */
export function parseDockerPsOutput(rawOutput: string): DockerContainerInfo[] {
  if (typeof rawOutput !== "string" || rawOutput.length === 0) return [];
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) return [];

  // 1. JSON Array format: [ { ... }, { ... } ]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const list: DockerContainerInfo[] = [];
        for (const item of parsed) {
          if (typeof item === "object" && item !== null) {
            const info = normalizeContainerRecord(item as Record<string, unknown>);
            if (info !== null) list.push(info);
          }
        }
        return list;
      }
    } catch {
      // Fallback
    }
  }

  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const containers: DockerContainerInfo[] = [];
  let isTableFormat = false;

  for (const line of lines) {
    // 2. NDJSON line format
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null) {
          const info = normalizeContainerRecord(parsed as Record<string, unknown>);
          if (info !== null) {
            containers.push(info);
            continue;
          }
        }
      } catch {
        // Not valid JSON line
      }
    }

    // 3. Table Header detection
    if (line.includes("CONTAINER ID") || (line.includes("IMAGE") && line.includes("PORTS"))) {
      isTableFormat = true;
      continue;
    }

    // 4. Table row fallback
    if (isTableFormat) {
      const info = parseTableLine(line);
      if (info !== null) containers.push(info);
    }
  }

  return containers;
}
