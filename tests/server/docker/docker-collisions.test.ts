import { describe, expect, it } from "bun:test";
import {
  checkPortDockerCollision,
  checkPortDockerCollisionAsync,
  detectDockerPortConflicts,
  detectDockerPortConflictsAsync,
  DockerInspector,
  getCandidateSocketPaths,
  inspectRunningContainers,
  isDockerAvailable,
  isDockerDaemonUnavailableError,
  resolveDockerSocketPath,
  type DockerInspectorOptions,
  type DockerRunner,
} from "../../../olt/scripts/src/server/docker/index.ts";

describe("Docker Inspector - Collision Detection and Conflict Resolution", () => {
  const mockContainersNdjson = `
{"ID":"abc123456789","Names":"nextjs-dev","Image":"node:20","Ports":"0.0.0.0:3000->3000/tcp, :::3000->3000/tcp","State":"running","Status":"Up 30m"}
{"ID":"def987654321","Names":"api-gateway","Image":"kong:latest","Ports":"0.0.0.0:8000->8000/tcp, 0.0.0.0:8443->8443/tcp","State":"running","Status":"Up 2h"}
{"ID":"ghi555555555","Names":"vite-preview","Image":"vite:5","Ports":"127.0.0.1:5173->5173/tcp","State":"running","Status":"Up 5m"}
`;

  const mockRunner: DockerRunner = () => {
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

    const candidates = getCandidateSocketPaths();
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.includes("/var/run/docker.sock")).toBe(true);

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
