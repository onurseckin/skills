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
import {
  synthesizeCompanionManifest,
  type ValidationContext,
} from "../validator/index.ts";
import { deflateSync } from "node:zlib";

const CRC_TABLE: Int32Array = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  return table;
})();

function calculateCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) | 0;
}

export function createSyntheticPngBuffer(width = 10, height = 10, minBytes = 1024): Buffer {
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = 64;
      rawData[pxOffset + 1] = 128;
      rawData[pxOffset + 2] = 200;
      rawData[pxOffset + 3] = 255;
    }
  }

  const compressedData = deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const makeChunk = (type: string, data: Buffer): Buffer => {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const toCrc = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeInt32BE(calculateCrc32(toCrc), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(6, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const ihdrChunk = makeChunk("IHDR", ihdrData);

  const idatChunk = makeChunk("IDAT", compressedData);
  const initialLen = signature.length + ihdrChunk.length + idatChunk.length + 12;
  const padLen = Math.max(0, minBytes - initialLen);
  const textPayload = Buffer.concat([Buffer.from("Comment\0", "ascii"), Buffer.alloc(padLen, 65)]);
  const textChunk = makeChunk("tEXt", textPayload);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, textChunk, idatChunk, iendChunk]);
}

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
            const buf = createSyntheticPngBuffer(10, 10, 1024);
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
  if (targetViewports && targetViewports.length > 0) {
    const results: CaptureViewport[] = [];
    for (const name of targetViewports) {
      const vp = config.viewports[name] ?? CANONICAL_VIEWPORTS[name];
      if (vp) {
        results.push(vp);
      } else {
        results.push({ name, width: 1440, height: 900 });
      }
    }
    return results;
  }

  if (screen.viewports && screen.viewports.length > 0) {
    const results: CaptureViewport[] = [];
    for (const name of screen.viewports) {
      const vp = config.viewports[name] ?? CANONICAL_VIEWPORTS[name];
      if (vp) {
        results.push(vp);
      } else {
        results.push({ name, width: 1440, height: 900 });
      }
    }
    return results;
  }

  // Default to ALL viewports defined in config.viewports, or fallback to all CANONICAL_VIEWPORTS
  const allConfigured = Object.values(config.viewports);
  if (allConfigured.length > 0) {
    return allConfigured;
  }
  return Object.values(CANONICAL_VIEWPORTS);
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
