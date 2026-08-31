import { describe, expect, test } from "bun:test";
import {
  checkContainerHealth,
  discoverContainerPorts,
  probeContainerWithTimeout,
  resolveContainerConfig,
  resolvePolicy,
} from "../../../olt/scripts/src/capture/docker-health.ts";
import type { RepoPolicy } from "../../../olt/scripts/src/policy/types/index.ts";

const mockPolicy: RepoPolicy = {
  schema_version: 1,
  ecosystem: "bun",
  test_runner: {
    default_command: "bun test",
    targeted_pattern: "bun test <path>",
    full_suite_command: "bun test",
    timeout_ms: 30000,
  },
  docker_environment: {
    enabled: true,
    compose_file: "docker-compose.test.yml",
    containers: {
      web_app: {
        container_name: "app-web-test",
        image: "node:20-alpine",
        ports: ["3000:3000", "3001:3001"],
        health_endpoint: "http://localhost:3000/api/health",
        ready_timeout_ms: 2000,
        env: { NODE_ENV: "test" },
      },
      db: {
        container_name: "db-postgres-test",
        image: "postgres:16-alpine",
        ports: ["5432:5432"],
        health_endpoint: "http://localhost:5432/healthz",
        ready_timeout_ms: 1000,
      },
      empty_endpoint: {
        container_name: "empty-endpoint-test",
        image: "alpine:latest",
        ports: [],
        health_endpoint: "",
        ready_timeout_ms: 500,
      },
    },
    test_user_personas: {
      admin: {
        role: "admin",
        email: "admin@olt.local",
        password_env_var: "OLT_TEST_ADMIN_PASSWORD",
        display_name: "Test Admin",
        tenant_id: "tenant-001",
        permissions: ["*"],
      },
      standard_user: {
        role: "standard_user",
        email: "user@olt.local",
        password_env_var: "OLT_TEST_USER_PASSWORD",
        display_name: "Standard User",
        tenant_id: "tenant-001",
        permissions: ["read"],
      },
      invited_member: {
        role: "invited_member",
        email: "invited@olt.local",
        password_env_var: "OLT_TEST_INVITED_PASSWORD",
        display_name: "Invited Member",
        tenant_id: "tenant-001",
        permissions: ["read"],
      },
      guest: {
        role: "guest",
        email: "guest@olt.local",
        password_env_var: "OLT_TEST_GUEST_PASSWORD",
        display_name: "Guest",
        tenant_id: "tenant-001",
        permissions: ["public_read"],
      },
    },
    auth_paths: {
      login_url: "http://localhost:3000/login",
      logout_url: "http://localhost:3000/logout",
      session_verify_url: "http://localhost:3000/api/auth/me",
    },
    session_cookie_templates: {
      session_id: {
        name: "olt_session_id",
        domain: "localhost",
        path: "/",
        http_only: true,
        secure: false,
        same_site: "Lax",
      },
    },
  },
};

