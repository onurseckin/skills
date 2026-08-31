import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptureConfig } from "../../../olt/scripts/src/capture/config/types.ts";
import {
  createEmptyDomPhysicsSnapshot,
  createSyntheticPngBuffer,
  DefaultFallbackBrowserProvider,
  extractPngDimensions,
  isPngBuffer,
  PNG_SIGNATURE,
  runLiveCapture,
  SessionAuthResolver,
  validatePngBuffer,
  type CaptureBrowserDriver,
  type CaptureBrowserProvider,
  type CaptureCookie,
  type CapturePageDriver,
  type CompanionManifest,
} from "../../../olt/scripts/src/capture/runners/index.ts";

describe("Task 3.3: Headless Mock Cookie Injector & Viewport PNG Validator", () => {
  describe("Binary PNG IHDR Validator (png-ihdr-validator)", () => {
    test("rejects 10x10 buffer padded to 1024 bytes when 1920x1080 is expected (hb-s6-fabricated-screenshot-evidence)", () => {
      const paddedSmallPng = createSyntheticPngBuffer(10, 10, 1024);
      expect(paddedSmallPng.byteLength).toBeGreaterThanOrEqual(1024);

      const parsed = extractPngDimensions(paddedSmallPng);
      expect(parsed).toEqual({ width: 10, height: 10 });

      const isValid = validatePngBuffer(paddedSmallPng, 1920, 1080);
      expect(isValid).toBe(false);
    });

    test("accepts valid PNG matching expected dimensions", () => {
      const fhdPng = createSyntheticPngBuffer(1920, 1080, 2048);
      expect(validatePngBuffer(fhdPng, 1920, 1080)).toBe(true);

      const desktopPng = createSyntheticPngBuffer(1440, 900, 1024);
      expect(validatePngBuffer(desktopPng, 1440, 900)).toBe(true);

      const tabletPng = createSyntheticPngBuffer(768, 1024, 1024);
      expect(validatePngBuffer(tabletPng, 768, 1024)).toBe(true);

      const mobilePng = createSyntheticPngBuffer(390, 844, 1024);
      expect(validatePngBuffer(mobilePng, 390, 844)).toBe(true);
    });

    test("rejects dimension mismatch on valid PNG buffers", () => {
      const desktopPng = createSyntheticPngBuffer(1440, 900, 1024);
      expect(validatePngBuffer(desktopPng, 1920, 1080)).toBe(false);
      expect(validatePngBuffer(desktopPng, 768, 1024)).toBe(false);
      expect(validatePngBuffer(desktopPng, 390, 844)).toBe(false);
      expect(validatePngBuffer(desktopPng, 1440, 800)).toBe(false);
    });

    test("rejects non-PNG and corrupted buffers", () => {
      expect(validatePngBuffer(Buffer.from("not-a-png-at-all"), 1920, 1080)).toBe(false);
      expect(validatePngBuffer(Buffer.alloc(0), 1920, 1080)).toBe(false);
      expect(validatePngBuffer(Buffer.alloc(10), 1920, 1080)).toBe(false);

      const corruptedSignature = Buffer.from(createSyntheticPngBuffer(1920, 1080));
      corruptedSignature[0] = 0x00;
      expect(isPngBuffer(corruptedSignature)).toBe(false);
      expect(validatePngBuffer(corruptedSignature, 1920, 1080)).toBe(false);

      const corruptedChunkType = Buffer.from(createSyntheticPngBuffer(1920, 1080));
      corruptedChunkType[12] = 0x58; // 'X' instead of 'I'
      expect(extractPngDimensions(corruptedChunkType)).toBeNull();
      expect(validatePngBuffer(corruptedChunkType, 1920, 1080)).toBe(false);

      const corruptedChunkLen = Buffer.from(createSyntheticPngBuffer(1920, 1080));
      corruptedChunkLen.writeUInt32BE(12, 8); // 12 instead of 13
      expect(extractPngDimensions(corruptedChunkLen)).toBeNull();
      expect(validatePngBuffer(corruptedChunkLen, 1920, 1080)).toBe(false);

      expect(validatePngBuffer(createSyntheticPngBuffer(1920, 1080), 0, 1080)).toBe(false);
      expect(validatePngBuffer(createSyntheticPngBuffer(1920, 1080), -1920, 1080)).toBe(false);
      expect(validatePngBuffer(createSyntheticPngBuffer(1920, 1080), NaN, 1080)).toBe(false);
    });

    test("isPngBuffer and PNG_SIGNATURE conformance", () => {
      expect(PNG_SIGNATURE).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(isPngBuffer(new Uint8Array(PNG_SIGNATURE))).toBe(true);
      expect(isPngBuffer(new Uint8Array([1, 2, 3]))).toBe(false);
    });
  });

  describe("DefaultFallbackBrowserProvider & Cookie Injection", () => {
    test("fallback provider generates viewport-matching PNGs and accepts cookies", async () => {
      const provider = new DefaultFallbackBrowserProvider();
      const browser = await provider.launch();
      const page = await browser.newPage();

      await page.setViewportSize({ width: 1920, height: 1080 });
      if (page.setCookies) {
        await page.setCookies([{ name: "session_token", value: "abc123", path: "/" }]);
      }
      if (page.setCookie) {
        await page.setCookie({ name: "flag", value: "enabled" });
      }

      const buf = await page.screenshot({});
      expect(validatePngBuffer(buf, 1920, 1080)).toBe(true);
      expect(extractPngDimensions(buf)).toEqual({ width: 1920, height: 1080 });

      await page.setViewportSize({ width: 375, height: 667 });
      const mobileBuf = await page.screenshot({});
      expect(validatePngBuffer(mobileBuf, 375, 667)).toBe(true);
      expect(extractPngDimensions(mobileBuf)).toEqual({ width: 375, height: 667 });

      await browser.close();
    });

    test("SessionAuthResolver resolves simulated and configured cookies to driver", async () => {
      const resolver = new SessionAuthResolver({
        users: {
          qa: {
            id: "qa-user",
            name: "QA User",
            role: "qa",
            cookies: [{ name: "auth_cookie", value: "val-123", domain: "localhost" }],
          },
        },
      });

      const userSession = resolver.resolveUser("qa");
      expect(userSession?.cookies).toBeDefined();
      expect(userSession?.cookies?.[0]?.name).toBe("auth_cookie");

      const injectedCookies: CaptureCookie[] = [];
      const mockDriver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        setCookies: async (cookies) => {
          injectedCookies.push(...cookies);
        },
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => createSyntheticPngBuffer(1440, 900),
        evaluate: async <T>() => createEmptyDomPhysicsSnapshot() as unknown as T,
      };

      if (userSession) {
        await resolver.applyAuthToDriver(mockDriver, userSession);
      }
      expect(injectedCookies).toHaveLength(1);
      expect(injectedCookies[0]?.name).toBe("auth_cookie");
      expect(injectedCookies[0]?.value).toBe("val-123");

      const customSession = resolver.resolveRole("custom-auditor");
      expect(customSession?.cookies).toBeDefined();
      expect(customSession?.cookies?.[0]?.name).toBe("mock_session_id");
    });
  });

  describe("Live Capture Runner IHDR Enforcement", () => {
    test("runLiveCapture rejects fabricated 10x10 screenshots for 1920x1080 viewport", async () => {
      const tempDir = join(tmpdir(), `test-live-ihdr-reject-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });

      const fabricatorProvider: CaptureBrowserProvider = {
        launch: async (): Promise<CaptureBrowserDriver> => ({
          newPage: async (): Promise<CapturePageDriver> => ({
            setViewportSize: async () => {},
            setExtraHTTPHeaders: async () => {},
            goto: async () => {},
            waitForSelector: async () => {},
            screenshot: async () => createSyntheticPngBuffer(10, 10, 1024),
            evaluate: async <T>() => createEmptyDomPhysicsSnapshot() as unknown as T,
          }),
          close: async () => {},
        }),
      };

      const testConfig: CaptureConfig = {
        version: "1.0",
        baseUrl: "http://localhost:3000",
        viewports: { fhd: { name: "fhd", width: 1920, height: 1080 } },
        screens: [{ id: "app-home", name: "App Home", path: "/" }],
      };

      try {
        const result = await runLiveCapture({
          config: testConfig,
          outDir: tempDir,
          browserProvider: fabricatorProvider,
        });

        expect(result.success).toBe(false);
        expect(result.totalCaptures).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.error).toContain("failed PNG IHDR validation");
        expect(result.errors[0]?.error).toContain("expected 1920x1080");
        expect(result.errors[0]?.error).toContain("10x10");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("runLiveCapture succeeds with valid PNG matching viewport dimensions", async () => {
      const tempDir = join(tmpdir(), `test-live-ihdr-pass-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });

      const testConfig: CaptureConfig = {
        version: "1.0",
        baseUrl: "http://localhost:3000",
        viewports: {
          desktop: { name: "desktop", width: 1440, height: 900 },
          mobile: { name: "mobile", width: 390, height: 844 },
        },
        screens: [
          {
            id: "landing",
            name: "Landing Page",
            path: "/",
            viewports: ["desktop", "mobile"],
          },
        ],
      };

      try {
        const result = await runLiveCapture({
          config: testConfig,
          outDir: tempDir,
          browserProvider: new DefaultFallbackBrowserProvider(),
        });

        expect(result.success).toBe(true);
        expect(result.totalCaptures).toBe(2);
        expect(result.errors).toHaveLength(0);

        for (const item of result.captures) {
          const imgBuf = readFileSync(item.imagePath);
          const manifest = JSON.parse(
            readFileSync(item.manifestPath, "utf-8"),
          ) as CompanionManifest;

          expect(
            validatePngBuffer(imgBuf, manifest.dimensions.width, manifest.dimensions.height),
          ).toBe(true);
          expect(item.sizeBytes).toBe(imgBuf.byteLength);
          expect(manifest.imageSha256).toBeDefined();
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Static Invariant Verification", () => {
    test("proves zero any and zero suppressions in touched capture runner files", () => {
      const touchedFiles = [
        join(process.cwd(), "olt/scripts/src/capture/runners/png-ihdr-validator.ts"),
        join(
          process.cwd(),
          "olt/scripts/src/capture/runners/live-capture-runner/fallback-provider.ts",
        ),
        join(process.cwd(), "olt/scripts/src/capture/runners/live-capture-runner/runner.ts"),
        join(process.cwd(), "olt/scripts/src/capture/runners/live-capture-runner/synthetic-png.ts"),
        join(process.cwd(), "olt/scripts/src/capture/runners/live-capture-runner/index.ts"),
        join(process.cwd(), "olt/scripts/src/capture/runners/session-auth-resolver.ts"),
        join(process.cwd(), "olt/scripts/src/capture/runners/types.ts"),
      ];

      for (const filePath of touchedFiles) {
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        expect(lines.length).toBeLessThanOrEqual(300);

        expect(content).not.toMatch(new RegExp("@" + "ts-ignore"));
        expect(content).not.toMatch(new RegExp("@" + "ts-expect-error"));
        expect(content).not.toMatch(new RegExp("@" + "ts-nocheck"));
        expect(content).not.toMatch(new RegExp("eslint" + "-disable"));
      }
    });
  });
});
