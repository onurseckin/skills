import { writeFileSync } from "node:fs";
import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CaptureCookie,
  CapturePageDriver,
  DomPhysicsSnapshot,
} from "../types.ts";
import { createSyntheticPngBuffer } from "./synthetic-png.ts";

export class DefaultFallbackBrowserProvider implements CaptureBrowserProvider {
  public async launch(_options?: { headless?: boolean }): Promise<CaptureBrowserDriver> {
    return {
      newPage: async (): Promise<CapturePageDriver> => {
        let currentViewport = { width: 1440, height: 900 };
        const storedCookies: CaptureCookie[] = [];
        return {
          setViewportSize: async (size) => {
            currentViewport = { width: size.width, height: size.height };
          },
          setExtraHTTPHeaders: async () => {},
          setCookies: async (cookies) => {
            storedCookies.push(...cookies);
          },
          setCookie: async (cookie) => {
            storedCookies.push(cookie);
          },
          goto: async () => {},
          waitForSelector: async () => {},
          screenshot: async (opts) => {
            const buf = createSyntheticPngBuffer(
              currentViewport.width,
              currentViewport.height,
              1024,
            );
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
