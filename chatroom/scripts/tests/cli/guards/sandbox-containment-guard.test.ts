import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../../../index.ts";
import {
  type ContainmentCategory,
  type ContainmentSnapshot,
  detectContainmentLeaks,
  snapshotDaemonProcesses,
  snapshotHostAgentFiles,
  snapshotRepoBindings,
  snapshotRoomDirectories,
  takeContainmentSnapshot,
} from "./containment-snapshot.ts";

describe("Sandbox Containment Guard", () => {
  it("ensures no orphan directories exist in live user rooms directory", () => {
    const liveRoomsDir = join(homedir(), ".agents", "chatroom", "rooms");
    if (!existsSync(liveRoomsDir)) return;
    const entries = readdirSync(liveRoomsDir);
    const orphanDirs: string[] = [];
    for (const entry of entries) {
      const fullPath = join(liveRoomsDir, entry);
      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;

      const isTestRoom = entry.startsWith("sandbox-guard-") || entry === "sandbox-guard-room";
      expect(isTestRoom).toBe(false);

      const manifestPath = join(fullPath, "room.json");
      if (!existsSync(manifestPath)) {
        orphanDirs.push(entry);
        continue;
      }

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
      expect(parsed !== null && typeof parsed === "object").toBe(true);
      expect(parsed?.id).toBe(entry);
      expect(parsed?.v).toBe(1);
    }
    const testOwnedOrphans = orphanDirs.filter(
      (dir) => dir.startsWith("sandbox-guard-") || dir === "sandbox-guard-room",
    );
    expect(testOwnedOrphans).toEqual([]);
  });

  it("ensures no undefined directory exists in chatroom/scripts or repository root", () => {
    const scriptsUndefined = resolve(import.meta.dir, "../../../undefined");
    const repoRootUndefined = resolve(import.meta.dir, "../../../../../undefined");
    expect(existsSync(scriptsUndefined)).toBe(false);
    expect(existsSync(repoRootUndefined)).toBe(false);
  });

  it("asserts zero leaks across all 4 containment locations during isolated CLI execution and cleans up daemons", async () => {
    const targetRoom = `sandbox-guard-room-${process.pid}-${Date.now()}`;
    const repoRoot = resolve(import.meta.dir, "../../../../../");
    const tempDir = mkdtempSync(join(tmpdir(), "chat-containment-"));
    const isolatedRepo = join(tempDir, "repo");
    const isolatedHome = join(tempDir, "home");
    mkdirSync(isolatedRepo, { recursive: true });
    mkdirSync(isolatedHome, { recursive: true });

    const prevHome = process.env.CHATROOM_HOME;
    process.env.CHATROOM_HOME = isolatedHome;

    let daemonPid: number | null = null;
    const findDaemonPid = (): number | null => {
      if (daemonPid !== null) return daemonPid;
      const lockFile = join(
        isolatedHome,
        "rooms",
        targetRoom,
        "locks",
        "daemon",
        "agent-guard.lock",
      );
      if (existsSync(lockFile)) {
        try {
          const payload = JSON.parse(readFileSync(lockFile, "utf8")) as { pid?: number };
          if (typeof payload.pid === "number") {
            daemonPid = payload.pid;
            return daemonPid;
          }
        } catch {}
      }
      return null;
    };

    const isDaemonAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    const testProcessTableReader = (): readonly string[] => {
      const pid = findDaemonPid();
      if (pid !== null && isDaemonAlive(pid)) {
        return [`${pid} cli.ts daemon --room ${targetRoom}`];
      }
      return [];
    };

    const takeTestSnapshot = () => {
      const snap = takeContainmentSnapshot({
        repoRoots: [repoRoot],
        roomMatch: targetRoom,
        processTableReader: testProcessTableReader,
      });
      return {
        roomDirectories: snap.roomDirectories.filter(
          (r) => r.includes("sandbox-guard") || r.includes(targetRoom),
        ),
        daemonProcesses: snap.daemonProcesses,
        hostAgentArtifacts: snap.hostAgentArtifacts.filter(
          (a) => a.includes(targetRoom) || a.includes("sandbox-guard"),
        ),
        repoBindings: snap.repoBindings,
      };
    };

    const before = takeTestSnapshot();

    try {
      await main([
        "chat:init",
        "--room",
        targetRoom,
        "--as",
        "agent-guard",
        "--title",
        "Sandbox Guard Room",
        "--repo",
        isolatedRepo,
        "--no-agent",
        "--json",
      ]);
      await main(["chat:rooms", "--mine", "--as", "agent-guard", "--json"]);
      await main([
        "chat:say",
        "--room",
        targetRoom,
        "--as",
        "agent-guard",
        "--text",
        "Containment check verified",
        "--json",
      ]);

      const isolatedRoomDir = join(isolatedHome, "rooms", targetRoom);
      expect(existsSync(isolatedRoomDir)).toBe(true);
      expect(existsSync(join(isolatedRoomDir, "room.json"))).toBe(true);
      expect(existsSync(join(isolatedRoomDir, "log"))).toBe(true);
      expect(existsSync(join(isolatedRepo, ".chatroom", "binding.json"))).toBe(true);

      await main(["daemon", "--room", targetRoom, "--as", "agent-guard", "--stop", "--json"]).catch(
        () => {},
      );
      const deadline = Date.now() + 3000;
      while (
        Date.now() < deadline &&
        snapshotDaemonProcesses(targetRoom, testProcessTableReader).length > 0
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }

      const after = takeTestSnapshot();

      const leaks = detectContainmentLeaks(before, after);
      expect(leaks).toEqual([]);
      expect(existsSync(join(homedir(), ".agents", "chatroom", "rooms", targetRoom))).toBe(false);
      expect(snapshotDaemonProcesses(targetRoom, testProcessTableReader)).toEqual([]);
      expect(
        existsSync(join(homedir(), ".antigravity", "agents", `communicator-${targetRoom}.json`)),
      ).toBe(false);
      expect(after.repoBindings).toEqual(before.repoBindings);
    } finally {
      await main(["daemon", "--room", targetRoom, "--as", "agent-guard", "--stop", "--json"]).catch(
        () => {},
      );
      for (const pidStr of snapshotDaemonProcesses(targetRoom, testProcessTableReader)) {
        try {
          process.kill(Number(pidStr), "SIGKILL");
        } catch {}
      }
      if (prevHome === undefined) {
        delete process.env.CHATROOM_HOME;
      } else {
        process.env.CHATROOM_HOME = prevHome;
      }
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("identifies the exact category and item when a leak occurs in any containment location", () => {
    const baseline: ContainmentSnapshot = {
      roomDirectories: ["stable-room"],
      daemonProcesses: ["10001"],
      hostAgentArtifacts: ["communicator-stable.json"],
      repoBindings: ["/repos/stable/.chatroom/binding.json"],
    };

    const cases: readonly [ContainmentCategory, string, Partial<ContainmentSnapshot>][] = [
      ["room_directories", "leaked-room", { roomDirectories: ["stable-room", "leaked-room"] }],
      ["daemon_processes", "99999", { daemonProcesses: ["10001", "99999"] }],
      [
        "host_agent_artifacts",
        "communicator-leaked.json",
        { hostAgentArtifacts: ["communicator-stable.json", "communicator-leaked.json"] },
      ],
      [
        "repo_bindings",
        "/repos/leaked/.chatroom/binding.json",
        {
          repoBindings: [
            "/repos/stable/.chatroom/binding.json",
            "/repos/leaked/.chatroom/binding.json",
          ],
        },
      ],
    ];

    for (const [cat, item, partial] of cases) {
      const leaks = detectContainmentLeaks(baseline, { ...baseline, ...partial });
      expect(leaks).toEqual([{ category: cat, item }]);
    }

    const allLeaked: ContainmentSnapshot = {
      roomDirectories: ["stable-room", "leaked-room"],
      daemonProcesses: ["10001", "99999"],
      hostAgentArtifacts: ["communicator-stable.json", "communicator-leaked.json"],
      repoBindings: [
        "/repos/stable/.chatroom/binding.json",
        "/repos/leaked/.chatroom/binding.json",
      ],
    };
    const allLeaks = detectContainmentLeaks(baseline, allLeaked);
    expect(allLeaks).toEqual([
      { category: "room_directories", item: "leaked-room" },
      { category: "daemon_processes", item: "99999" },
      { category: "host_agent_artifacts", item: "communicator-leaked.json" },
      { category: "repo_bindings", item: "/repos/leaked/.chatroom/binding.json" },
    ]);
  });

  it("verifies snapshot helpers correctly scan filesystem structures and process tables", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "chat-snap-"));
    try {
      const fakeRooms = join(tempRoot, "rooms");
      const fakeAgents = join(tempRoot, "agents");
      const fakeRepo = join(tempRoot, "repo");
      mkdirSync(fakeRooms, { recursive: true });
      mkdirSync(fakeAgents, { recursive: true });
      mkdirSync(join(fakeRepo, ".chatroom"), { recursive: true });

      mkdirSync(join(fakeRooms, "test-room-1"));
      mkdirSync(join(fakeRooms, "test-room-2"));
      writeFileSync(join(fakeRooms, "not-a-dir.txt"), "hello");

      writeFileSync(join(fakeAgents, "communicator-test.json"), "{}");
      writeFileSync(join(fakeAgents, "ignored.txt"), "hello");

      writeFileSync(join(fakeRepo, ".chatroom", "binding.json"), "{}");

      expect(snapshotRoomDirectories(fakeRooms)).toEqual(["test-room-1", "test-room-2"]);
      expect(snapshotHostAgentFiles(fakeAgents)).toEqual(["communicator-test.json"]);
      expect(snapshotRepoBindings([fakeRepo, join(tempRoot, "empty-repo")])).toEqual([
        join(fakeRepo, ".chatroom", "binding.json"),
      ]);

      const simulatedProcesses = [
        "PID COMMAND",
        "101 /usr/bin/syslogd",
        "4001 node /path/to/cli.ts daemon --room alpha --foreground",
        "4002 /opt/bun main.ts daemon --room beta --foreground",
        "4003 chatroom daemon --room alpha",
        "5001 worker process",
      ];
      expect(snapshotDaemonProcesses(undefined, () => simulatedProcesses)).toEqual([
        "4001",
        "4002",
        "4003",
      ]);
      expect(snapshotDaemonProcesses("alpha", () => simulatedProcesses)).toEqual(["4001", "4003"]);
    } finally {
      if (existsSync(tempRoot)) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("proves that removing a category from the snapshot causes a leak in that category to go undetected", () => {
    const allCategories: readonly ContainmentCategory[] = [
      "room_directories",
      "daemon_processes",
      "host_agent_artifacts",
      "repo_bindings",
    ];

    const leaksPerCategory: Record<ContainmentCategory, Partial<ContainmentSnapshot>> = {
      room_directories: { roomDirectories: ["escaped-room"] },
      daemon_processes: { daemonProcesses: ["88888"] },
      host_agent_artifacts: { hostAgentArtifacts: ["communicator-escaped.json"] },
      repo_bindings: { repoBindings: ["/repos/escaped/.chatroom/binding.json"] },
    };

    const emptyBaseline: ContainmentSnapshot = {
      roomDirectories: [],
      daemonProcesses: [],
      hostAgentArtifacts: [],
      repoBindings: [],
    };

    for (const cat of allCategories) {
      const leakedSnapshot: ContainmentSnapshot = {
        ...emptyBaseline,
        ...leaksPerCategory[cat],
      };

      const detectedAll = detectContainmentLeaks(emptyBaseline, leakedSnapshot, allCategories);
      expect(detectedAll).toHaveLength(1);
      expect(detectedAll[0]?.category).toBe(cat);

      const reducedCategories = allCategories.filter((c) => c !== cat);
      const detectedWithout = detectContainmentLeaks(
        emptyBaseline,
        leakedSnapshot,
        reducedCategories,
      );
      expect(detectedWithout).toHaveLength(0);

      const snapshotWithout = takeContainmentSnapshot({
        categories: reducedCategories,
        liveRoomsDir: "/nonexistent",
        hostAgentsDir: "/nonexistent",
        repoRoots: [],
        processTableReader: () => [],
      });
      const snapshotDetected = detectContainmentLeaks(
        emptyBaseline,
        snapshotWithout,
        reducedCategories,
      );
      expect(snapshotDetected).toHaveLength(0);
    }
  });
});
