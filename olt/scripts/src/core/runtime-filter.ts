const runtimeRoots = new Set(["harness.ts", "package.json", "tsconfig.json", "src", "assets"]);
const cacheDirectories = new Set([
  ".bun",
  ".cache",
  ".git",
  "__pycache__",
  "coverage",
  "node_modules",
]);

export function includeRuntimeSourceEntry(
  relativeDirectory: string,
  name: string,
  isDirectory: boolean,
): boolean {
  if (relativeDirectory === "." && !runtimeRoots.has(name)) return false;
  if (isDirectory && cacheDirectories.has(name)) return false;
  return !name.endsWith(".py") && !name.endsWith(".pyc") && name !== ".DS_Store";
}