describe("docker container health probe & port discovery", () => {
  describe("checkContainerHealth", () => {
    test("returns true for healthy 200 response", async () => {
      const mockFetch: typeof fetch = async (url) => {
        expect(url).toBe("http://localhost:3000/api/health");
        return new Response("OK", { status: 200 });
      };

      const isHealthy = await checkContainerHealth("web_app", mockPolicy, mockFetch);
      expect(isHealthy).toBe(true);
    });

    test("returns true for healthy 204 No Content response", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(null, { status: 204 });
      };

      const isHealthy = await checkContainerHealth("web_app", mockPolicy, mockFetch);
      expect(isHealthy).toBe(true);
    });

    test("returns false for 404 Not Found response", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response("Not Found", { status: 404 });
      };

      const isHealthy = await checkContainerHealth("web_app", mockPolicy, mockFetch);
      expect(isHealthy).toBe(false);
    });

    test("returns false for 500 Internal Server Error response", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response("Internal Server Error", { status: 500 });
      };

      const isHealthy = await checkContainerHealth("web_app", mockPolicy, mockFetch);
      expect(isHealthy).toBe(false);
    });

    test("returns false for 503 Service Unavailable response", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response("Service Unavailable", { status: 503 });
      };

      const isHealthy = await checkContainerHealth("web_app", mockPolicy, mockFetch);
      expect(isHealthy).toBe(false);
    });

    test("returns false without throwing when network connection is refused", async () => {
      const mockFetch: typeof fetch = async () => {
        throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:3000");
      };

      const isHealthy = await checkContainerHealth("web_app", mockPolicy, mockFetch);
      expect(isHealthy).toBe(false);
    });

    test("returns false without throwing when synchronous exception occurs", async () => {
      const mockFetch: typeof fetch = () => {
        throw new Error("Synchronous network failure");
      };

      const isHealthy = await checkContainerHealth("web_app", mockPolicy, mockFetch);
      expect(isHealthy).toBe(false);
    });

    test("returns false when container does not exist in policy", async () => {
      const mockFetch: typeof fetch = async () => new Response("OK", { status: 200 });

      const isHealthy = await checkContainerHealth("non_existent_container", mockPolicy, mockFetch);
      expect(isHealthy).toBe(false);
    });

    test("returns false when container name is empty string", async () => {
      const mockFetch: typeof fetch = async () => new Response("OK", { status: 200 });

      const isHealthy = await checkContainerHealth("   ", mockPolicy, mockFetch);
      expect(isHealthy).toBe(false);
    });

    test("returns false when container has empty health_endpoint", async () => {
      const mockFetch: typeof fetch = async () => new Response("OK", { status: 200 });

      const isHealthy = await checkContainerHealth("empty_endpoint", mockPolicy, mockFetch);
      expect(isHealthy).toBe(false);
    });

    test("resolves container by container_name property", async () => {
      const mockFetch: typeof fetch = async (url) => {
        expect(url).toBe("http://localhost:3000/api/health");
        return new Response("OK", { status: 200 });
      };

      const isHealthy = await checkContainerHealth("app-web-test", mockPolicy, mockFetch);
      expect(isHealthy).toBe(true);
    });
  });

  describe("probeContainerWithTimeout", () => {
    test("aborts and returns false when request exceeds timeout", async () => {
      const mockFetch: typeof fetch = async (_url, init) => {
        return new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
          setTimeout(() => {
            resolve(new Response("OK", { status: 200 }));
          }, 200);
        });
      };

      const isHealthy = await probeContainerWithTimeout("web_app", mockPolicy, 20, mockFetch);
      expect(isHealthy).toBe(false);
    });

    test("succeeds when request finishes within timeout", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response("OK", { status: 200 });
      };

      const isHealthy = await probeContainerWithTimeout("web_app", mockPolicy, 500, mockFetch);
      expect(isHealthy).toBe(true);
    });

    test("uses container ready_timeout_ms when timeoutMs parameter is omitted", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response("OK", { status: 200 });
      };

      const isHealthy = await probeContainerWithTimeout(
        "web_app",
        mockPolicy,
        undefined,
        mockFetch,
      );
      expect(isHealthy).toBe(true);
    });
  });

  describe("resolveContainerConfig & discoverContainerPorts", () => {
    test("discovers ports for valid container", () => {
      const ports = discoverContainerPorts("web_app", mockPolicy);
      expect(ports).toEqual(["3000:3000", "3001:3001"]);
    });

    test("discovers ports by container_name property", () => {
      const ports = discoverContainerPorts("db-postgres-test", mockPolicy);
      expect(ports).toEqual(["5432:5432"]);
    });

    test("returns empty array for unknown container", () => {
      const ports = discoverContainerPorts("unknown_service", mockPolicy);
      expect(ports).toEqual([]);
    });

    test("returns undefined config when policy has no docker_environment", () => {
      const policyWithoutDocker: RepoPolicy = {
        schema_version: 1,
        ecosystem: "bun",
        test_runner: {
          default_command: "bun test",
          targeted_pattern: "bun test <path>",
          full_suite_command: "bun test",
        },
      };

      const config = resolveContainerConfig("web_app", policyWithoutDocker);
      expect(config).toBeUndefined();
      expect(discoverContainerPorts("web_app", policyWithoutDocker)).toEqual([]);
    });
  });

  describe("policy auto-resolution", () => {
    test("resolves default policy when policy argument is omitted", () => {
      const resolved = resolvePolicy(undefined);
      expect(resolved).toBeDefined();
      expect(resolved.schema_version).toBe(1);
    });

    test("checkContainerHealth resolves default policy when omitted", async () => {
      const mockFetch: typeof fetch = async () => new Response("OK", { status: 200 });
      const isHealthy = await checkContainerHealth("web_app", undefined, mockFetch);
      expect(typeof isHealthy).toBe("boolean");
    });
  });
});
