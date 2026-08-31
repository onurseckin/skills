import type { CaptureViewport } from "../config/types.ts";
import { sha256Hex } from "./state-hasher.ts";
import type {
  EnvironmentContext,
  SessionContext,
  SnapshotContext,
  ViewportContext,
} from "./types.ts";

export function captureEnvironmentContext(): EnvironmentContext {
  const mem = process.memoryUsage();
  const timestamp = new Date().toISOString();
  const platform = process.platform;
  const runtime = typeof Bun !== "undefined" ? "bun" : "node";
  const runtimeVersion =
    typeof Bun !== "undefined" ? Bun.version : (process.versions.node ?? process.version);
  const heapUsedBytes = mem.heapUsed;
  const heapTotalBytes = mem.heapTotal;
  const processUptimeSeconds = Math.floor(process.uptime());

  const envSignature = `${platform}:${runtime}:${runtimeVersion}:${heapTotalBytes}`;
  const environmentSha256 = sha256Hex(envSignature);

  return {
    timestamp,
    platform,
    runtime,
    runtimeVersion,
    heapUsedBytes,
    heapTotalBytes,
    processUptimeSeconds,
    environmentSha256,
  };
}

export function captureViewportContext(
  viewport: CaptureViewport,
  options?: { readonly hasTouch?: boolean },
): ViewportContext {
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));
  const deviceScaleFactor = viewport.deviceScaleFactor ?? 1;
  const isLandscape = width >= height;
  const hasTouch = options?.hasTouch ?? false;

  return {
    name: viewport.name,
    width,
    height,
    deviceScaleFactor,
    isLandscape,
    hasTouch,
  };
}

export function captureSessionContext(auth?: {
  readonly role?: string | undefined;
  readonly token?: string | undefined;
  readonly personaId?: string | undefined;
}): SessionContext {
  if (!auth || (!auth.role && !auth.token && !auth.personaId)) {
    return { authenticated: false };
  }

  const sessionHash = auth.token ? sha256Hex(`SESSION_TOKEN:${auth.token}`) : undefined;

  return {
    authenticated: true,
    role: auth.role,
    personaId: auth.personaId,
    sessionHash,
  };
}

export function createSnapshotContext(params: {
  readonly viewport: CaptureViewport;
  readonly auth?:
    | {
        readonly role?: string | undefined;
        readonly token?: string | undefined;
        readonly personaId?: string | undefined;
      }
    | undefined;
  readonly url?: string | undefined;
  readonly screenId?: string | undefined;
}): SnapshotContext {
  return {
    environment: captureEnvironmentContext(),
    viewport: captureViewportContext(params.viewport),
    session: captureSessionContext(params.auth),
    url: params.url,
    screenId: params.screenId,
  };
}
