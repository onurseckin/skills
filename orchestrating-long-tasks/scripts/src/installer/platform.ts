import { HarnessError } from "../errors/harness-error.ts";

export function assertInstallerPlatform(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "darwin" && platform !== "linux") {
    throw new HarnessError("UNSUPPORTED_PLATFORM", `installer is unsupported on ${platform}`);
  }
}
