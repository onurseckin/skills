import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

export interface DeriveTestSuiteOptions {
  readonly recursive?: boolean;
}

export function deriveTestSuite(
  metaUrl: string,
  options: DeriveTestSuiteOptions = {},
): readonly string[] {
  const dir = fileURLToPath(new URL(".", metaUrl));
  const entries = readdirSync(dir, { recursive: options.recursive ?? false });
  const suites: string[] = [];
  for (const entry of entries) {
    const filename = String(entry);
    if (filename.endsWith(".test.ts")) {
      const base = basename(filename, ".test.ts");
      if (!suites.includes(base)) {
        suites.push(base);
      }
    }
  }
  return suites.sort();
}

export function discoverTests(
  metaUrl: string,
  options?: DeriveTestSuiteOptions,
): readonly string[] {
  return deriveTestSuite(metaUrl, options);
}
