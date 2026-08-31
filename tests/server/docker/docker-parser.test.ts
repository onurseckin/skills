import { describe, expect, it } from "bun:test";
import {
  normalizeContainerRecord,
  parseDockerPortMappings,
  parseDockerPsOutput,
  parsePortRange,
  parseSingleDockerPortMapping,
  parseTableLine,
} from "../../../olt/scripts/src/server/docker/index.ts";

describe("Docker Inspector - Port Range and Mapping Parser", () => {
  it("parses single port ranges correctly", () => {
    expect(parsePortRange("3000")).toEqual([3000]);
    expect(parsePortRange(" 8080 ")).toEqual([8080]);
    expect(parsePortRange("0")).toEqual([]);
    expect(parsePortRange("-1")).toEqual([]);
    expect(parsePortRange("70000")).toEqual([]);
    expect(parsePortRange("invalid")).toEqual([]);
    expect(parsePortRange("")).toEqual([]);
  });

  it("parses multi-port ranges correctly", () => {
    expect(parsePortRange("8000-8003")).toEqual([8000, 8001, 8002, 8003]);
    expect(parsePortRange("3000-3000")).toEqual([3000]);
    expect(parsePortRange("8005-8000")).toEqual([]);
    expect(parsePortRange("1-5000")).toEqual([]);
  });

  it("parses standard IPv4 published port mappings", () => {
    const mappings = parseDockerPortMappings("0.0.0.0:3000->3000/tcp");
    expect(mappings.length).toBe(1);
    const first = mappings[0];
    if (first !== undefined) {
      expect(first.hostIp).toBe("0.0.0.0");
      expect(first.hostPort).toBe(3000);
      expect(first.containerPort).toBe(3000);
      expect(first.protocol).toBe("tcp");
    }
  });

  it("parses IPv6 published port mappings", () => {
    const mappings = parseDockerPortMappings(":::3000->3000/tcp");
    expect(mappings.length).toBe(1);
    const first = mappings[0];
    if (first !== undefined) {
      expect(first.hostIp).toBe("::");
      expect(first.hostPort).toBe(3000);
      expect(first.containerPort).toBe(3000);
      expect(first.protocol).toBe("tcp");
    }

    const bracketIpv6 = parseDockerPortMappings("[::1]:8080->80/tcp");
    expect(bracketIpv6.length).toBe(1);
    const bracketFirst = bracketIpv6[0];
    if (bracketFirst !== undefined) {
      expect(bracketFirst.hostIp).toBe("::1");
      expect(bracketFirst.hostPort).toBe(8080);
      expect(bracketFirst.containerPort).toBe(80);
    }
  });

  it("parses UDP and custom protocol mappings", () => {
    const udpMappings = parseDockerPortMappings("0.0.0.0:5353->53/udp");
    expect(udpMappings.length).toBe(1);
    const udpFirst = udpMappings[0];
    if (udpFirst !== undefined) {
      expect(udpFirst.protocol).toBe("udp");
      expect(udpFirst.hostPort).toBe(5353);
      expect(udpFirst.containerPort).toBe(53);
    }

    const sctpMappings = parseDockerPortMappings("127.0.0.1:9000->9000/sctp");
    expect(sctpMappings.length).toBe(1);
    const sctpFirst = sctpMappings[0];
    if (sctpFirst !== undefined) {
      expect(sctpFirst.protocol).toBe("sctp");
    }
  });

  it("parses port range mappings into discrete port items", () => {
    const rangeMappings = parseDockerPortMappings("0.0.0.0:8000-8002->8000-8002/tcp");
    expect(rangeMappings.length).toBe(3);
    const r0 = rangeMappings[0];
    const r1 = rangeMappings[1];
    const r2 = rangeMappings[2];
    if (r0 !== undefined && r1 !== undefined && r2 !== undefined) {
      expect(r0.hostPort).toBe(8000);
      expect(r0.containerPort).toBe(8000);
      expect(r1.hostPort).toBe(8001);
      expect(r1.containerPort).toBe(8001);
      expect(r2.hostPort).toBe(8002);
      expect(r2.containerPort).toBe(8002);
    }
  });

  it("parses multiple comma-separated port mappings", () => {
    const raw = "0.0.0.0:3000->3000/tcp, :::3000->3000/tcp, 127.0.0.1:9229->9229/tcp";
    const mappings = parseDockerPortMappings(raw);
    expect(mappings.length).toBe(3);
    const m0 = mappings[0];
    const m1 = mappings[1];
    const m2 = mappings[2];
    if (m0 !== undefined && m1 !== undefined && m2 !== undefined) {
      expect(m0.hostPort).toBe(3000);
      expect(m0.hostIp).toBe("0.0.0.0");
      expect(m1.hostPort).toBe(3000);
      expect(m1.hostIp).toBe("::");
      expect(m2.hostPort).toBe(9229);
      expect(m2.hostIp).toBe("127.0.0.1");
    }
  });

  it("ignores unmapped exposed ports (e.g. 3000/tcp without host arrow)", () => {
    const raw = "80/tcp, 443/tcp, 0.0.0.0:8080->80/tcp";
    const mappings = parseDockerPortMappings(raw);
    expect(mappings.length).toBe(1);
    const first = mappings[0];
    if (first !== undefined) {
      expect(first.hostPort).toBe(8080);
      expect(first.containerPort).toBe(80);
    }
  });

  it("handles malformed, empty, and whitespace strings gracefully without throwing", () => {
    expect(parseDockerPortMappings("")).toEqual([]);
    expect(parseDockerPortMappings("   ")).toEqual([]);
    expect(parseDockerPortMappings("invalid-token")).toEqual([]);
    expect(parseDockerPortMappings("->")).toEqual([]);
    expect(parseDockerPortMappings(":::->")).toEqual([]);
    expect(parseSingleDockerPortMapping("")).toEqual([]);
    expect(parseSingleDockerPortMapping(":::->80/tcp")).toEqual([]);
  });
});

