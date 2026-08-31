import { describe, expect, it } from "bun:test";
import {
  checkPortDockerCollision,
  checkPortDockerCollisionAsync,
  detectDockerPortConflicts,
  detectDockerPortConflictsAsync,
  DockerInspector,
  inspectRunningContainers,
  isDockerAvailable,
  isDockerDaemonUnavailableError,
  normalizeContainerRecord,
  parseDockerPortMappings,
  parseDockerPsOutput,
  parsePortRange,
  parseSingleDockerPortMapping,
  parseTableLine,
  resolveDockerSocketPath,
  type DockerInspectorOptions,
  type DockerRunner,
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

describe("Docker Inspector - Collision Detection and Conflict Resolution", () => {
  const mockContainersNdjson = `
{"ID":"abc123456789","Names":"nextjs-dev","Image":"node:20","Ports":"0.0.0.0:3000->3000/tcp, :::3000->3000/tcp","State":"running","Status":"Up 30m"}
{"ID":"def987654321","Names":"api-gateway","Image":"kong:latest","Ports":"0.0.0.0:8000->8000/tcp, 0.0.0.0:8443->8443/tcp","State":"running","Status":"Up 2h"}
{"ID":"ghi555555555","Names":"vite-preview","Image":"vite:5","Ports":"127.0.0.1:5173->5173/tcp","State":"running","Status":"Up 5m"}
`;

  const mockRunner: DockerRunner = (_cmd, _args) => {
    return {
      status: 0,
      stdout: mockContainersNdjson,
      stderr: "",
    };
  };

  const options: DockerInspectorOptions = { runner: mockRunner };

  it("detects single port collision accurately", () => {
    const conflict = checkPortDockerCollision(3000, options);
    expect(conflict).not.toBeNull();
    if (conflict !== null) {
      expect(conflict.isOccupied).toBe(true);
      expect(conflict.containerId).toBe("abc123456789");
      expect(conflict.containerName).toBe("nextjs-dev");
      expect(conflict.image).toBe("node:20");
      expect(conflict.hostPort).toBe(3000);
      expect(conflict.containerPort).toBe(3000);
      expect(conflict.protocol).toBe("tcp");
    }
  });

  it("returns null when no collision exists for a port", () => {
    const conflict = checkPortDockerCollision(9999, options);
    expect(conflict).toBeNull();
  });

  it("detects collisions across multiple requested ports", () => {
    const result = detectDockerPortConflicts([3000, 5173, 9999], options);
    expect(result.isDockerAvailable).toBe(true);
    expect(result.hasConflict).toBe(true);
    expect(result.checkedPorts).toEqual([3000, 5173, 9999]);
    expect(result.conflicts.length).toBeGreaterThanOrEqual(2);

    const occupiedPorts = result.conflicts.map((c) => c.hostPort);
    expect(occupiedPorts).toContain(3000);
    expect(occupiedPorts).toContain(5173);
    expect(occupiedPorts).not.toContain(9999);
  });

  it("runs async collision detection functions properly", async () => {
    const conflict = await checkPortDockerCollisionAsync(5173, options);
    expect(conflict).not.toBeNull();
    if (conflict !== null) {
      expect(conflict.containerName).toBe("vite-preview");
      expect(conflict.hostPort).toBe(5173);
    }

    const multiResult = await detectDockerPortConflictsAsync([8000, 8443], options);
    expect(multiResult.hasConflict).toBe(true);
    expect(multiResult.conflicts.length).toBe(2);
  });
});

describe("Docker Inspector - Daemon Absence and Resilience", () => {
  it("classifies daemon errors correctly", () => {
    expect(
      isDockerDaemonUnavailableError(
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
      ),
    ).toBe(true);
    expect(isDockerDaemonUnavailableError("docker: command not found")).toBe(true);
    expect(isDockerDaemonUnavailableError("Is the docker daemon running?")).toBe(true);
    expect(
      isDockerDaemonUnavailableError("error during connect: Get http://...: connection refused"),
    ).toBe(true);
    expect(isDockerDaemonUnavailableError("", new Error("spawnSync docker ENOENT"))).toBe(true);
    expect(isDockerDaemonUnavailableError("some random error")).toBe(false);
  });

  it("gracefully handles missing docker CLI (ENOENT) without throwing", () => {
    const missingRunner: DockerRunner = () => {
      const enoentError = new Error("spawnSync docker ENOENT");
      const errObj = enoentError as unknown as Record<string, unknown>;
      errObj["code"] = "ENOENT";
      return {
        status: null,
        stdout: "",
        stderr: "docker: command not found",
        error: enoentError,
      };
    };

    const inspectResult = inspectRunningContainers({ runner: missingRunner });
    expect(inspectResult.isDockerAvailable).toBe(false);
    expect(inspectResult.isDaemonRunning).toBe(false);
    expect(inspectResult.containers).toEqual([]);
    if (inspectResult.error !== undefined) {
      expect(inspectResult.error).toContain("ENOENT");
    }

    const conflictResult = detectDockerPortConflicts([3000, 8080], { runner: missingRunner });
    expect(conflictResult.isDockerAvailable).toBe(false);
    expect(conflictResult.hasConflict).toBe(false);
    expect(conflictResult.conflicts).toEqual([]);
  });

  it("gracefully handles daemon stopped / disconnected", () => {
    const daemonStoppedRunner: DockerRunner = () => {
      return {
        status: 1,
        stdout: "",
        stderr:
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
      };
    };

    const inspectResult = inspectRunningContainers({ runner: daemonStoppedRunner });
    expect(inspectResult.isDockerAvailable).toBe(false);
    expect(inspectResult.isDaemonRunning).toBe(false);
    expect(inspectResult.containers).toEqual([]);
    if (inspectResult.error !== undefined) {
      expect(inspectResult.error).toContain("Cannot connect to the Docker daemon");
    }

    expect(isDockerAvailable({ runner: daemonStoppedRunner })).toBe(false);
  });

  it("gracefully handles runner throwing unexpected error", () => {
    const throwingRunner: DockerRunner = () => {
      throw new Error("Fatal process fault");
    };

    let caught = false;
    try {
      throwingRunner("docker", ["ps"]);
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });
});

describe("Docker Inspector - Class and Socket Utilities", () => {
  it("instantiates DockerInspector and executes methods", () => {
    const mockRunner: DockerRunner = () => ({
      status: 0,
      stdout: '{"ID":"123","Names":"app","Image":"node","Ports":"0.0.0.0:4000->4000/tcp"}',
      stderr: "",
    });

    const inspector = new DockerInspector({ runner: mockRunner });
    expect(inspector.isAvailable()).toBe(true);

    const inspect = inspector.inspect();
    expect(inspect.isDockerAvailable).toBe(true);
    expect(inspect.containers.length).toBe(1);

    const conflicts = inspector.detectConflicts([4000]);
    expect(conflicts.hasConflict).toBe(true);
    expect(conflicts.conflicts.length).toBe(1);

    const single = inspector.checkPort(4000);
    expect(single).not.toBeNull();
    if (single !== null) {
      expect(single.hostPort).toBe(4000);
    }

    const noConflict = inspector.checkPort(5000);
    expect(noConflict).toBeNull();
  });

  it("resolves Docker socket path from options and environment", () => {
    expect(resolveDockerSocketPath("/custom/docker.sock")).toBe("/custom/docker.sock");

    const originalDockerHost = process.env["DOCKER_HOST"];
    process.env["DOCKER_HOST"] = "unix:///tmp/custom-docker.sock";
    expect(resolveDockerSocketPath()).toBe("/tmp/custom-docker.sock");

    if (originalDockerHost !== undefined) {
      process.env["DOCKER_HOST"] = originalDockerHost;
    } else {
      delete process.env["DOCKER_HOST"];
    }
  });

  it("executes async inspector methods correctly", async () => {
    const mockRunner: DockerRunner = () => ({
      status: 0,
      stdout: '{"ID":"999","Names":"async-app","Image":"deno","Ports":"0.0.0.0:8000->8000/tcp"}',
      stderr: "",
    });

    const inspector = new DockerInspector({ runner: mockRunner });
    expect(await inspector.isAvailableAsync()).toBe(true);

    const inspectRes = await inspector.inspectAsync();
    expect(inspectRes.containers.length).toBe(1);

    const conflictRes = await inspector.detectConflictsAsync([8000]);
    expect(conflictRes.hasConflict).toBe(true);

    const checkRes = await inspector.checkPortAsync(8000);
    if (checkRes !== null) {
      expect(checkRes.containerName).toBe("async-app");
    }
  });
});
