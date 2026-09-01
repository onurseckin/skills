import { describe, expect, test, afterAll } from "bun:test";
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
  readVerifiedFile,
  resolvePolicyLocation,
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
    mkdirSync(dir, { recursive: true });
    writeFileSync(outside, JSON.stringify(generateDefaultRepoPolicy(dir)), "utf-8");

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

  test("authority loading rejects group-writable files and replacements during open", () => {
    const dir = join(scratchBase, "authority-race-and-mode");
    const policyPath = join(dir, ".olt", "policy.json");
    saveRepoPolicy(generateDefaultRepoPolicy(dir), dir);

    chmodSync(policyPath, 0o666);
    expect(() => loadRepoPolicy(dir)).toThrow(/group- or world-writable/i);
    chmodSync(policyPath, 0o600);
    const badUidProxy = ((fd: number) => {
      const m = fstatSync(fd);
      return new Proxy(m, { get: (t, k, r) => (k === "uid" ? m.uid + 1 : Reflect.get(t, k, r)) });
    }) as typeof fstatSync;
    expect(() => loadRepoPolicy(dir, undefined, { fstat: badUidProxy })).toThrow(
      /owned by the current user/i,
    );

    const beforeOpen = join(dir, "before-open.json");
    saveRepoPolicy(generateDefaultRepoPolicy(dir), dir, beforeOpen);
    expect(() =>
      loadRepoPolicy(dir, policyPath, {
        afterLstatBeforeOpen: () => renameSync(beforeOpen, policyPath),
      }),
    ).toThrow(/changed while opening/i);

    const afterOpen = join(dir, "after-open.json");
    saveRepoPolicy(generateDefaultRepoPolicy(dir), dir, afterOpen);
    expect(() =>
      loadRepoPolicy(dir, policyPath, {
        afterOpenBeforeRead: () => renameSync(afterOpen, policyPath),
      }),
    ).toThrow(/changed while opening/i);
    rmSync(dir, { recursive: true, force: true });
  });

  test("saves, loads and initializes repo policy while distinguishing missing and invalid policy", () => {
    const dir = join(scratchBase, "save-load-init");
    const policyPath = join(dir, "nested", "policy.json");
    expect(loadRepoPolicy(dir, policyPath).schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);

    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(policyPath, "{ invalid json", "utf-8");
    expect(() => loadRepoPolicy(dir, policyPath)).toThrow(/Repository policy.*invalid/i);

    writeFileSync(policyPath, "true", "utf-8");
    expect(() => loadRepoPolicy(dir, policyPath)).toThrow(/must be an object/i);

    const policy = generateDefaultRepoPolicy(process.cwd());
    expect(saveRepoPolicy(policy, dir, policyPath)).toBe(policyPath);
    expect(loadRepoPolicy(dir, policyPath).ecosystem).toBe(policy.ecosystem);

    const initDir = join(scratchBase, "init-policy-dir");
    expect(initRepoPolicy(initDir).schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    rmSync(dir, { recursive: true, force: true });
    rmSync(initDir, { recursive: true, force: true });
  });

  test("atomic policy saves preserve prior bytes on write/fsync/rename failures", () => {
    const dir = join(scratchBase, "durable-policy-save");
    const policyPath = join(dir, ".olt", "policy.json");
    saveRepoPolicy(generateDefaultRepoPolicy(dir), dir);
    const originalBytes = readFileSync(policyPath, "utf-8");
    const repl = { ...generateDefaultRepoPolicy(dir), forbidden_commands: ["curl"] };

    expect(() => saveRepoPolicy(repl, dir, undefined, { write: () => 0 })).toThrow(
      /write made no progress/i,
    );
    expect(readFileSync(policyPath, "utf-8")).toBe(originalBytes);
    expect(() =>
      saveRepoPolicy(repl, dir, undefined, {
        fsync: () => {
          throw new Error("fsync fail");
        },
      }),
    ).toThrow(/fsync fail/i);
    expect(readFileSync(policyPath, "utf-8")).toBe(originalBytes);
    expect(() =>
      saveRepoPolicy(repl, dir, undefined, {
        rename: () => {
          throw new Error("rename fail");
        },
      }),
    ).toThrow(/rename fail/i);
    expect(readFileSync(policyPath, "utf-8")).toBe(originalBytes);
    expect(() =>
      saveRepoPolicy(repl, dir, undefined, {
        fsyncDirectory: () => {
          throw new Error("fsyncDir fail");
        },
      }),
    ).toThrow(/outcome is uncertain/i);
    expect(loadRepoPolicy(dir).forbidden_commands).toContain("curl");
    rmSync(dir, { recursive: true, force: true });
  });

  test("concurrent tasks serialize policy saves and expose only complete valid JSON", async () => {
    const dir = join(scratchBase, "concurrent-policy-saves");
    const policyPath = join(dir, ".olt", "policy.json");
    saveRepoPolicy(generateDefaultRepoPolicy(dir), dir);

    const saveWorker = async (marker: string) => {
      for (let i = 0; i < 5; i++) {
        saveRepoPolicy({ ...generateDefaultRepoPolicy(dir), forbidden_commands: [marker] }, dir);
      }
    };
    await Promise.all([saveWorker("curl-a"), saveWorker("curl-b")]);
    const finalBytes = readFileSync(policyPath, "utf-8");
    expect(() => parseRepoPolicy(JSON.parse(finalBytes) as unknown)).not.toThrow();
    expect(loadRepoPolicy(dir).schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    rmSync(dir, { recursive: true, force: true });
  });

  test("authority loading handles TOCTOU read race conditions, retries, and error propagation", () => {
    const dir = join(scratchBase, "authority-toctou-read");
    saveRepoPolicy(generateDefaultRepoPolicy(dir), dir);

    let c1 = 0;
    expect(() =>
      loadRepoPolicy(dir, undefined, {
        maxAttempts: 1,
        fstat: (fd) => {
          c1++;
          const st = fstatSync(fd);
          return c1 > 1
            ? new Proxy(st, {
                get: (t, k, r) => (k === "ino" ? Number(st.ino) + 1 : Reflect.get(t, k, r)),
              })
            : st;
        },
      }),
    ).toThrow(/changed while reading/i);

    let c2 = 0;
    expect(() =>
      loadRepoPolicy(dir, undefined, {
        maxAttempts: 2,
        fstat: (fd) => {
          c2++;
          const st = fstatSync(fd);
          return c2 === 2
            ? new Proxy(st, {
                get: (t, k, r) => (k === "ino" ? Number(st.ino) + 1 : Reflect.get(t, k, r)),
              })
            : st;
        },
      }),
    ).not.toThrow();

    const loc = resolvePolicyLocation(dir, join(dir, "missing.json"), false);
    expect(readVerifiedFile(loc)).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  test("inspectRepoPolicy accurately reports auto_detected, valid_custom, and invalid_custom status", () => {
    const dir = join(scratchBase, "inspect-policy-test");
    const customPolicyPath = join(dir, ".olt", "policy.json");

    expect(inspectRepoPolicy(dir, customPolicyPath).status).toBe("auto_detected");

    mkdirSync(join(dir, ".olt"), { recursive: true });
    const sample = generateDefaultRepoPolicy(dir);
    writeFileSync(customPolicyPath, JSON.stringify(sample, null, 2), "utf-8");
    expect(inspectRepoPolicy(dir, customPolicyPath).status).toBe("valid_custom");

    writeFileSync(customPolicyPath, "{ malformed json", "utf-8");
    expect(inspectRepoPolicy(dir, customPolicyPath).status).toBe("invalid_custom");

    rmSync(dir, { recursive: true, force: true });
  });
});
