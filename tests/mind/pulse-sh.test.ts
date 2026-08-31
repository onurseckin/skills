import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { initRun } from "../../olt/scripts/src/engine/store/index.ts";
import { loadRun } from "../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../olt/scripts/src/engine/store/index.ts";
import { scratchRoot as makeScratchRoot } from "../shared/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

const PULSE_SH_PATH = resolve(import.meta.dir, "../../../olt/scripts/pulse.sh");

const MIND_WAKE_SRC = resolve(
  import.meta.dir,
  "../../../olt/scripts/src/cli/commands/mind-wake.ts",
);

function createTestHarness(root: string): string {
  const harnessFile = join(root, "test-harness.ts");
  const script = [
    `import { mindWakeCommand } from "${MIND_WAKE_SRC}";`,
    `const args = process.argv.slice(2);`,
    `if (args[0] === "mind:wake") {`,
    `  const flags: Record<string, string> = {};`,
    `  for (let i = 1; i < args.length; i++) {`,
    `    if (args[i] === "--run" && i + 1 < args.length) {`,
    `      flags.run = args[++i]!;`,
    `    }`,
    `  }`,
    `  const result = await mindWakeCommand(flags);`,
    `  console.log(result.markdown);`,
    `}`,
  ].join("\n");
  writeFileSync(harnessFile, script, "utf-8");
  return harnessFile;
}

