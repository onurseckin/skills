import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DOCKER_SOCKET_PATH,
  getCandidateSocketPaths,
  inspectContainersViaSocket,
  isDockerSocketPresent,
  resolveDockerSocketPath,
} from "../../olt/scripts/src/server/docker/socket.ts";

function getTempSocketPath(): string {
  return join(tmpdir(), `dockertest-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
}

describe("Server Docker - Socket Discovery and Client", () => {
  it("discovers candidate socket paths across platforms", () => {
    const originalHome = process.env["HOME"];
    const originalXdg = process.env["XDG_RUNTIME_DIR"];

    process.env["HOME"] = "/mock/home/user";
    process.env["XDG_RUNTIME_DIR"] = "/mock/xdg/runtime";

    const candidates = getCandidateSocketPaths();
    expect(candidates).toContain(join("/mock/home/user", ".docker", "run", "docker.sock"));
    expect(candidates).toContain(join("/mock/home/user", ".orbstack", "run", "docker.sock"));
    expect(candidates).toContain(join("/mock/xdg/runtime", "docker.sock"));
    expect(candidates).toContain(DEFAULT_DOCKER_SOCKET_PATH);

    if (originalHome !== undefined) process.env["HOME"] = originalHome;
    else delete process.env["HOME"];
    if (originalXdg !== undefined) process.env["XDG_RUNTIME_DIR"] = originalXdg;
    else delete process.env["XDG_RUNTIME_DIR"];
  });

  it("handles empty HOME and XDG_RUNTIME_DIR in candidate discovery", () => {
    const originalHome = process.env["HOME"];
    const originalXdg = process.env["XDG_RUNTIME_DIR"];

    process.env["HOME"] = "";
    delete process.env["XDG_RUNTIME_DIR"];

    const candidates = getCandidateSocketPaths();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates).toContain(DEFAULT_DOCKER_SOCKET_PATH);

    if (originalHome !== undefined) process.env["HOME"] = originalHome;
    else delete process.env["HOME"];
    if (originalXdg !== undefined) process.env["XDG_RUNTIME_DIR"] = originalXdg;
  });

  it("resolves docker socket path from custom path, env variables, or defaults", () => {
    expect(resolveDockerSocketPath("  /custom/socket.sock  ")).toBe("/custom/socket.sock");

    const origHost = process.env["DOCKER_HOST"];
    const origSock = process.env["DOCKER_SOCKET"];

    process.env["DOCKER_HOST"] = "unix:///var/run/custom-docker.sock";
    delete process.env["DOCKER_SOCKET"];
    expect(resolveDockerSocketPath()).toBe("/var/run/custom-docker.sock");

    process.env["DOCKER_HOST"] = "tcp://127.0.0.1:2375";
    process.env["DOCKER_SOCKET"] = " /env/socket.sock ";
    expect(resolveDockerSocketPath()).toBe("/env/socket.sock");

    delete process.env["DOCKER_HOST"];
    delete process.env["DOCKER_SOCKET"];

    const resolved = resolveDockerSocketPath();
    expect(typeof resolved).toBe("string");
    expect(resolved.length).toBeGreaterThan(0);

    if (origHost !== undefined) process.env["DOCKER_HOST"] = origHost;
    if (origSock !== undefined) process.env["DOCKER_SOCKET"] = origSock;
  });

  it("resolves candidate socket when a candidate file exists on disk", () => {
    const origHome = process.env["HOME"];
    const origHost = process.env["DOCKER_HOST"];
    const origSock = process.env["DOCKER_SOCKET"];

    const mockHome = join(tmpdir(), `mock-home-${Date.now()}`);
    mkdirSync(join(mockHome, ".docker", "run"), { recursive: true });
    const candidateFile = join(mockHome, ".docker", "run", "docker.sock");
    writeFileSync(candidateFile, "");

    try {
      process.env["HOME"] = mockHome;
      delete process.env["DOCKER_HOST"];
      delete process.env["DOCKER_SOCKET"];

      const discovered = resolveDockerSocketPath();
      expect(discovered).toBe(candidateFile);
    } finally {
      if (existsSync(mockHome)) rmSync(mockHome, { recursive: true, force: true });
      if (origHome !== undefined) process.env["HOME"] = origHome;
      else delete process.env["HOME"];
      if (origHost !== undefined) process.env["DOCKER_HOST"] = origHost;
      if (origSock !== undefined) process.env["DOCKER_SOCKET"] = origSock;
    }
  });

  it("checks if docker socket is present locally", () => {
    expect(isDockerSocketPresent("/non/existent/path/docker.sock")).toBe(false);
  });

  it("inspects containers via socket: returns error when socket does not exist", async () => {
    const result = await inspectContainersViaSocket("/non/existent/mock.sock", 200);
    expect(result.isDockerAvailable).toBe(false);
    expect(result.isDaemonRunning).toBe(false);
    expect(result.containers).toEqual([]);
    expect(result.error).toContain("Docker socket not found");
  });

  it("inspects containers via socket: handles 200 OK response with containers", async () => {
    const sockPath = getTempSocketPath();
    const server = http.createServer((req, res) => {
      if (req.url === "/containers/json" && req.method === "GET") {
        const payload = JSON.stringify([
          {
            Id: "c1122334455",
            Name: "/web-app",
            Image: "node:20",
            State: "running",
            Status: "Up 2 hours",
            Ports: [{ IP: "0.0.0.0", PublicPort: 8080, PrivatePort: 80, Type: "tcp" }],
          },
        ]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(payload);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((res) => server.listen(sockPath, () => res()));

    try {
      const result = await inspectContainersViaSocket(sockPath, 1000);
      expect(result.isDockerAvailable).toBe(true);
      expect(result.isDaemonRunning).toBe(true);
      expect(result.containers.length).toBe(1);
      expect(result.containers[0]?.containerId).toBe("c1122334455");
      expect(result.containers[0]?.containerName).toBe("web-app");
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  });

  it("inspects containers via socket: handles non-200 error response from daemon", async () => {
    const sockPath = getTempSocketPath();
    const server = http.createServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal docker engine error");
    });

    await new Promise<void>((res) => server.listen(sockPath, () => res()));

    try {
      const result = await inspectContainersViaSocket(sockPath, 1000);
      expect(result.isDockerAvailable).toBe(true);
      expect(result.isDaemonRunning).toBe(false);
      expect(result.containers).toEqual([]);
      expect(result.error).toContain("Docker socket returned status 500");
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  });

  it("inspects containers via socket: handles request timeout", async () => {
    const sockPath = getTempSocketPath();
    const server = http.createServer((_req, _res) => {
      // Intentionally hang without responding
    });

    await new Promise<void>((res) => server.listen(sockPath, () => res()));

    try {
      const result = await inspectContainersViaSocket(sockPath, 50);
      expect(result.isDockerAvailable).toBe(false);
      expect(result.isDaemonRunning).toBe(false);
      expect(result.containers).toEqual([]);
      expect(result.error).toContain("timed out after 50ms");
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  });

  it("inspects containers via socket: handles socket connection error", async () => {
    const sockPath = getTempSocketPath();
    const server = http.createServer();
    server.on("connection", (sock) => {
      sock.destroy(new Error("Connection reset by test peer"));
    });

    await new Promise<void>((res) => server.listen(sockPath, () => res()));

    try {
      const result = await inspectContainersViaSocket(sockPath, 1000);
      expect(result.isDockerAvailable).toBe(false);
      expect(result.isDaemonRunning).toBe(false);
      expect(result.containers).toEqual([]);
      expect(result.error).toContain("Docker socket error");
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
      if (existsSync(sockPath)) unlinkSync(sockPath);
    }
  });
});
