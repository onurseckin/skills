import { describe, expect, test, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmodSync,
  fstatSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  generateDefaultRepoPolicy,
  initRepoPolicy,
  inspectRepoPolicy,
  loadRepoPolicy,
  parseRepoPolicy,
  saveRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";

describe("Repo Policy Authority, Safety & Concurrency", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "test-repo-policy-authority");

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

  test("authority loading rejects escaped, linked, and hard-linked custom policy targets", () => {
    const dir = join(scratchBase, "authority-paths");
    const outside = join(scratchBase, "outside-policy.json");
    const policy = generateDefaultRepoPolicy(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(outside, JSON.stringify(policy), "utf-8");

    expect(() => loadRepoPolicy(dir, outside)).toThrow(/PATH_SAFETY|outside/i);

    const linked = join(dir, "linked.json");
    symlinkSync(outside, linked);
    expect(() => loadRepoPolicy(dir, linked)).toThrow(/PATH_SAFETY|regular/i);

    const hardLinked = join(dir, "hard-linked.json");
    linkSync(outside, hardLinked);
    expect(() => loadRepoPolicy(dir, hardLinked)).toThrow(/INTEGRITY|hard link/i);

    const linkedParent = join(dir, "linked-parent");
    symlinkSync(scratchBase, linkedParent);
    expect(() => loadRepoPolicy(dir, join(linkedParent, "outside-policy.json"))).toThrow(
      /PATH_SAFETY|real directory/i,
    );
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { force: true });
  });

  test("authority loading rejects group-writable files and replacements between lstat, open, and read", () => {
    const dir = join(scratchBase, "authority-race-and-mode");
    const policyPath = join(dir, ".olt", "policy.json");
    const original = generateDefaultRepoPolicy(dir);
    const replacement = {
      ...original,
      forbidden_commands: [...(original.forbidden_commands ?? []), "curl"],
    };
    saveRepoPolicy(original, dir);

    chmodSync(policyPath, 0o666);
    expect(() => loadRepoPolicy(dir)).toThrow(/group- or world-writable/i);
    chmodSync(policyPath, 0o600);
    expect(() =>
      loadRepoPolicy(dir, undefined, {
        fstat: ((descriptor: number) => {
          const metadata = fstatSync(descriptor);
          return new Proxy(metadata, {
            get(target, key, receiver) {
              if (key === "uid") return metadata.uid + 1;
              return Reflect.get(target, key, receiver);
            },
          });
        }) as typeof fstatSync,
      }),

    ).toThrow(/owned by the current user/i);

    const beforeOpen = join(dir, "before-open.json");
    saveRepoPolicy(replacement, dir, beforeOpen);
    expect(() =>
      loadRepoPolicy(dir, policyPath, {
        afterLstatBeforeOpen: () => renameSync(beforeOpen, policyPath),
      }),
    ).toThrow(/changed while opening/i);
    expect(readFileSync(policyPath, "utf-8")).toContain("curl");

    const afterOpen = join(dir, "after-open.json");
    saveRepoPolicy(original, dir, afterOpen);
    expect(() =>
      loadRepoPolicy(dir, policyPath, {
        afterOpenBeforeRead: () => renameSync(afterOpen, policyPath),
      }),
    ).toThrow(/changed while opening/i);
    expect(readFileSync(policyPath, "utf-8")).not.toContain("curl");
    rmSync(dir, { recursive: true, force: true });
  });

  test("saves, loads and initializes repo policy while distinguishing missing and invalid policy", () => {
    const dir = join(scratchBase, "save-load-init");
    const policyPath = join(dir, "nested", "policy.json");

    const fallbackPolicy = loadRepoPolicy(dir, policyPath);
    expect(fallbackPolicy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);

    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(policyPath, "{ invalid json", "utf-8");
    expect(() => loadRepoPolicy(dir, policyPath)).toThrow(/Repository policy.*invalid/i);
    try {
      loadRepoPolicy(dir, policyPath);
      throw new Error("expected invalid policy to throw");
    } catch (error) {
      expect(error).toHaveProperty("code", "INTEGRITY");
      expect(error).toHaveProperty("message");
      expect(String((error as Error).message)).toContain(policyPath);
    }

    writeFileSync(policyPath, "true", "utf-8");
    expect(() => loadRepoPolicy(dir, policyPath)).toThrow(/must be an object/i);

    const policy = generateDefaultRepoPolicy(process.cwd());
    const savedPath = saveRepoPolicy(policy, dir, policyPath);
    expect(savedPath).toBe(policyPath);

    const loaded = loadRepoPolicy(dir, policyPath);
    expect(loaded.ecosystem).toBe(policy.ecosystem);
    expect(loaded.test_runner.default_command).toBe(policy.test_runner.default_command);

    const initDir = join(scratchBase, "init-policy-dir");
    const initialized = initRepoPolicy(initDir);
    expect(initialized.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);

    rmSync(dir, { recursive: true, force: true });
    rmSync(initDir, { recursive: true, force: true });
  });

  test("atomic policy saves preserve prior bytes on write, fsync, and rename failures and report uncertainty after rename", () => {
    const dir = join(scratchBase, "durable-policy-save");
    const policyPath = join(dir, ".olt", "policy.json");
    const original = generateDefaultRepoPolicy(dir);
    const replacement = {
      ...original,
      forbidden_commands: [...(original.forbidden_commands ?? []), "curl"],
    };
    saveRepoPolicy(original, dir);
    const originalBytes = readFileSync(policyPath, "utf-8");

    expect(() =>
      saveRepoPolicy(replacement, dir, undefined, {
        write: () => 0,
      }),
    ).toThrow(/write made no progress/i);
    expect(readFileSync(policyPath, "utf-8")).toBe(originalBytes);

    expect(() =>
      saveRepoPolicy(replacement, dir, undefined, {
        fsync: () => {
          throw new Error("injected pre-rename fsync failure");
        },
      }),
    ).toThrow(/pre-rename fsync failure/i);
    expect(readFileSync(policyPath, "utf-8")).toBe(originalBytes);

    expect(() =>
      saveRepoPolicy(replacement, dir, undefined, {
        rename: () => {
          throw new Error("injected pre-rename failure");
        },
      }),
    ).toThrow(/pre-rename failure/i);
    expect(readFileSync(policyPath, "utf-8")).toBe(originalBytes);

    expect(() =>
      saveRepoPolicy(replacement, dir, undefined, {
        fsyncDirectory: () => {
          throw new Error("injected post-rename fsync failure");
        },
      }),
    ).toThrow(/outcome is uncertain after rename/i);
    expect(loadRepoPolicy(dir).forbidden_commands).toContain("curl");
    rmSync(dir, { recursive: true, force: true });
  });

  test("two real processes serialize policy saves and expose only complete valid JSON", async () => {
    const dir = join(scratchBase, "concurrent-policy-saves");
    const policyPath = join(dir, ".olt", "policy.json");
    const childScript = join(scratchBase, "save-policy-child.ts");
    const policyModule = join(process.cwd(), "olt", "scripts", "src", "policy", "repo-policy.ts");
    mkdirSync(scratchBase, { recursive: true });
    writeFileSync(
      childScript,
      `import { generateDefaultRepoPolicy, saveRepoPolicy } from ${JSON.stringify(policyModule)};
const [root, marker] = process.argv.slice(2);
for (let index = 0; index < 5; index++) {
  const policy = generateDefaultRepoPolicy(root);
  saveRepoPolicy({ ...policy, forbidden_commands: [...(policy.forbidden_commands ?? []), marker] }, root);
}
`,
      "utf-8",
    );
    saveRepoPolicy(generateDefaultRepoPolicy(dir), dir);
    const child = (marker: string) => spawn(process.execPath, [childScript, dir, marker]);
    const waitForExit = (proc: ReturnType<typeof child>) =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        proc.once("error", rejectPromise);
        proc.once("exit", (code) => {
          if (code === 0) resolvePromise();
          else rejectPromise(new Error(`child process exited ${code}`));
        });
      });
    const first = child("curl-a");
    const second = child("curl-b");
    const completion = Promise.all([waitForExit(first), waitForExit(second)]);
    const observed: string[] = [];
    for (let index = 0; index < 150; index++) {
      const bytes = readFileSync(policyPath, "utf-8");
      observed.push(bytes);
      expect(() => parseRepoPolicy(JSON.parse(bytes) as unknown)).not.toThrow();
      await Bun.sleep(1);
    }
    await completion;
    const finalBytes = readFileSync(policyPath, "utf-8");
    expect(() => parseRepoPolicy(JSON.parse(finalBytes) as unknown)).not.toThrow();
    expect(observed.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
    rmSync(childScript, { force: true });
  }, 15_000);

  test("fails closed when an existing canonical policy path is unreadable", () => {
    const dir = join(scratchBase, "unreadable-policy");
    const policyPath = join(dir, ".olt", "policy.json");
    mkdirSync(policyPath, { recursive: true });

    expect(() => loadRepoPolicy(dir)).toThrow(/Repository policy.*invalid/i);
    try {
      loadRepoPolicy(dir);
      throw new Error("expected unreadable policy to throw");
    } catch (error) {
      expect(error).toHaveProperty("code", "INTEGRITY");
      expect(String((error as Error).message)).toContain(policyPath);
      expect(String((error as Error).message)).toMatch(/regular|directory|EISDIR/i);
    }

    rmSync(dir, { recursive: true, force: true });
  });

  test("inspectRepoPolicy accurately reports auto_detected, valid_custom, and invalid_custom status (Matrix row 13)", () => {
    const dir = join(scratchBase, "inspect-policy-test");
    const customPolicyPath = join(dir, ".olt", "policy.json");

    const autoDetected = inspectRepoPolicy(dir, customPolicyPath);
    expect(autoDetected.status).toBe("auto_detected");
    expect(autoDetected.policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(autoDetected.error).toBeUndefined();

    mkdirSync(join(dir, ".olt"), { recursive: true });
    const samplePolicy = generateDefaultRepoPolicy(dir);
    writeFileSync(customPolicyPath, JSON.stringify(samplePolicy, null, 2), "utf-8");
    const validCustom = inspectRepoPolicy(dir, customPolicyPath);
    expect(validCustom.status).toBe("valid_custom");
    expect(validCustom.policy.ecosystem).toBe(samplePolicy.ecosystem);
    expect(validCustom.filePath).toBe(customPolicyPath);
    expect(validCustom.error).toBeUndefined();

    writeFileSync(customPolicyPath, "{ malformed json: true", "utf-8");
    const invalidCustom = inspectRepoPolicy(dir, customPolicyPath);
    expect(invalidCustom.status).toBe("invalid_custom");
    expect(invalidCustom.policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(invalidCustom.filePath).toBe(customPolicyPath);
    expect(invalidCustom.error).toBeDefined();

    rmSync(dir, { recursive: true, force: true });
  });
});
