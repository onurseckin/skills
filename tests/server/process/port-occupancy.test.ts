import { describe, expect, it } from "bun:test";
import {
  extractProcessName,
  findPidsOnPort,
  getProcessDetails,
  inspectPortOccupancy,
  inspectProcessesOnPorts,
  isRuntimeProcessCommand,
  parseFuserOutput,
  parseLsofOutput,
  parsePsOutput,
  parseSsOutput,
} from "../../../olt/scripts/src/server/process/index.ts";
import type { CommandExecutionResult } from "../../../olt/scripts/src/server/process/index.ts";

describe("process reclaimer subsystem - output parsers and port inspection", () => {
  describe("output parsers", () => {
    it("parseLsofOutput parses standard PID lists", () => {
      const output = "1234\n5678\n\n9999\n5678\ninvalid\n";
      const pids = parseLsofOutput(output);
      expect(pids).toEqual([1234, 5678, 9999]);
    });

    it("parseLsofOutput returns empty array on empty or whitespace output", () => {
      expect(parseLsofOutput("")).toEqual([]);
      expect(parseLsofOutput("   \n\n  ")).toEqual([]);
    });

    it("parseFuserOutput parses fuser formats", () => {
      const output1 = "3000/tcp:  1234 5678";
      expect(parseFuserOutput(output1)).toEqual([3000, 1234, 5678]);

      const output2 = " 9876   5432 ";
      expect(parseFuserOutput(output2)).toEqual([9876, 5432]);

      expect(parseFuserOutput("")).toEqual([]);
    });

    it("parseSsOutput parses ss socket lines with pid matches", () => {
      const ssOutput = `
LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=11223,fd=19))
LISTEN 0 128 *:8080 *:* users:(("bun",pid=44556,fd=7),("bun",pid=11223,fd=8))
`;
      const pids = parseSsOutput(ssOutput);
      expect(pids).toEqual([11223, 44556]);
    });

    it("extractProcessName extracts base names from command paths", () => {
      expect(extractProcessName("/usr/local/bin/node server.js")).toBe("node");
      expect(extractProcessName("C:\\tools\\bun.exe run dev")).toBe("bun.exe");
      expect(extractProcessName("vite --port 3000")).toBe("vite");
      expect(extractProcessName("")).toBe("unknown");
    });

    it("isRuntimeProcessCommand identifies Node/Bun/Dev servers", () => {
      expect(isRuntimeProcessCommand("node", "/usr/bin/node dist/main.js")).toBe(true);
      expect(isRuntimeProcessCommand("bun", "bun run start")).toBe(true);
      expect(isRuntimeProcessCommand("vite", "./node_modules/.bin/vite")).toBe(true);
      expect(isRuntimeProcessCommand("tsx", "tsx watch src/index.ts")).toBe(true);
      expect(isRuntimeProcessCommand("next", "next dev")).toBe(true);
      expect(isRuntimeProcessCommand("nginx", "/usr/sbin/nginx -g 'daemon off;'")).toBe(false);
      expect(isRuntimeProcessCommand("postgres", "postgres -D /data")).toBe(false);
    });

    it("parsePsOutput parses standard ps line with lstart format", () => {
      const psOutput = "1234 1 S 40960 Mon Aug 31 05:37:54 2026 /usr/local/bin/node server.js\n";
      const details = parsePsOutput(psOutput, 1234);
      expect(details).not.toBeNull();
      if (details) {
        expect(details.pid).toBe(1234);
        expect(details.ppid).toBe(1);
        expect(details.name).toBe("node");
        expect(details.command).toBe("/usr/local/bin/node server.js");
        expect(details.memoryBytes).toBe(40960 * 1024);
        expect(details.startTime).toBe("Mon Aug 31 05:37:54 2026");
        expect(details.isZombie).toBe(false);
        expect(details.isOrphaned).toBe(true);
        expect(details.isRuntimeProcess).toBe(true);
      }
    });

    it("parsePsOutput detects zombie and non-orphaned processes", () => {
      const psOutput = "5555 2222 Z+ 0 Mon Aug 31 05:00:00 2026 [bun] <defunct>\n";
      const details = parsePsOutput(psOutput, 5555);
      expect(details).not.toBeNull();
      if (details) {
        expect(details.pid).toBe(5555);
        expect(details.ppid).toBe(2222);
        expect(details.isZombie).toBe(true);
        expect(details.isOrphaned).toBe(false);
      }
    });

    it("parsePsOutput parses fallback ps line without lstart", () => {
      const psOutput = "9876 500 R 2048 /bin/sh script.sh\n";
      const details = parsePsOutput(psOutput, 9876);
      expect(details).not.toBeNull();
      if (details) {
        expect(details.pid).toBe(9876);
        expect(details.ppid).toBe(500);
        expect(details.command).toBe("/bin/sh script.sh");
        expect(details.memoryBytes).toBe(2048 * 1024);
        expect(details.isOrphaned).toBe(false);
        expect(details.isZombie).toBe(false);
      }
    });

    it("parsePsOutput returns null on empty or corrupt data", () => {
      expect(parsePsOutput("", 123)).toBeNull();
      expect(parsePsOutput("invalid line without numbers", 123)).toBeNull();
    });
  });

  describe("port inspection & fallback mechanism", () => {
    it("findPidsOnPort uses lsof when successful", async () => {
      const mockExec = async (
        cmd: string,
        _args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") {
          return { stdout: "4321\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "not found", exitCode: 127 };
      };

      const pids = await findPidsOnPort(3000, { execCommand: mockExec });
      expect(pids).toEqual([4321]);
    });

    it("findPidsOnPort falls back to fuser if lsof fails", async () => {
      const mockExec = async (
        cmd: string,
        _args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") {
          return { stdout: "", stderr: "command not found", exitCode: 127 };
        }
        if (cmd === "fuser") {
          return { stdout: "3000/tcp: 7788", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const pids = await findPidsOnPort(3000, { execCommand: mockExec });
      expect(pids).toEqual([3000, 7788]);
    });

    it("findPidsOnPort falls back to ss if lsof and fuser fail", async () => {
      const mockExec = async (
        cmd: string,
        _args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "ss") {
          return {
            stdout: "LISTEN 0 128 *:8080 *:* users:(('node',pid=9988,fd=4))\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "failed", exitCode: 1 };
      };

      const pids = await findPidsOnPort(8080, { execCommand: mockExec });
      expect(pids).toEqual([9988]);
    });

    it("findPidsOnPort returns empty array if no tools find any process", async () => {
      const mockExec = async (): Promise<CommandExecutionResult> => {
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const pids = await findPidsOnPort(9999, { execCommand: mockExec });
      expect(pids).toEqual([]);
    });

    it("getProcessDetails handles ps command execution and parsing", async () => {
      const mockExec = async (
        cmd: string,
        args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "ps" && args.includes("2001")) {
          return {
            stdout: "2001 1 S 15000 Mon Aug 31 05:00:00 2026 bun dev\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "process not found", exitCode: 1 };
      };

      const details = await getProcessDetails(2001, { execCommand: mockExec });
      expect(details).not.toBeNull();
      expect(details?.pid).toBe(2001);
      expect(details?.name).toBe("bun");
      expect(details?.isRuntimeProcess).toBe(true);

      const notFound = await getProcessDetails(99999, { execCommand: mockExec });
      expect(notFound).toBeNull();
    });

    it("inspectPortOccupancy aggregates PIDs and details", async () => {
      const mockExec = async (
        cmd: string,
        args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") {
          return { stdout: "3001\n", stderr: "", exitCode: 0 };
        }
        if (cmd === "ps" && args.includes("3001")) {
          return {
            stdout: "3001 1 S 25000 Mon Aug 31 05:00:00 2026 node server.js\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const occupancy = await inspectPortOccupancy(4000, { execCommand: mockExec });
      expect(occupancy.port).toBe(4000);
      expect(occupancy.pids).toEqual([3001]);
      expect(occupancy.processes.length).toBe(1);
      const proc = occupancy.processes[0];
      expect(proc?.pid).toBe(3001);
      expect(proc?.isRuntimeProcess).toBe(true);
    });

    it("inspectProcessesOnPorts inspects multiple ports concurrently", async () => {
      const mockExec = async (
        cmd: string,
        args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") {
          if (args.includes(":3000")) return { stdout: "100\n", stderr: "", exitCode: 0 };
          if (args.includes(":3001")) return { stdout: "200\n", stderr: "", exitCode: 0 };
        }
        if (cmd === "ps") {
          if (args.includes("100"))
            return {
              stdout: "100 1 S 1000 Mon Aug 31 05:00:00 2026 bun a\n",
              stderr: "",
              exitCode: 0,
            };
          if (args.includes("200"))
            return {
              stdout: "200 1 S 2000 Mon Aug 31 05:00:00 2026 bun b\n",
              stderr: "",
              exitCode: 0,
            };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const results = await inspectProcessesOnPorts([3000, 3001], { execCommand: mockExec });
      expect(results.length).toBe(2);
      expect(results[0]?.port).toBe(3000);
      expect(results[0]?.pids).toEqual([100]);
      expect(results[1]?.port).toBe(3001);
      expect(results[1]?.pids).toEqual([200]);
    });
  });
});