function setupMindCapsule(repo: string, name: string): string {
  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent = `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Pulse Test Mind"\n  goals:\n    - id: "G1"\n      statement: "Test pulse driver"\n  non_goals:\n    - "None"\n  repo_roots:\n    - "src/"\n    - "olt/"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "olt/agents/mind.yaml",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "olt/agents/mind.yaml",
          pinned_sha256: charterSha,
          goals: ["G1"],
          repo_roots: ["src/", "olt/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };

      working.budget = {
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
        base_interval_ms: 900_000,
        max_interval_ms: 14_400_000,
        max_pause_interval_ms: 1_800_000,
        pulse_deadline_ms: 1_200_000,
        max_open_proposals: 5,
        quiet_hours: null,
        day_key: "2026-08-21",
        pulses_today: 1,
        wall_clock_ms_today: 60_000,
      };

      working.pulse = {
        counter: 1,
        open: null,
        last: null,
      };

      working.observations = [];
      working.candidates = [];
      working.escalations = [];
      working.audit = {
        last_started_at: new Date().toISOString(),
        last_verdict: "approved",
        open_findings: [],
      };
    },
  );

  return run;
}

describe("pulse.sh driver seam", () => {
  test("pulse.sh exists and is under 40 lines", () => {
    expect(existsSync(PULSE_SH_PATH)).toBe(true);
    const content = readFileSync(PULSE_SH_PATH, "utf-8");
    const physicalLines = content.split("\n");
    const lineCount =
      physicalLines.length > 0 && physicalLines.at(-1) === ""
        ? physicalLines.length - 1
        : physicalLines.length;
    expect(lineCount).toBeLessThan(40);
    expect(lineCount).toBeGreaterThan(5);
  });

  test("generates wake brief and passes brief file to host invocation", async () => {
    const root = scratchRoot("brief-pass");
    const harnessPath = createTestHarness(root);
    const run = setupMindCapsule(root, "brief");
    const recordFile = join(root, "brief_arg.txt");
    const hostCommand = `node -e 'const fs=require("fs"); const p=process.argv[1]; fs.writeFileSync("${recordFile}", fs.readFileSync(p, "utf-8"));'`;

    const proc = Bun.spawn(["bash", PULSE_SH_PATH, run, hostCommand], {
      cwd: root,
      env: {
        ...process.env,
        HARNESS_PATH: harnessPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    expect(existsSync(recordFile)).toBe(true);
    const recordedContent = readFileSync(recordFile, "utf-8");
    expect(recordedContent).toContain("MODE");
    expect(recordedContent).toContain("CHARTER");
  }, 30000);

  test("flock concurrency exclusion: second concurrent invocation exits 0 without waiting", async () => {
    const root = scratchRoot("concurrency");
    const harnessPath = createTestHarness(root);
    const run = setupMindCapsule(root, "conc");
    const syncFile = join(root, "started.txt");
    const blockerFile = join(root, "continue.txt");

    const hostScript = `node -e 'const fs=require("fs"); fs.writeFileSync("${syncFile}", "started"); while(!fs.existsSync("${blockerFile}")) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }'`;

    const proc1 = Bun.spawn(["bash", PULSE_SH_PATH, run, hostScript], {
      cwd: root,
      env: {
        ...process.env,
        HARNESS_PATH: harnessPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait until proc1 is confirmed running inside host command holding the lock
    while (!existsSync(syncFile)) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }

    // Now invoke second process - it should immediately exit 0 due to flock collision
    const proc2Output = join(root, "proc2_output.txt");
    const proc2Host = `node -e 'const fs=require("fs"); fs.writeFileSync("${proc2Output}", "proc2-ran");'`;
    const proc2 = Bun.spawn(["bash", PULSE_SH_PATH, run, proc2Host], {
      cwd: root,
      env: {
        ...process.env,
        HARNESS_PATH: harnessPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const proc2Exit = await proc2.exited;
    expect(proc2Exit).toBe(0);
    expect(existsSync(proc2Output)).toBe(false);

    // Unblock proc1
    writeFileSync(blockerFile, "go", "utf-8");
    const proc1Exit = await proc1.exited;
    expect(proc1Exit).toBe(0);
  }, 30000);

  test("cleans up brief temporary file after successful execution", async () => {
    const root = scratchRoot("temp-cleanup");
    const harnessPath = createTestHarness(root);
    const run = setupMindCapsule(root, "cleanup");
    const pathRecordFile = join(root, "brief_path.txt");

    const hostCommand = `node -e 'const fs=require("fs"); fs.writeFileSync("${pathRecordFile}", process.argv[1]);'`;

    const proc = Bun.spawn(["bash", PULSE_SH_PATH, run, hostCommand], {
      cwd: root,
      env: {
        ...process.env,
        HARNESS_PATH: harnessPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const briefPath = readFileSync(pathRecordFile, "utf-8").trim();
    expect(briefPath.length).toBeGreaterThan(0);
    expect(existsSync(briefPath)).toBe(false);
  }, 30000);

  test("cleans up brief temporary file after host command failure and propagates non-zero exit", async () => {
    const root = scratchRoot("fail-cleanup");
    const harnessPath = createTestHarness(root);
    const run = setupMindCapsule(root, "fail");
    const pathRecordFile = join(root, "brief_path.txt");

    const hostCommand = `node -e 'const fs=require("fs"); fs.writeFileSync("${pathRecordFile}", process.argv[1]); process.exit(42);'`;

    const proc = Bun.spawn(["bash", PULSE_SH_PATH, run, hostCommand], {
      cwd: root,
      env: {
        ...process.env,
        HARNESS_PATH: harnessPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(42);

    const briefPath = readFileSync(pathRecordFile, "utf-8").trim();
    expect(briefPath.length).toBeGreaterThan(0);
    expect(existsSync(briefPath)).toBe(false);
  }, 30000);

  test("respects PULSE_HOST_CMD environment variable", async () => {
    const root = scratchRoot("env-host");
    const harnessPath = createTestHarness(root);
    const run = setupMindCapsule(root, "env");
    const recordFile = join(root, "env_record.txt");

    const proc = Bun.spawn(["bash", PULSE_SH_PATH, run], {
      cwd: root,
      env: {
        ...process.env,
        HARNESS_PATH: harnessPath,
        PULSE_HOST_CMD: `node -e 'const fs=require("fs"); fs.writeFileSync("${recordFile}", "from-env");'`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(existsSync(recordFile)).toBe(true);
    expect(readFileSync(recordFile, "utf-8")).toBe("from-env");
  }, 30000);

  test("killing a pulse mid-flight leaves capsule state for subsequent wake reclamation", async () => {
    const root = scratchRoot("midflight-kill");
    const harnessPath = createTestHarness(root);
    const run = setupMindCapsule(root, "kill");

    // Manually simulate an open pulse that was in progress when killed
    transact(
      run,
      "mind-1",
      "mind-pulse-opened",
      {
        pulse_id: "pulse-midflight-1",
        deadline_at: new Date(Date.now() - 5000).toISOString(),
        host: "antigravity",
        driver: "pulse.sh",
      },
      (working) => {
        const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
        workingPulse.open = {
          pulse_id: "pulse-midflight-1",
          opened_at: new Date(Date.now() - 10000).toISOString(),
          deadline_at: new Date(Date.now() - 5000).toISOString(),
          actor: "mind-1",
          host: "antigravity",
          driver: "pulse.sh",
        };
        working.pulse =
          workingPulse as unknown as import("../../../olt/scripts/src/core/contracts/index.ts").JsonObject;
      },
    );

    // Verify pulse is currently open
    const beforeRun = loadRun(run, false);
    const beforePulse = (beforeRun.state.pulse ?? {}) as Record<string, unknown>;
    expect(beforePulse.open).not.toBeNull();

    // Now run pulse.sh - its mind:wake step should reclaim the dead pulse
    const proc = Bun.spawn(["bash", PULSE_SH_PATH, run], {
      cwd: root,
      env: {
        ...process.env,
        HARNESS_PATH: harnessPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    // Verify pulse was reclaimed as crashed
    const afterRun = loadRun(run, false);
    const afterPulse = (afterRun.state.pulse ?? {}) as Record<string, unknown>;
    expect(afterPulse.open ?? null).toBeNull();
    const lastPulse = (afterPulse.last ?? {}) as Record<string, unknown>;
    expect(lastPulse.outcome).toBe("crashed");
    expect(lastPulse.pulse_id).toBe("pulse-midflight-1");
  }, 30000);
});
