import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CANONICAL_VIEWPORTS } from "../config/default-presets.ts";
import { loadCaptureConfig } from "../config/config-loader.ts";
import type { CaptureConfig, CaptureScreenTarget, CaptureViewport } from "../config/types.ts";
import { extractDomPhysics } from "./dom-physics-extractor.ts";
import { SessionAuthResolver } from "./session-auth-resolver.ts";
import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CaptureError,
  CaptureItemResult,
  CapturePageDriver,
  CaptureRunOptions,
  CaptureRunResult,
  CompanionManifest,
  DomPhysicsSnapshot,
} from "./types.ts";

const MINIMAL_PNG_HEX =
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d480000000049454e44ae426082";

export class DefaultFallbackBrowserProvider implements CaptureBrowserProvider {
  public async launch(_options?: { headless?: boolean }): Promise<CaptureBrowserDriver> {
    return {
      newPage: async (): Promise<CapturePageDriver> => {
        let currentViewport = { width: 1440, height: 900 };
        return {
          setViewportSize: async (size) => {
            currentViewport = { width: size.width, height: size.height };
          },
          setExtraHTTPHeaders: async () => {},
          goto: async () => {},
          waitForSelector: async () => {},
          screenshot: async (opts) => {
            const buf = Buffer.from(MINIMAL_PNG_HEX, "hex");
            if (opts.path) {
              writeFileSync(opts.path, buf);
            }
            return buf;
          },
          evaluate: async <T>(_fn: unknown, _arg?: unknown): Promise<T> => {
            const fallback: DomPhysicsSnapshot = {
              viewport: {
                width: currentViewport.width,
                height: currentViewport.height,
                deviceScaleFactor: 1,
              },
              scrollPosition: { x: 0, y: 0 },
              elements: [],
              layoutOverflows: [],
              textClippings: [],
              capturedAt: new Date().toISOString(),
            };
            return fallback as unknown as T;
          },
        };
      },
      close: async () => {},
    };
  }
}

export function resolveCaptureOutputDir(options: CaptureRunOptions, config: CaptureConfig): string {
  if (options.outDir && options.outDir.trim().length > 0) {
    return resolve(options.outDir.trim());
  }
  if (options.capsuleDir && options.capsuleDir.trim().length > 0) {
    return resolve(join(options.capsuleDir.trim(), "captures"));
  }
  if (options.runId && options.runId.trim().length > 0) {
    return resolve(join(".capsules", options.runId.trim(), "captures"));
  }
  if (config.outputDir && config.outputDir.trim().length > 0) {
    return resolve(config.outputDir.trim());
  }
  return resolve("captures");
}

export function filterScreens(
  screens: readonly CaptureScreenTarget[],
  targetScreens?: readonly string[],
): readonly CaptureScreenTarget[] {
  if (!targetScreens || targetScreens.length === 0) return screens;
  const set = new Set(targetScreens.map((s) => s.toLowerCase()));
  return screens.filter((s) => set.has(s.id.toLowerCase()) || set.has(s.name.toLowerCase()));
}

export function resolveViewportsForScreen(
  screen: CaptureScreenTarget,
  config: CaptureConfig,
  targetViewports?: readonly string[],
): readonly CaptureViewport[] {
  const defaultList: readonly string[] = config.defaultViewport ? [config.defaultViewport] : ["desktop"];
  const allowedNames = targetViewports && targetViewports.length > 0
    ? targetViewports
    : screen.viewports && screen.viewports.length > 0
      ? screen.viewports
      : defaultList;

  const results: CaptureViewport[] = [];
  for (const name of allowedNames) {
    const vp = config.viewports[name] ?? CANONICAL_VIEWPORTS[name];
    if (vp) {
      results.push(vp);
    } else {
      results.push({ name, width: 1440, height: 900 });
    }
  }
  return results;
}

export async function runLiveCapture(options: CaptureRunOptions = {}): Promise<CaptureRunResult> {
  const config =
    options.config ??
    loadCaptureConfig(options.configPath !== undefined ? { configPath: options.configPath } : {});
  const outDir = resolveCaptureOutputDir(options, config);
  mkdirSync(outDir, { recursive: true });

  const authResolver = new SessionAuthResolver(config.auth);
  const screens = filterScreens(
    config.screens.length > 0
      ? config.screens
      : [{ id: "index", name: "Default Screen", path: "/" }],
    options.targetScreens,
  );

  const provider = options.browserProvider ?? new DefaultFallbackBrowserProvider();
  const browser = await provider.launch({ headless: options.headless ?? true });

  const captures: CaptureItemResult[] = [];
  const errors: CaptureError[] = [];

  try {
    const page = await browser.newPage();

    for (const screen of screens) {
      const viewports = resolveViewportsForScreen(screen, config, options.targetViewports);
      const authSession = screen.auth ? authResolver.resolveUser(screen.auth) : null;
      if (authSession) {
        await authResolver.applyAuthToDriver(page, authSession);
      }

      for (const vp of viewports) {
        try {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          const fullUrl = new URL(screen.path, options.baseUrl ?? config.baseUrl).toString();
          await page.goto(fullUrl, { waitUntil: "load" });

          if (screen.waitForSelector) {
            await page.waitForSelector(screen.waitForSelector);
          }

          if (screen.actions) {
            for (const act of screen.actions) {
              if (act.type === "click" && act.selector && page.click) {
                await page.click(act.selector);
              } else if (act.type === "fill" && act.selector && act.value && page.fill) {
                await page.fill(act.selector, act.value);
              } else if (act.type === "hover" && act.selector && page.hover) {
                await page.hover(act.selector);
              } else if (act.type === "wait" && act.timeoutMs && page.waitForTimeout) {
                await page.waitForTimeout(act.timeoutMs);
              }
            }
          }

          const fileBase = `${screen.id}-${vp.name}`;
          const imageFileName = `${fileBase}.png`;
          const manifestFileName = `${fileBase}.manifest.json`;
          const imagePath = join(outDir, imageFileName);
          const manifestPath = join(outDir, manifestFileName);

          const screenshotBuffer = await page.screenshot({
            path: imagePath,
            fullPage: screen.fullPage ?? false,
          });

          const physics = await extractDomPhysics(page, {
            width: vp.width,
            height: vp.height,
            ...(vp.deviceScaleFactor !== undefined ? { deviceScaleFactor: vp.deviceScaleFactor } : {}),
          });

          const sha256 = createHash("sha256").update(screenshotBuffer).digest("hex");

          const manifest: CompanionManifest = {
            schema: "companion.manifest.v1",
            screenId: screen.id,
            screenName: screen.name,
            path: screen.path,
            viewport: vp.name,
            dimensions: {
              width: vp.width,
              height: vp.height,
              deviceScaleFactor: vp.deviceScaleFactor ?? 1,
            },
            imageFile: basename(imagePath),
            imageSizeBytes: screenshotBuffer.byteLength,
            imageSha256: sha256,
            capturedAt: new Date().toISOString(),
            ...(authSession ? { authRole: authSession.role } : {}),
            physics,
            url: fullUrl,
          };

          writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

          captures.push({
            screenId: screen.id,
            screenName: screen.name,
            viewport: vp.name,
            imagePath,
            manifestPath,
            sizeBytes: screenshotBuffer.byteLength,
            manifest,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({
            screenId: screen.id,
            viewport: vp.name,
            error: message,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  } finally {
    await browser.close();
  }

  return {
    success: errors.length === 0 && captures.length > 0,
    totalCaptures: captures.length,
    outDir,
    captures,
    errors,
  };
}
