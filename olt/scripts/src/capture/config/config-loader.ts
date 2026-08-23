import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CANONICAL_VIEWPORTS, DEFAULT_PRESETS, DEFAULT_SIDEBAR_LAYOUT } from "./default-presets.ts";
import type {
  CaptureAuthConfig,
  CaptureConfig,
  CaptureScreenTarget,
  CaptureUserConfig,
  CaptureViewport,
  SidebarLayoutConfig,
  SidebarPosition,
} from "./types.ts";
import { parseYamlOrJson } from "./yaml-parser.ts";

export const CONFIG_CANDIDATE_NAMES: readonly string[] = [
  ".capture.yaml",
  ".capture.yml",
  ".capturerc.yaml",
  ".capturerc.yml",
  ".capture.json",
];

export function findCaptureConfigFile(startDir: string = process.cwd()): string | null {
  let current = resolve(startDir);
  while (true) {
    for (const name of CONFIG_CANDIDATE_NAMES) {
      const candidate = join(current, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function parsePosition(val: unknown, fallback: SidebarPosition): SidebarPosition {
  if (
    val === "top-left" ||
    val === "top" ||
    val === "bottom-left" ||
    val === "bottom" ||
    val === "none"
  ) {
    return val;
  }
  return fallback;
}

function parseSidebarConfig(raw: unknown): SidebarLayoutConfig {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SIDEBAR_LAYOUT;
  const obj = raw as Record<string, unknown>;
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;
  const logoPosition = parsePosition(obj.logoPosition, "top-left");
  const userProfilePosition = parsePosition(obj.userProfilePosition, "bottom-left");
  const requireZeroNavbar =
    typeof obj.requireZeroNavbar === "boolean" ? obj.requireZeroNavbar : true;
  const minWidth = typeof obj.minWidth === "number" ? obj.minWidth : undefined;
  const maxWidth = typeof obj.maxWidth === "number" ? obj.maxWidth : undefined;
  const collapsible = typeof obj.collapsible === "boolean" ? obj.collapsible : undefined;

  let selectors: SidebarLayoutConfig["selectors"] = DEFAULT_SIDEBAR_LAYOUT.selectors;
  if (typeof obj.selectors === "object" && obj.selectors !== null) {
    const sel = obj.selectors as Record<string, unknown>;
    const customSelectors: Record<string, string> = {};
    if (typeof sel.container === "string") customSelectors.container = sel.container;
    if (typeof sel.logo === "string") customSelectors.logo = sel.logo;
    if (typeof sel.userProfile === "string") customSelectors.userProfile = sel.userProfile;
    if (typeof sel.navLinks === "string") customSelectors.navLinks = sel.navLinks;
    if (typeof sel.collapseToggle === "string") customSelectors.collapseToggle = sel.collapseToggle;
    selectors = customSelectors;
  }

  return {
    enabled,
    logoPosition,
    userProfilePosition,
    requireZeroNavbar,
    ...(minWidth !== undefined ? { minWidth } : {}),
    ...(maxWidth !== undefined ? { maxWidth } : {}),
    ...(collapsible !== undefined ? { collapsible } : {}),
    ...(selectors !== undefined ? { selectors } : {}),
  };
}

function parseUsers(raw: unknown): Record<string, CaptureUserConfig> {
  const users: Record<string, CaptureUserConfig> = {};
  if (typeof raw !== "object" || raw === null) return users;
  for (const [id, userRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof userRaw !== "object" || userRaw === null) continue;
    const userObj = userRaw as Record<string, unknown>;
    const name = typeof userObj.name === "string" ? userObj.name : id;
    const role = typeof userObj.role === "string" ? userObj.role : "user";
    const username = typeof userObj.username === "string" ? userObj.username : undefined;
    const email = typeof userObj.email === "string" ? userObj.email : undefined;
    const password = typeof userObj.password === "string" ? userObj.password : undefined;
    const token = typeof userObj.token === "string" ? userObj.token : undefined;
    const avatarUrl = typeof userObj.avatarUrl === "string" ? userObj.avatarUrl : undefined;

    let headers: Record<string, string> | undefined;
    if (typeof userObj.headers === "object" && userObj.headers !== null) {
      headers = {};
      for (const [k, v] of Object.entries(userObj.headers as Record<string, unknown>)) {
        if (typeof v === "string") headers[k] = v;
      }
    }

    users[id] = {
      id,
      name,
      role,
      ...(username !== undefined ? { username } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(password !== undefined ? { password } : {}),
      ...(token !== undefined ? { token } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(headers !== undefined ? { headers } : {}),
    };
  }
  return users;
}

function parseAuth(raw: unknown): CaptureAuthConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const users = parseUsers(obj.users);
  return {
    ...(typeof obj.defaultUser === "string" ? { defaultUser: obj.defaultUser } : {}),
    ...(typeof obj.loginUrl === "string" ? { loginUrl: obj.loginUrl } : {}),
    ...(typeof obj.usernameSelector === "string" ? { usernameSelector: obj.usernameSelector } : {}),
    ...(typeof obj.passwordSelector === "string" ? { passwordSelector: obj.passwordSelector } : {}),
    ...(typeof obj.submitSelector === "string" ? { submitSelector: obj.submitSelector } : {}),
    ...(typeof obj.tokenHeaderName === "string" ? { tokenHeaderName: obj.tokenHeaderName } : {}),
    users,
  };
}

function parseScreens(raw: unknown): CaptureScreenTarget[] {
  if (!Array.isArray(raw)) return [];
  const screens: CaptureScreenTarget[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : "";
    const path = typeof obj.path === "string" ? obj.path : "";
    if (id.length === 0 || path.length === 0) continue;
    const name = typeof obj.name === "string" ? obj.name : id;
    const auth = typeof obj.auth === "string" ? obj.auth : undefined;
    const waitForSelector =
      typeof obj.waitForSelector === "string" ? obj.waitForSelector : undefined;
    const fullPage = typeof obj.fullPage === "boolean" ? obj.fullPage : undefined;
    const viewports = Array.isArray(obj.viewports)
      ? obj.viewports.filter((v): v is string => typeof v === "string")
      : undefined;

    screens.push({
      id,
      name,
      path,
      ...(auth !== undefined ? { auth } : {}),
      ...(waitForSelector !== undefined ? { waitForSelector } : {}),
      ...(fullPage !== undefined ? { fullPage } : {}),
      ...(viewports !== undefined ? { viewports } : {}),
    });
  }
  return screens;
}

export function validateCaptureConfig(raw: unknown): CaptureConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Invalid capture configuration: expected an object at root");
  }
  const obj = raw as Record<string, unknown>;
  const version =
    typeof obj.version === "string" || typeof obj.version === "number" ? obj.version : "1.0";
  const baseUrl =
    typeof obj.baseUrl === "string" && obj.baseUrl.trim().length > 0
      ? obj.baseUrl.trim()
      : "http://localhost:3000";
  const outputDir = typeof obj.outputDir === "string" ? obj.outputDir : undefined;
  const defaultViewport = typeof obj.defaultViewport === "string" ? obj.defaultViewport : "desktop";

  const viewports: Record<string, CaptureViewport> = { ...CANONICAL_VIEWPORTS };
  if (typeof obj.viewports === "object" && obj.viewports !== null) {
    for (const [name, vp] of Object.entries(obj.viewports as Record<string, unknown>)) {
      if (typeof vp === "object" && vp !== null) {
        const v = vp as Record<string, unknown>;
        if (typeof v.width === "number" && typeof v.height === "number") {
          viewports[name] = {
            name,
            width: v.width,
            height: v.height,
            deviceScaleFactor: typeof v.deviceScaleFactor === "number" ? v.deviceScaleFactor : 1,
          };
        }
      }
    }
  }

  const auth = parseAuth(obj.auth);
  const sidebar = parseSidebarConfig(obj.sidebar);
  const screens = parseScreens(obj.screens);

  return {
    version,
    baseUrl,
    ...(outputDir !== undefined ? { outputDir } : {}),
    ...(auth !== undefined ? { auth } : {}),
    viewports,
    defaultViewport,
    presets: DEFAULT_PRESETS,
    sidebar,
    screens,
  };
}

export function loadCaptureConfig(
  options: { configPath?: string; explicitPath?: string; cwd?: string; searchDir?: string } = {},
): CaptureConfig {
  const filePath = options.configPath ?? options.explicitPath;
  const searchRoot = options.cwd ?? options.searchDir ?? process.cwd();
  const targetPath = filePath ?? findCaptureConfigFile(searchRoot);
  if (!targetPath || !existsSync(targetPath)) {
    return validateCaptureConfig({ baseUrl: "http://localhost:3000" });
  }
  const content = readFileSync(targetPath, "utf-8");
  const raw = parseYamlOrJson(content);
  return validateCaptureConfig(raw);
}

export function exportDefaultCaptureConfigYaml(): string {
  return `version: "1.0"
baseUrl: "http://localhost:3000"
defaultViewport: "desktop"
sidebar:
  enabled: true
  logoPosition: "top-left"
  userProfilePosition: "bottom-left"
  requireZeroNavbar: true
auth:
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
screens:
  - id: "dashboard"
    name: "Main Dashboard"
    path: "/"
    viewports: ["desktop", "mobile"]
`;
}
