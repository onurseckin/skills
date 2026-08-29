import { generateCanonicalDefaultPolicy } from "../policy/index.ts";
import { loadRepoPolicy } from "../policy/repo-policy.ts";
import type { ContainerConfig, RepoPolicy } from "../policy/types.ts";

/**
 * Resolves the active RepoPolicy, falling back to loaded or canonical default policy.
 */
export function resolvePolicy(policy?: RepoPolicy): RepoPolicy {
  if (policy !== undefined) {
    return policy;
  }
  try {
    return loadRepoPolicy();
  } catch {
    return generateCanonicalDefaultPolicy(process.cwd());
  }
}

/**
 * Looks up container configuration from policy by key or container_name.
 */
export function resolveContainerConfig(
  containerName: string,
  policy?: RepoPolicy,
): ContainerConfig | undefined {
  if (typeof containerName !== "string" || containerName.trim().length === 0) {
    return undefined;
  }
  const activePolicy = resolvePolicy(policy);
  const dockerEnv = activePolicy.docker_environment;
  if (!dockerEnv || !dockerEnv.containers) {
    return undefined;
  }

  const trimmed = containerName.trim();
  if (dockerEnv.containers[trimmed]) {
    return dockerEnv.containers[trimmed];
  }

  for (const config of Object.values(dockerEnv.containers)) {
    if (config && config.container_name === trimmed) {
      return config;
    }
  }

  return undefined;
}

/**
 * Discovers ports for a specified container configuration.
 */
export function discoverContainerPorts(
  containerName: string,
  policy?: RepoPolicy,
): readonly string[] {
  const config = resolveContainerConfig(containerName, policy);
  return config?.ports ?? [];
}

/**
 * Probes the health endpoint of a container with a configurable timeout.
 * Returns false on unreachable ports, network errors, timeouts, non-200 responses, or missing configs.
 */
export async function probeContainerWithTimeout(
  containerName: string,
  policy?: RepoPolicy,
  timeoutMs?: number,
  customFetch?: typeof fetch,
): Promise<boolean> {
  const config = resolveContainerConfig(containerName, policy);
  if (!config || !config.health_endpoint || typeof config.health_endpoint !== "string") {
    return false;
  }

  const trimmedEndpoint = config.health_endpoint.trim();
  if (trimmedEndpoint.length === 0) {
    return false;
  }

  const effectiveTimeout =
    typeof timeoutMs === "number" && timeoutMs >= 0
      ? timeoutMs
      : typeof config.ready_timeout_ms === "number" && config.ready_timeout_ms > 0
        ? config.ready_timeout_ms
        : 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, effectiveTimeout);

  try {
    const fetchFn = customFetch ?? fetch;
    const response = await fetchFn(trimmedEndpoint, {
      signal: controller.signal,
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks if a container is healthy by probing its health endpoint.
 * Returns false without throwing if the endpoint is unreachable or returns non-200.
 */
export async function checkContainerHealth(
  containerName: string,
  policy?: RepoPolicy,
  customFetch?: typeof fetch,
): Promise<boolean> {
  return probeContainerWithTimeout(containerName, policy, undefined, customFetch);
}
