import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import {
  captureSnapshot,
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  purgeLegacySnapshot,
  isCredentialValue,
  StatePreserver,
  ALLOWED_ENV_VARS,
  DEFAULT_SNAPSHOT_PATH,
  LEGACY_SNAPSHOT_PATH,
  CREDENTIAL_PATTERNS,
} from "../../../olt/scripts/src/server/lifecycle/snapshot.ts";
import {
  cleanupVirtualServerFS,
  getVirtualServerFS,
  getVirtualServerSession,
  setupVirtualServerFS,
} from "../fixture.ts";

describe("Dev Server Lifecycle Subsystem - Snapshot Credential Redaction & Isolation", () => {
  const originalEnv = { ...process.env };
  const injectedSecretKeys = [
    "CLAUDE_API_KEY",
    "GEMINI_API_KEY",
    "DEEPSEEK_API_KEY",
    "SOME_SECRET_TOKEN",
    "CUSTOM_PROV_AUTH",
    "CUSTOM_SECRET",
    "AWS_SECRET_ACCESS_KEY",
  ];

  beforeEach(() => {
    setupVirtualServerFS();
    for (const key of injectedSecretKeys) {
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of injectedSecretKeys) {
      delete process.env[key];
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v !== undefined) {
        process.env[k] = v;
      }
    }
    await clearSnapshot();
    cleanupVirtualServerFS();
  });

  it("redacts all secret keys and values when capturing from process.env and inputs", async () => {
    process.env["CLAUDE_API_KEY"] = "sk-ant-api03-abcdef1234567890abcdef1234567890";
    process.env["GEMINI_API_KEY"] = "AIzaSyD-1234567890abcdefghijklmnopqrstuv";
    process.env["DEEPSEEK_API_KEY"] = "sk-deepseek-abcdef0123456789abcdef0123456789";
    process.env["SOME_SECRET_TOKEN"] = "ghp_1234567890abcdefghijklmnopqrstuvwxyz12";
    process.env["CUSTOM_PROV_AUTH"] = "custom-auth-token-secret-99999";
    process.env["CUSTOM_SECRET"] = "super-confidential-credential";
    process.env["AWS_SECRET_ACCESS_KEY"] = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    process.env["NODE_ENV"] = "production";
    process.env["CI"] = "true";

    const snapshot = captureSnapshot();
    await saveSnapshot(snapshot);

    const vfs = getVirtualServerFS();
    const canonicalPath = resolve(DEFAULT_SNAPSHOT_PATH);
    const fileContent = vfs.readFileSync(canonicalPath, "utf-8");

    for (const key of injectedSecretKeys) {
      expect(fileContent.includes(key)).toBe(false);
      expect(key in snapshot.envVariables).toBe(false);
    }
    expect(fileContent.includes("sk-ant-api03")).toBe(false);
    expect(fileContent.includes("AIzaSyD")).toBe(false);
    expect(fileContent.includes("sk-deepseek")).toBe(false);
    expect(fileContent.includes("ghp_")).toBe(false);
    expect(fileContent.includes("custom-auth-token")).toBe(false);
    expect(fileContent.includes("super-confidential")).toBe(false);
    expect(fileContent.includes("EXAMPLEKEY")).toBe(false);

    expect(snapshot.envVariables["NODE_ENV"]).toBe("production");
    expect(snapshot.envVariables["CI"]).toBe("true");
    expect(fileContent.includes("NODE_ENV")).toBe(true);
    expect(fileContent.includes("production")).toBe(true);

    const explicitSnapshot = captureSnapshot({
      envVariables: {
        CLAUDE_API_KEY: "sk-ant-explicit",
        GEMINI_API_KEY: "AIza-explicit",
        NODE_ENV: "production",
        CI: "true",
      },
    });
    expect(explicitSnapshot.envVariables["CLAUDE_API_KEY"]).toBeUndefined();
    expect(explicitSnapshot.envVariables["GEMINI_API_KEY"]).toBeUndefined();
    expect(explicitSnapshot.envVariables["NODE_ENV"]).toBe("production");
    expect(explicitSnapshot.envVariables["CI"]).toBe("true");
  });

  it("resolves strictly under .olt/locks/server-state.json and never in root .locks/", async () => {
    const vfs = getVirtualServerFS();
    const snapshot = captureSnapshot({ currentPid: 5555 });
    await saveSnapshot(snapshot);

    const canonicalPath = resolve(DEFAULT_SNAPSHOT_PATH);
    const legacyPath = resolve(LEGACY_SNAPSHOT_PATH);
    const legacyDir = resolve(".locks");

    expect(DEFAULT_SNAPSHOT_PATH).toBe(".olt/locks/server-state.json");
    expect(canonicalPath.endsWith("/.olt/locks/server-state.json")).toBe(true);
    expect(vfs.existsSync(canonicalPath)).toBe(true);
    expect(vfs.existsSync(legacyPath)).toBe(false);
    expect(vfs.existsSync(legacyDir)).toBe(false);
  });

  it("enforces mode 0o600 on snapshot file and 0o700 on parent directory", async () => {
    const session = getVirtualServerSession()!;
    const snapshot = captureSnapshot({ currentPid: 6666 });
    await saveSnapshot(snapshot);

    const canonicalPath = resolve(DEFAULT_SNAPSHOT_PATH);
    const fileStat = session.statSync(canonicalPath);
    expect(fileStat).toBeDefined();
    expect(fileStat.mode & 0o777).toBe(0o600);

    const dirStat = session.statSync(resolve(".olt/locks"));
    expect(dirStat).toBeDefined();
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it("purges legacy .locks/server-state.json and cleans up directory on write or load", async () => {
    const vfs = getVirtualServerFS();
    const legacyPath = resolve(LEGACY_SNAPSHOT_PATH);
    const legacyDir = resolve(".locks");
    vfs.mkdirSync(legacyDir, { recursive: true });
    vfs.writeFileSync(legacyPath, JSON.stringify({ leakedSecret: "CLAUDE_API_KEY_LEAK" }));

    expect(vfs.existsSync(legacyPath)).toBe(true);

    const snapshot = captureSnapshot({ currentPid: 7777 });
    await saveSnapshot(snapshot);

    expect(vfs.existsSync(legacyPath)).toBe(false);
    expect(vfs.existsSync(resolve(DEFAULT_SNAPSHOT_PATH))).toBe(true);

    vfs.mkdirSync(legacyDir, { recursive: true });
    vfs.writeFileSync(legacyPath, JSON.stringify({ stale: true }));
    expect(vfs.existsSync(legacyPath)).toBe(true);

    await loadSnapshot();
    expect(vfs.existsSync(legacyPath)).toBe(false);

    vfs.mkdirSync(legacyDir, { recursive: true });
    vfs.writeFileSync(legacyPath, JSON.stringify({ stale: true }));
    expect(vfs.existsSync(legacyPath)).toBe(true);

    purgeLegacySnapshot();
    expect(vfs.existsSync(legacyPath)).toBe(false);
  });

  it("enforces strict minimal allowlist excluding PATH, USER, and HOME", () => {
    expect(ALLOWED_ENV_VARS.has("NODE_ENV")).toBe(true);
    expect(ALLOWED_ENV_VARS.has("SHELL")).toBe(true);
    expect(ALLOWED_ENV_VARS.has("TERM")).toBe(true);
    expect(ALLOWED_ENV_VARS.has("LANG")).toBe(true);
    expect(ALLOWED_ENV_VARS.has("CI")).toBe(true);

    expect(ALLOWED_ENV_VARS.has("PATH")).toBe(false);
    expect(ALLOWED_ENV_VARS.has("USER")).toBe(false);
    expect(ALLOWED_ENV_VARS.has("HOME")).toBe(false);
    expect(ALLOWED_ENV_VARS.has("TMPDIR")).toBe(false);
    expect(ALLOWED_ENV_VARS.size).toBe(5);
  });

  it("rejects values matching credential shapes even under allowed variable names", async () => {
    const dangerousEnv = {
      NODE_ENV: "production",
      CI: "sk-ant-api03-abcdef1234567890abcdef1234567890",
      TERM: "ghp_1234567890abcdefghijklmnopqrstuvwxyz12",
      LANG: "AIzaSyD-1234567890abcdefghijklmnopqrstuv",
      SHELL: "0123456789abcdef0123456789abcdef",
    };

    const snapshot = captureSnapshot({
      envVariables: dangerousEnv,
      metadata: {
        safeMeta: "ok",
        leakedMeta: "sk-live-0123456789abcdef0123456789",
      },
    });

    const vfs = getVirtualServerFS();
    await saveSnapshot(snapshot);
    const content = vfs.readFileSync(resolve(DEFAULT_SNAPSHOT_PATH), "utf-8");

    expect(snapshot.envVariables["NODE_ENV"]).toBe("production");
    expect(snapshot.envVariables["CI"]).toBeUndefined();
    expect(snapshot.envVariables["TERM"]).toBeUndefined();
    expect(snapshot.envVariables["LANG"]).toBeUndefined();
    expect(snapshot.envVariables["SHELL"]).toBeUndefined();
    expect(snapshot.metadata?.["safeMeta"]).toBe("ok");
    expect(snapshot.metadata?.["leakedMeta"]).toBeUndefined();

    for (const pattern of CREDENTIAL_PATTERNS) {
      expect(pattern.test(content)).toBe(false);
    }
  });

  it("verifies isCredentialValue identifies various credential patterns correctly", () => {
    expect(isCredentialValue("sk-ant-api03-1234567890abcdef123456")).toBe(true);
    expect(isCredentialValue("ghp_1234567890abcdefghijklmnopqrstuvwxyz12")).toBe(true);
    expect(isCredentialValue("AIzaSyD-1234567890abcdefghijklmnopqrstuv")).toBe(true);
    expect(isCredentialValue("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab34")).toBe(true);
    expect(isCredentialValue("dGhpcy1pcy1hLXNhbXBsZS1iYXNlNjQtdG9rZW4tdmFsdWU=")).toBe(true);

    expect(isCredentialValue("production")).toBe(false);
    expect(isCredentialValue("development")).toBe(false);
    expect(isCredentialValue("xterm-256color")).toBe(false);
    expect(isCredentialValue("/bin/zsh")).toBe(false);
    expect(isCredentialValue("en_US.UTF-8")).toBe(false);
    expect(isCredentialValue("true")).toBe(false);
  });

  it("operates correctly via StatePreserver class with canonical path and legacy purge", async () => {
    const vfs = getVirtualServerFS();
    const legacyPath = resolve(LEGACY_SNAPSHOT_PATH);
    vfs.mkdirSync(resolve(".locks"), { recursive: true });
    vfs.writeFileSync(legacyPath, "legacy");

    const preserver = new StatePreserver();
    expect(vfs.existsSync(legacyPath)).toBe(false);

    process.env["CLAUDE_API_KEY"] = "sk-ant-secret";
    process.env["NODE_ENV"] = "test";
    const snap = preserver.capture();
    expect(snap.envVariables["CLAUDE_API_KEY"]).toBeUndefined();
    expect(snap.envVariables["NODE_ENV"]).toBe("test");

    await preserver.save(snap);
    expect(vfs.existsSync(resolve(DEFAULT_SNAPSHOT_PATH))).toBe(true);

    const loaded = await preserver.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.envVariables["CLAUDE_API_KEY"]).toBeUndefined();

    const cleared = await preserver.clear();
    expect(cleared).toBe(true);
    expect(vfs.existsSync(resolve(DEFAULT_SNAPSHOT_PATH))).toBe(false);
  });
});
