import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import {
  DEFAULT_ASYNC_DOCKER_TIMEOUT_MS,
  DEFAULT_DOCKER_TIMEOUT_MS,
  defaultDockerRunner,
  execDockerAsync,
  isDockerDaemonUnavailableError,
} from "../../olt/scripts/src/server/docker/runner.ts";

const TEST_ASYNC_TIMEOUT_MS = 30_000;

interface MaybeMockFunction {
  readonly mockRestore?: () => void;
}

let counter = 0;
const uniquePayload = (prefix: string): string =>
  `${prefix}-${process.pid}-${Date.now()}-${counter++}`;

describe("docker runner coverage suite", () => {
  beforeEach(() => {
    const sp = childProcess.spawn as unknown as MaybeMockFunction;
    if (typeof sp.mockRestore === "function") {
      sp.mockRestore();
    }
    const spSync = childProcess.spawnSync as unknown as MaybeMockFunction;
    if (typeof spSync.mockRestore === "function") {
      spSync.mockRestore();
    }
  });

  describe("constants", () => {
    it("exports standard timeout constants", () => {
      expect(DEFAULT_DOCKER_TIMEOUT_MS).toBe(4000);
      expect(DEFAULT_ASYNC_DOCKER_TIMEOUT_MS).toBe(2500);
    });
  });

  describe("defaultDockerRunner (synchronous)", () => {
    it("executes successful command and captures stdout", () => {
      const payload = uniquePayload("hello-docker-sync");
      const res = defaultDockerRunner("echo", [payload]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain(payload);
      expect(res.stderr).toBe("");
      expect(res.error).toBeUndefined();
    });

    it("captures non-zero exit status and stderr output", () => {
      const payload = uniquePayload("sync-err");
      const res = defaultDockerRunner("sh", ["-c", `echo ${payload} >&2; exit 42`]);
      expect(res.status).toBe(42);
      expect(res.stderr).toContain(payload);
    });

    it("handles nonexistent binary returning spawnSync error", () => {
      const res = defaultDockerRunner("nonexistent_docker_binary_xyz_12345", []);
      expect(res.error).toBeDefined();
      expect(res.status).toBeNull();
    });

    it("handles thrown errors in catch block if spawn fails catastrophically", () => {
      const res = defaultDockerRunner(null as unknown as string, []);
      expect(res.error).toBeDefined();
      expect(res.status).toBeNull();
    });
  });

  describe("execDockerAsync (asynchronous)", () => {
    it("proves timeout mechanism by returning null status on deliberately slow command", async () => {
      const res = await execDockerAsync("sleep", ["1"], 1);
      expect(res.status).toBeNull();
      expect(res.stderr).toBe("Docker command timed out");
      expect(res.error?.message).toContain("Docker command timed out after 1ms");
    });

    it("executes async process and captures stdout on close", async () => {
      const payload = uniquePayload("hello-docker-async");
      const res = await execDockerAsync("echo", [payload], TEST_ASYNC_TIMEOUT_MS);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain(payload);
      expect(res.stderr).toBe("");
      expect(res.error).toBeUndefined();
    });

    it("captures stderr and non-zero exit code asynchronously", async () => {
      const payload = uniquePayload("async-err");
      const res = await execDockerAsync(
        "sh",
        ["-c", `echo ${payload} >&2; exit 7`],
        TEST_ASYNC_TIMEOUT_MS,
      );
      expect(res.status).toBe(7);
      expect(res.stderr).toContain(payload);
    });

    it("captures both stdout and stderr chunks concurrently", async () => {
      const outPayload = uniquePayload("out-data");
      const errPayload = uniquePayload("err-data");
      const res = await execDockerAsync(
        "sh",
        ["-c", `echo ${outPayload}; echo ${errPayload} >&2`],
        TEST_ASYNC_TIMEOUT_MS,
      );
      expect(res.status).toBe(0);
      expect(res.stdout).toContain(outPayload);
      expect(res.stderr).toContain(errPayload);
    });

    it("handles process spawn error event for invalid binary", async () => {
      const res = await execDockerAsync("nonexistent_async_bin_99999", [], TEST_ASYNC_TIMEOUT_MS);
      expect(res.status).toBeNull();
      expect(res.error).toBeDefined();
      expect(res.stderr.length).toBeGreaterThan(0);
    });

    it("handles command timeout and kills process with SIGKILL", async () => {
      const res = await execDockerAsync("sleep", ["2"], 50);
      expect(res.status).toBeNull();
      expect(res.stderr).toBe("Docker command timed out");
      expect(res.error).toBeDefined();
      expect(res.error?.message).toContain("Docker command timed out after 50ms");
    });

    it("uses default timeout when timeout argument is omitted", async () => {
      let passedTimeout: number | undefined;
      const originalSetTimeout = globalThis.setTimeout;
      const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
        (handler: Parameters<typeof setTimeout>[0], timeout?: number, ...args: unknown[]) => {
          passedTimeout = timeout;
          return originalSetTimeout(handler, TEST_ASYNC_TIMEOUT_MS, ...args);
        },
      );
      try {
        const payload = uniquePayload("default-timeout-test");
        const res = await execDockerAsync("echo", [payload]);
        expect(res.status).toBe(0);
        expect(res.stdout).toContain(payload);
        expect(passedTimeout).toBe(DEFAULT_ASYNC_DOCKER_TIMEOUT_MS);
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    it("handles thrown exception in catch block when spawn arguments are invalid", async () => {
      const res = await execDockerAsync(null as unknown as string, [], TEST_ASYNC_TIMEOUT_MS);
      expect(res.status).toBeNull();
      expect(res.error).toBeDefined();
    });
  });

  describe("isDockerDaemonUnavailableError", () => {
    it("detects error codes indicating unavailable daemon", () => {
      const enoentErr = Object.assign(new Error("File not found"), { code: "ENOENT" });
      expect(isDockerDaemonUnavailableError("", enoentErr)).toBe(true);

      const connRefusedErr = Object.assign(new Error("Refused"), { code: "ECONNREFUSED" });
      expect(isDockerDaemonUnavailableError("", connRefusedErr)).toBe(true);

      const timedOutErr = Object.assign(new Error("Timeout"), { code: "ETIMEDOUT" });
      expect(isDockerDaemonUnavailableError("", timedOutErr)).toBe(true);
    });

    it("detects daemon absence patterns in error messages", () => {
      expect(isDockerDaemonUnavailableError("", new Error("spawn ENOENT"))).toBe(true);
      expect(
        isDockerDaemonUnavailableError("", new Error("connect ECONNREFUSED /var/run/docker.sock")),
      ).toBe(true);
      expect(isDockerDaemonUnavailableError("", new Error("ETIMEDOUT connecting"))).toBe(true);
      expect(
        isDockerDaemonUnavailableError(
          "",
          new Error("Cannot connect to the Docker daemon at unix:///socket"),
        ),
      ).toBe(true);
      expect(isDockerDaemonUnavailableError("", new Error("Is the docker daemon running?"))).toBe(
        true,
      );
      expect(isDockerDaemonUnavailableError("", new Error("docker: command not found"))).toBe(true);
    });

    it("detects daemon absence patterns in stderr output", () => {
      expect(isDockerDaemonUnavailableError("Cannot connect to the Docker daemon")).toBe(true);
      expect(isDockerDaemonUnavailableError("is the docker daemon running?")).toBe(true);
      expect(isDockerDaemonUnavailableError("docker: command not found")).toBe(true);
      expect(isDockerDaemonUnavailableError("bash: line 1: docker: command not found")).toBe(true);
      expect(
        isDockerDaemonUnavailableError("No such file or directory: /var/run/docker.sock"),
      ).toBe(true);
      expect(
        isDockerDaemonUnavailableError(
          "error during connect: Get http://%2Fvar%2Frun%2Fdocker.sock",
        ),
      ).toBe(true);
      expect(
        isDockerDaemonUnavailableError(
          "Got permission denied while trying to connect to Docker daemon",
        ),
      ).toBe(true);
      expect(isDockerDaemonUnavailableError("Docker daemon is not running")).toBe(true);
      expect(isDockerDaemonUnavailableError("connection refused on docker socket")).toBe(true);
    });

    it("returns false for unrelated errors and stderr outputs", () => {
      expect(isDockerDaemonUnavailableError("Error: No such container: my-container")).toBe(false);
      expect(isDockerDaemonUnavailableError("unknown flag: --invalid-flag")).toBe(false);
      expect(isDockerDaemonUnavailableError("Dockerfile parse error: line 10")).toBe(false);
      expect(isDockerDaemonUnavailableError("", new Error("Invalid image format"))).toBe(false);
      expect(isDockerDaemonUnavailableError("")).toBe(false);
    });
  });
});
