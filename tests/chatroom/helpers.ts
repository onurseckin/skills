import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  createRoom,
  type CreateRoomOptions,
  type CreateRoomResult,
} from "../../chatroom/scripts/src/room/index.ts";

export const VIRTUAL_CHATROOM_HOME = "/virtual/chatroom";

let activeVfs: VirtualMemoryFS = new VirtualMemoryFS();
let activeSession: VirtualFSSession | null = null;
let savedHome: string | undefined;

export interface VirtualChatroomContext {
  readonly vfs: VirtualMemoryFS;
  readonly session: VirtualFSSession;
  readonly homeDir: string;
}

export function setupVirtualChatroomFS(homeDir = VIRTUAL_CHATROOM_HOME): VirtualChatroomContext {
  cleanupVirtualChatroomFS();
  activeVfs = new VirtualMemoryFS();
  activeSession = createVirtualFSSession(activeVfs);
  savedHome = process.env["CHATROOM_HOME"];
  process.env["CHATROOM_HOME"] = homeDir;
  return {
    vfs: activeVfs,
    session: activeSession,
    homeDir,
  };
}

export function cleanupVirtualChatroomFS(): void {
  if (savedHome !== undefined) {
    process.env["CHATROOM_HOME"] = savedHome;
    savedHome = undefined;
  } else {
    delete process.env["CHATROOM_HOME"];
  }
  if (activeSession) {
    activeSession.cleanup();
    activeSession = null;
  }
}

export function getVirtualChatroomFS(): VirtualMemoryFS {
  return activeVfs;
}

export function createTestRoom(options: CreateRoomOptions): CreateRoomResult {
  if (!process.env["CHATROOM_HOME"]) {
    setupVirtualChatroomFS();
  }
  return createRoom(options);
}

export async function withTestRoom<T>(
  options: CreateRoomOptions,
  fn: (room: CreateRoomResult, context: VirtualChatroomContext) => Promise<T> | T,
): Promise<T> {
  const context = setupVirtualChatroomFS();
  try {
    const room = createRoom(options);
    return await fn(room, context);
  } finally {
    cleanupVirtualChatroomFS();
  }
}
