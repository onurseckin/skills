import type { DagExporterTheme } from "./types.ts";

export const DARK_THEME: DagExporterTheme = {
  background: "#0d1117",
  textPrimary: "#c9d1d9",
  textSecondary: "#8b949e",
  border: "#30363d",
  edgeColor: "#58a6ff",
  edgeHighlight: "#f0883e",
  nodeFill: "#161b22",
  statusColors: {
    ready: { fill: "#1f6feb22", stroke: "#58a6ff", text: "#58a6ff" },
    running: { fill: "#d2992222", stroke: "#d29922", text: "#e3b341" },
    leased: { fill: "#d2992222", stroke: "#d29922", text: "#e3b341" },
    validating: { fill: "#a371f722", stroke: "#bc8cff", text: "#d2a8ff" },
    completed: { fill: "#23863622", stroke: "#3fb950", text: "#56d364" },
    failed: { fill: "#da363322", stroke: "#f85149", text: "#ff7b72" },
    blocked: { fill: "#8b949e22", stroke: "#8b949e", text: "#8b949e" },
    proposed: { fill: "#8b949e15", stroke: "#6e7681", text: "#8b949e" },
  },
  fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
  fontSize: 12,
};

export const LIGHT_THEME: DagExporterTheme = {
  background: "#ffffff",
  textPrimary: "#24292f",
  textSecondary: "#57606a",
  border: "#d0d7de",
  edgeColor: "#0969da",
  edgeHighlight: "#bf8700",
  nodeFill: "#f6f8fa",
  statusColors: {
    ready: { fill: "#ddf4ff", stroke: "#0969da", text: "#0969da" },
    running: { fill: "#fff8c5", stroke: "#9a6700", text: "#9a6700" },
    leased: { fill: "#fff8c5", stroke: "#9a6700", text: "#9a6700" },
    validating: { fill: "#fbefff", stroke: "#8250df", text: "#8250df" },
    completed: { fill: "#dafbe1", stroke: "#1a7f37", text: "#1a7f37" },
    failed: { fill: "#ffebe9", stroke: "#cf222e", text: "#cf222e" },
    blocked: { fill: "#f6f8fa", stroke: "#8c959f", text: "#57606a" },
    proposed: { fill: "#f6f8fa", stroke: "#afb8c1", text: "#6e7781" },
  },
  fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
  fontSize: 12,
};

export const HIGH_CONTRAST_THEME: DagExporterTheme = {
  background: "#000000",
  textPrimary: "#ffffff",
  textSecondary: "#e6edf3",
  border: "#ffffff",
  edgeColor: "#79c0ff",
  edgeHighlight: "#ffa657",
  nodeFill: "#0a0c10",
  statusColors: {
    ready: { fill: "#003d73", stroke: "#79c0ff", text: "#ffffff" },
    running: { fill: "#633c01", stroke: "#f2cc60", text: "#ffffff" },
    leased: { fill: "#633c01", stroke: "#f2cc60", text: "#ffffff" },
    validating: { fill: "#4c2889", stroke: "#d2a8ff", text: "#ffffff" },
    completed: { fill: "#0d532d", stroke: "#7ee787", text: "#ffffff" },
    failed: { fill: "#7d1a1a", stroke: "#ff7b72", text: "#ffffff" },
    blocked: { fill: "#30363d", stroke: "#c9d1d9", text: "#ffffff" },
    proposed: { fill: "#21262d", stroke: "#8b949e", text: "#ffffff" },
  },
  fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
  fontSize: 12,
};

export function resolveExporterTheme(
  theme?: "dark" | "light" | "high-contrast" | DagExporterTheme | undefined,
  customTheme?: Partial<DagExporterTheme> | undefined,
): DagExporterTheme {
  let base = DARK_THEME;
  if (theme === "light") {
    base = LIGHT_THEME;
  } else if (theme === "high-contrast") {
    base = HIGH_CONTRAST_THEME;
  } else if (typeof theme === "object" && theme !== null) {
    base = theme;
  }

  if (!customTheme) {
    return base;
  }

  return {
    background: customTheme.background ?? base.background,
    textPrimary: customTheme.textPrimary ?? base.textPrimary,
    textSecondary: customTheme.textSecondary ?? base.textSecondary,
    border: customTheme.border ?? base.border,
    edgeColor: customTheme.edgeColor ?? base.edgeColor,
    edgeHighlight: customTheme.edgeHighlight ?? base.edgeHighlight,
    nodeFill: customTheme.nodeFill ?? base.nodeFill,
    statusColors: {
      ...base.statusColors,
      ...(customTheme.statusColors ?? {}),
    },
    fontFamily: customTheme.fontFamily ?? base.fontFamily,
    fontSize: customTheme.fontSize ?? base.fontSize,
  };
}

export function getStatusStyle(
  status: string,
  theme: DagExporterTheme,
): { readonly fill: string; readonly stroke: string; readonly text: string } {
  const norm = status.toLowerCase();
  const found = theme.statusColors[norm];
  if (found) {
    return found;
  }
  return {
    fill: theme.nodeFill,
    stroke: theme.border,
    text: theme.textPrimary,
  };
}
