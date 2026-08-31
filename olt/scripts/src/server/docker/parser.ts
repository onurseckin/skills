import type { DockerContainerInfo, DockerPortMapping } from "./types.ts";

/**
 * Parses a port range string (e.g. "3000" or "8000-8002") into an array of port numbers.
 */
export function parsePortRange(rangeStr: string): number[] {
  const trimmed = rangeStr.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.includes("-")) {
    const parts = trimmed.split("-");
    if (parts.length === 2) {
      const p0 = parts[0];
      const p1 = parts[1];
      if (p0 !== undefined && p1 !== undefined) {
        const start = parseInt(p0.trim(), 10);
        const end = parseInt(p1.trim(), 10);
        if (
          !Number.isNaN(start) &&
          !Number.isNaN(end) &&
          start > 0 &&
          start <= 65535 &&
          end >= start &&
          end <= 65535 &&
          end - start <= 1024
        ) {
          const ports: number[] = [];
          for (let p = start; p <= end; p++) {
            ports.push(p);
          }
          return ports;
        }
      }
    }
    return [];
  }

  const single = parseInt(trimmed, 10);
  if (!Number.isNaN(single) && single > 0 && single <= 65535 && String(single) === trimmed) {
    return [single];
  }

  return [];
}

/**
 * Parses a single Docker port mapping token (e.g. "0.0.0.0:3000->3000/tcp").
 */
export function parseSingleDockerPortMapping(entry: string): DockerPortMapping[] {
  const trimmed = entry.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (!trimmed.includes("->")) {
    return [];
  }

  const arrowIndex = trimmed.indexOf("->");
  const left = trimmed.slice(0, arrowIndex).trim();
  const right = trimmed.slice(arrowIndex + 2).trim();

  if (left.length === 0) {
    return [];
  }
  if (right.length === 0) {
    return [];
  }

  let containerPortPart = right;
  let protocol = "tcp";

  if (right.includes("/")) {
    const slashIdx = right.indexOf("/");
    containerPortPart = right.slice(0, slashIdx).trim();
    const protoPart = right.slice(slashIdx + 1).trim().toLowerCase();
    if (protoPart.length > 0) {
      protocol = protoPart;
    }
  }

  const containerPorts = parsePortRange(containerPortPart);
  if (containerPorts.length === 0) {
    return [];
  }

  let hostIp: string | undefined = undefined;
  let hostPortPart = left;

  if (left.startsWith("[") && left.includes("]:")) {
    const closingBracket = left.indexOf("]:");
    hostIp = left.slice(1, closingBracket).trim();
    hostPortPart = left.slice(closingBracket + 2).trim();
  } else if (left.includes(":")) {
    const lastColon = left.lastIndexOf(":");
    hostIp = left.slice(0, lastColon).trim();
    hostPortPart = left.slice(lastColon + 1).trim();
  }

  const hostPorts = parsePortRange(hostPortPart);
  if (hostPorts.length === 0) {
    return [];
  }

  const mappings: DockerPortMapping[] = [];

  if (hostPorts.length === containerPorts.length) {
    for (let i = 0; i < hostPorts.length; i++) {
      const hp = hostPorts[i];
      const cp = containerPorts[i];
      if (hp !== undefined && cp !== undefined) {
        if (hostIp !== undefined && hostIp.length > 0) {
          mappings.push({
            hostIp,
            hostPort: hp,
            containerPort: cp,
            protocol,
          });
        } else {
          mappings.push({
            hostPort: hp,
            containerPort: cp,
            protocol,
          });
        }
      }
    }
  } else {
    const firstCp = containerPorts[0];
    if (firstCp !== undefined) {
      for (const hp of hostPorts) {
        if (hostIp !== undefined && hostIp.length > 0) {
          mappings.push({
            hostIp,
            hostPort: hp,
            containerPort: firstCp,
            protocol,
          });
        } else {
          mappings.push({
            hostPort: hp,
            containerPort: firstCp,
            protocol,
          });
        }
      }
    }
  }

  return mappings;
}

/**
 * Parses a Docker published ports string (e.g. "0.0.0.0:3000->3000/tcp, :::3000->3000/tcp").
 */
export function parseDockerPortMappings(portsString: string): DockerPortMapping[] {
  if (typeof portsString !== "string") {
    return [];
  }
  if (portsString.length === 0) {
    return [];
  }
  const entries = portsString
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const results: DockerPortMapping[] = [];
  for (const entry of entries) {
    const parsed = parseSingleDockerPortMapping(entry);
    for (const item of parsed) {
      results.push(item);
    }
  }
  return results;
}

/**
 * Extracts string value from record safely.
 */
function extractString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const val = record[key];
    if (typeof val === "string") {
      return val.trim();
    }
  }
  return undefined;
}

/**
 * Extracts field from record by candidate keys.
 */
function extractField(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    const val = record[key];
    if (val !== undefined && val !== null) {
      return val;
    }
  }
  return undefined;
}

