/**
 * Docker Port Mapping & Range Parsers.
 *
 * Extracts and normalizes host-to-container port mappings from Docker CLI and API formats.
 */

import type { DockerPortMapping } from "./types.ts";

/**
 * Parses a port range string (e.g. "3000" or "8000-8002") into an array of port numbers.
 */
export function parsePortRange(rangeStr: string): number[] {
  const trimmed = rangeStr.trim();
  if (trimmed.length === 0) return [];

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
  if (trimmed.length === 0 || !trimmed.includes("->")) return [];

  const arrowIndex = trimmed.indexOf("->");
  const left = trimmed.slice(0, arrowIndex).trim();
  const right = trimmed.slice(arrowIndex + 2).trim();

  if (left.length === 0 || right.length === 0) return [];

  let containerPortPart = right;
  let protocol = "tcp";

  if (right.includes("/")) {
    const slashIdx = right.indexOf("/");
    containerPortPart = right.slice(0, slashIdx).trim();
    const protoPart = right
      .slice(slashIdx + 1)
      .trim()
      .toLowerCase();
    if (protoPart.length > 0) {
      protocol = protoPart;
    }
  }

  const containerPorts = parsePortRange(containerPortPart);
  if (containerPorts.length === 0) return [];

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
  if (hostPorts.length === 0) return [];

  const mappings: DockerPortMapping[] = [];

  if (hostPorts.length === containerPorts.length) {
    for (let i = 0; i < hostPorts.length; i++) {
      const hp = hostPorts[i];
      const cp = containerPorts[i];
      if (hp !== undefined && cp !== undefined) {
        mappings.push({
          ...(hostIp && hostIp.length > 0 ? { hostIp } : {}),
          hostPort: hp,
          containerPort: cp,
          protocol,
        });
      }
    }
  } else {
    const firstCp = containerPorts[0];
    if (firstCp !== undefined) {
      for (const hp of hostPorts) {
        mappings.push({
          ...(hostIp && hostIp.length > 0 ? { hostIp } : {}),
          hostPort: hp,
          containerPort: firstCp,
          protocol,
        });
      }
    }
  }

  return mappings;
}

/**
 * Parses a Docker published ports string (e.g. "0.0.0.0:3000->3000/tcp, :::3000->3000/tcp").
 */
export function parseDockerPortMappings(portsString: string): DockerPortMapping[] {
  if (typeof portsString !== "string" || portsString.length === 0) return [];
  const entries = portsString
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const results: DockerPortMapping[] = [];
  for (const entry of entries) {
    for (const item of parseSingleDockerPortMapping(entry)) {
      results.push(item);
    }
  }
  return results;
}

function extractField(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const val = record[key];
    if (val !== undefined && val !== null) return val;
  }
  return undefined;
}

/**
 * Parses Docker Engine API port array structure.
 */
export function parseApiPortsArray(items: readonly unknown[]): DockerPortMapping[] {
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
      const containerPortVal = extractField(obj, [
        "PrivatePort",
        "privatePort",
        "ContainerPort",
        "containerPort",
      ]);
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
        results.push({
          ...(hostIp !== undefined ? { hostIp } : {}),
          hostPort,
          containerPort,
          protocol,
        });
      }
    }
  }
  return results;
}
