export const UI_EXTENSIONS: ReadonlySet<string> = new Set([
  ".tsx",
  ".jsx",
  ".vue",
  ".svelte",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".svg",
]);

export const UI_DIR_PATTERNS: readonly RegExp[] = [
  /(?:^|[\\/])(components|views|pages|styles|ui|frontend|client|renderer|canvas|layout)(?:[\\/]|$)/i,
];

export function isUiScope(paths: readonly string[]): boolean {
  if (!paths || paths.length === 0) return false;
  for (const p of paths) {
    const lower = p.toLowerCase();
    const dotIdx = lower.lastIndexOf(".");
    if (dotIdx !== -1) {
      const ext = lower.slice(dotIdx);
      if (UI_EXTENSIONS.has(ext)) return true;
    }
    for (const pattern of UI_DIR_PATTERNS) {
      if (pattern.test(lower)) return true;
    }
  }
  return false;
}