describe("Docker Inspector - CLI and API Output Normalization", () => {
  it("parses NDJSON output from modern docker ps", () => {
    const ndjson = `
{"ID":"c1a2b3c4d5e6","Names":"frontend-dev","Image":"node:20-alpine","Ports":"0.0.0.0:3000->3000/tcp, :::3000->3000/tcp","State":"running","Status":"Up 4 hours"}
{"ID":"f7e8d9c0b1a2","Names":"postgres-db","Image":"postgres:16","Ports":"0.0.0.0:5432->5432/tcp","State":"running","Status":"Up 1 day"}
`;
    const containers = parseDockerPsOutput(ndjson);
    expect(containers.length).toBe(2);

    const c1 = containers[0];
    if (c1 !== undefined) {
      expect(c1.containerId).toBe("c1a2b3c4d5e6");
      expect(c1.containerName).toBe("frontend-dev");
      expect(c1.image).toBe("node:20-alpine");
      expect(c1.status).toBe("Up 4 hours");
      expect(c1.state).toBe("running");
      expect(c1.portMappings.length).toBe(2);
      const pm0 = c1.portMappings[0];
      if (pm0 !== undefined) {
        expect(pm0.hostPort).toBe(3000);
      }
    }

    const c2 = containers[1];
    if (c2 !== undefined) {
      expect(c2.containerId).toBe("f7e8d9c0b1a2");
      expect(c2.containerName).toBe("postgres-db");
      const pm0 = c2.portMappings[0];
      if (pm0 !== undefined) {
        expect(pm0.hostPort).toBe(5432);
      }
    }
  });

  it("parses JSON array format from docker inspect / API", () => {
    const jsonArray = JSON.stringify([
      {
        Id: "a1b2c3d4e5f6",
        Name: "/redis-cache",
        Image: "redis:7",
        State: "running",
        Status: "Up 10 minutes",
        Ports: [
          {
            IP: "0.0.0.0",
            PublicPort: 6379,
            PrivatePort: 6379,
            Type: "tcp",
          },
        ],
      },
    ]);

    const containers = parseDockerPsOutput(jsonArray);
    expect(containers.length).toBe(1);
    const container = containers[0];
    if (container !== undefined) {
      expect(container.containerId).toBe("a1b2c3d4e5f6");
      expect(container.containerName).toBe("redis-cache");
      expect(container.image).toBe("redis:7");
      expect(container.portMappings.length).toBe(1);
      const pm0 = container.portMappings[0];
      if (pm0 !== undefined) {
        expect(pm0.hostPort).toBe(6379);
        expect(pm0.containerPort).toBe(6379);
        expect(pm0.hostIp).toBe("0.0.0.0");
      }
    }
  });

  it("parses plain-text table output fallback", () => {
    const table = `
CONTAINER ID   IMAGE          COMMAND                  CREATED         STATUS         PORTS                                        NAMES
112233445566   nginx:alpine   "/docker-entrypoint.…"   2 hours ago     Up 2 hours     0.0.0.0:8080->80/tcp, :::8080->80/tcp        my-nginx
`;
    const containers = parseDockerPsOutput(table);
    expect(containers.length).toBe(1);
    const c = containers[0];
    if (c !== undefined) {
      expect(c.containerId).toBe("112233445566");
      expect(c.image).toBe("nginx:alpine");
      expect(c.containerName).toBe("my-nginx");
      expect(c.portMappings.length).toBe(2);
      const pm0 = c.portMappings[0];
      if (pm0 !== undefined) {
        expect(pm0.hostPort).toBe(8080);
        expect(pm0.containerPort).toBe(80);
      }
    }
  });

  it("handles empty or invalid outputs cleanly", () => {
    expect(parseDockerPsOutput("")).toEqual([]);
    expect(parseDockerPsOutput("   \n\n  ")).toEqual([]);
    expect(parseDockerPsOutput("invalid non-json string without table")).toEqual([]);
    expect(normalizeContainerRecord({})).toBeNull();
    expect(parseTableLine("")).toBeNull();
  });
});
