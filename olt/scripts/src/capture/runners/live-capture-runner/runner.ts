import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadCaptureConfig } from "../../config/config-loader.ts";
import { synthesizeCompanionManifest, type ValidationContext } from "../../validator/index.ts";
import { extractDomPhysics } from "../dom-physics-extractor.ts";
import { SessionAuthResolver } from "../session-auth-resolver.ts";
import type {
  CaptureError,
  CaptureItemResult,
  CaptureRunOptions,
  CaptureRunResult,
  CompanionManifest,
} from "../types.ts";
import {
  filterScreens,
  resolveCaptureOutputDir,
  resolveViewportsForScreen,
} from "./path-resolver.ts";

export async function runLiveCapture(options: CaptureRunOptions = {}): Promise<CaptureRunResult> {
  if (options.browserProvider === undefined) {
    throw new Error(
      "runLiveCapture requires an explicit browserProvider that drives a real browser session. No default fabricator is substituted, because a silent synthetic fallback previously produced placeholder screenshots that were indistinguishable from genuine captured evidence.",
    );
  }

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

  const provider = options.browserProvider;
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
            ...(vp.deviceScaleFactor !== undefined
              ? { deviceScaleFactor: vp.deviceScaleFactor }
              : {}),
          });

          const sha256 = createHash("sha256").update(screenshotBuffer).digest("hex");

          const synth = synthesizeCompanionManifest({
            screenId: screen.id,
            viewport: vp.name,
            elements: physics.elements as unknown as ValidationContext["elements"],
            sidebarConfig: config.sidebar,
            viewportBounds: { width: vp.width, height: vp.height },
          });

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
            criteria: synth.criteria,
            ...(synth.cognitiveAnalysis ? { cognitiveAnalysis: synth.cognitiveAnalysis } : {}),
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
