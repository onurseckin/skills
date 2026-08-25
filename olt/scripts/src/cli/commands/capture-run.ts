import { HarnessError } from "../../core/errors/harness-error.ts";
import type { CommandContext, Flags } from "../options.ts";

export const CAPTURE_RUN_MISSING_PROVIDER_MESSAGE =
  "capture:run cannot execute: no real browser automation driver is wired into this build. " +
  "runLiveCapture() requires a CaptureBrowserProvider (see capture/runners/types.ts) that drives an actual browser, " +
  "and this CLI command has none to give it - there is no Playwright/Puppeteer integration in this repository, " +
  "and a CaptureBrowserProvider is a live JS object (launch/newPage/screenshot/evaluate) that cannot be expressed as a CLI flag.";

export const CAPTURE_RUN_MISSING_PROVIDER_FIX =
  "Implement a CaptureBrowserProvider backed by a real browser automation library (e.g. Playwright) and pass it " +
  "programmatically as `browserProvider` to runLiveCapture(); do not fall back to DefaultFallbackBrowserProvider in " +
  "production, since it only exists as a test fixture that fabricates placeholder screenshots.";

export async function captureRunCommand(
  _flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  throw new HarnessError(
    "NOT_IMPLEMENTED",
    CAPTURE_RUN_MISSING_PROVIDER_MESSAGE,
    [],
    undefined,
    CAPTURE_RUN_MISSING_PROVIDER_FIX,
  );
}
