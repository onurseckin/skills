import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import { DEFAULT_PRESETS, DEFAULT_SIDEBAR_LAYOUT } from "../../capture/config/default-presets.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export function generateInitialConfigYaml(presetName = "standard-dashboard"): string {
  const preset = DEFAULT_PRESETS[presetName] ?? DEFAULT_PRESETS["standard-dashboard"]!;
  const sidebar = preset.sidebar ?? DEFAULT_SIDEBAR_LAYOUT;
  return `# Universal UI Capture & Validation Configuration
version: "1.0"
baseUrl: "http://localhost:3000"

viewports:
  desktop:
    name: "desktop"
    width: 1440
    height: 900
  desktop-wide:
    name: "desktop-wide"
    width: 1920
    height: 1080
  tablet:
    name: "tablet"
    width: 768
    height: 1024
  mobile:
    name: "mobile"
    width: 375
    height: 667

sidebar:
  enabled: ${sidebar.enabled}
  requireZeroNavbar: ${sidebar.requireZeroNavbar}
  logoPosition: "${sidebar.logoPosition}"
  userProfilePosition: "${sidebar.userProfilePosition}"

auth:
  defaultUser: "admin"
  loginUrl: "/login"
  usernameSelector: 'input[name="email"], input[type="email"]'
  passwordSelector: 'input[name="password"], input[type="password"]'
  submitSelector: 'button[type="submit"]'
  tokenHeaderName: "Authorization"
  users:
    admin:
      id: "admin"
      name: "Admin User"
      email: "admin@example.test"
      username: "admin"
      password: "Password123!"
      role: "admin"
      token: "mock-admin-token"
    user:
      id: "user"
      name: "Standard User"
      email: "user@example.test"
      username: "user"
      password: "Password123!"
      role: "user"
      token: "mock-user-token"

screens:
  - id: "dashboard"
    name: "Main Dashboard"
    path: "/"
    viewports:
      - "desktop"
      - "tablet"
      - "mobile"
  - id: "settings"
    name: "Settings Page"
    path: "/settings"
    auth: "admin"
    viewports:
      - "desktop"
      - "mobile"
`;
}

export function generateInitialConfigJson(presetName = "standard-dashboard"): string {
  const preset = DEFAULT_PRESETS[presetName] ?? DEFAULT_PRESETS["standard-dashboard"]!;
  const sidebar = preset.sidebar ?? DEFAULT_SIDEBAR_LAYOUT;
  const config = {
    version: "1.0",
    baseUrl: "http://localhost:3000",
    viewports: {
      desktop: { name: "desktop", width: 1440, height: 900 },
      "desktop-wide": { name: "desktop-wide", width: 1920, height: 1080 },
      tablet: { name: "tablet", width: 768, height: 1024 },
      mobile: { name: "mobile", width: 375, height: 667 },
    },
    sidebar: {
      enabled: sidebar.enabled,
      requireZeroNavbar: sidebar.requireZeroNavbar,
      logoPosition: sidebar.logoPosition,
      userProfilePosition: sidebar.userProfilePosition,
    },
    auth: {
      defaultUser: "admin",
      loginUrl: "/login",
      usernameSelector: 'input[name="email"], input[type="email"]',
      passwordSelector: 'input[name="password"], input[type="password"]',
      submitSelector: 'button[type="submit"]',
      tokenHeaderName: "Authorization",
      users: {
        admin: {
          id: "admin",
          name: "Admin User",
          email: "admin@example.test",
          username: "admin",
          password: "Password123!",
          role: "admin",
          token: "mock-admin-token",
        },
        user: {
          id: "user",
          name: "Standard User",
          email: "user@example.test",
          username: "user",
          password: "Password123!",
          role: "user",
          token: "mock-user-token",
        },
      },
    },
    screens: [
      { id: "dashboard", name: "Main Dashboard", path: "/", viewports: ["desktop", "tablet", "mobile"] },
      { id: "settings", name: "Settings Page", path: "/settings", auth: "admin", viewports: ["desktop", "mobile"] },
    ],
  };
  return JSON.stringify(config, null, 2);
}

export async function captureInitCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const explicitConfigDir = textFlag(flags, "config-dir", false);
  const configDir = explicitConfigDir && explicitConfigDir.length > 0 ? explicitConfigDir : process.cwd();
  const explicitFormat = textFlag(flags, "format", false);
  const format = explicitFormat === "json" ? "json" : "yaml";
  const explicitPreset = textFlag(flags, "preset", false);
  const preset = explicitPreset && explicitPreset.length > 0 ? explicitPreset : "standard-dashboard";
  const force = Boolean(flags.force);

  const resolvedDir = resolve(configDir);
  mkdirSync(resolvedDir, { recursive: true });

  const filename = format === "json" ? ".capture.json" : ".capture.yaml";
  const targetPath = join(resolvedDir, filename);

  if (existsSync(targetPath) && !force) {
    throw new HarnessError(
      "INVALID_STATE",
      `Configuration file already exists at ${targetPath}. Use --force to overwrite.`,
    );
  }

  const content = format === "json" ? generateInitialConfigJson(preset) : generateInitialConfigYaml(preset);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf-8");

  const markdown = [
    `### Capture Configuration Initialized`,
    `- **File**: \`${targetPath}\``,
    `- **Format**: \`${format}\``,
    `- **Preset**: \`${preset}\``,
    `- **Screens Configured**: \`dashboard\`, \`settings\``,
  ].join("\n");

  return {
    markdown,
    target_path: targetPath,
    format,
    preset,
    status: "initialized",
  };
}