/**
 * Parses Docker Engine API port array structure.
 */
function parseApiPortsArray(items: readonly unknown[]): DockerPortMapping[] {
  const results: DockerPortMapping[] = [];
  for (const item of items) {
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      let hostIp: string | undefined = undefined;
      const ipVal = extractField(obj, ["IP", "ip"]);
      if (typeof ipVal === "string" && ipVal.length > 0) {
        hostIp = ipVal;
      }

      const hostPortVal = extractField(obj, ["PublicPort", "publicPort", "HostPort", "hostPort"]);
      const containerPortVal = extractField(obj, ["PrivatePort", "privatePort", "ContainerPort", "containerPort"]);
      const protocolVal = extractField(obj, ["Type", "type", "Protocol", "protocol"]);

      let hostPort = NaN;
      if (typeof hostPortVal === "number") {
        hostPort = hostPortVal;
      } else if (typeof hostPortVal === "string") {
        hostPort = parseInt(hostPortVal, 10);
      }

      let containerPort = NaN;
      if (typeof containerPortVal === "number") {
        containerPort = containerPortVal;
      } else if (typeof containerPortVal === "string") {
        containerPort = parseInt(containerPortVal, 10);
      }

      let protocol = "tcp";
      if (typeof protocolVal === "string" && protocolVal.length > 0) {
        protocol = protocolVal.toLowerCase();
      }

      if (
        !Number.isNaN(hostPort) &&
        hostPort > 0 &&
        !Number.isNaN(containerPort) &&
        containerPort > 0
      ) {
        if (hostIp !== undefined) {
          results.push({
            hostIp,
            hostPort,
            containerPort,
            protocol,
          });
        } else {
          results.push({
            hostPort,
            containerPort,
            protocol,
          });
        }
      }
    }
  }
  return results;
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
  const containerId = rawId !== undefined ? rawId : "";

  const rawName = extractString(record, [
    "Names",
    "Name",
    "names",
    "name",
    "containerName",
    "ContainerName",
    "NAMES",
  ]);
  const containerName = (rawName !== undefined ? rawName : "").replace(/^\//, "");

  const rawImage = extractString(record, [
    "Image",
    "image",
    "ImageName",
    "imageName",
    "IMAGE",
  ]);
  const image = rawImage !== undefined ? rawImage : "";

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

  const result: {
    containerId: string;
    containerName: string;
    image: string;
    status?: string;
    state?: string;
    portMappings: readonly DockerPortMapping[];
    rawPorts?: string;
  } = {
    containerId,
    containerName,
    image,
    portMappings,
  };

  if (status !== undefined) {
    result.status = status;
  }
  if (state !== undefined) {
    result.state = state;
  }
  if (rawPorts !== undefined) {
    result.rawPorts = rawPorts;
  }

  return result;
}

/**
 * Parses raw plain-text tabular output fallback from `docker ps`.
 */
export function parseTableLine(line: string): DockerContainerInfo | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const tokens = trimmed
    .split(/\s{2,}/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length < 2) {
    return null;
  }

  const firstTok = tokens[0];
  const containerId = firstTok !== undefined ? firstTok : "";

  const secondTok = tokens[1];
  const image = secondTok !== undefined ? secondTok : "";

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
    if (lastTok !== undefined) {
      containerName = lastTok;
    }
  }

  if (containerId.length === 0 && image.length === 0) {
    return null;
  }

  const portMappings = rawPorts.length > 0 ? parseDockerPortMappings(rawPorts) : [];

  const result: {
    containerId: string;
    containerName: string;
    image: string;
    portMappings: readonly DockerPortMapping[];
    rawPorts?: string;
  } = {
    containerId,
    containerName: containerName.replace(/^\//, ""),
    image,
    portMappings,
  };

  if (rawPorts.length > 0) {
    result.rawPorts = rawPorts;
  }

  return result;
}

/**
 * Parses raw `docker ps` output (NDJSON lines, JSON array, or plain-text table).
 */
export function parseDockerPsOutput(rawOutput: string): DockerContainerInfo[] {
  if (typeof rawOutput !== "string") {
    return [];
  }
  if (rawOutput.length === 0) {
    return [];
  }
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) {
    return [];
  }

  // 1. JSON Array format: [ { ... }, { ... } ]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const list: DockerContainerInfo[] = [];
        for (const item of parsed) {
          if (typeof item === "object" && item !== null) {
            const info = normalizeContainerRecord(item as Record<string, unknown>);
            if (info !== null) {
              list.push(info);
            }
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
    if (line.includes("CONTAINER ID")) {
      isTableFormat = true;
      continue;
    }
    if (line.includes("IMAGE") && line.includes("PORTS")) {
      isTableFormat = true;
      continue;
    }

    // 4. Table row fallback
    if (isTableFormat) {
      const info = parseTableLine(line);
      if (info !== null) {
        containers.push(info);
      }
    }
  }

  return containers;
}
