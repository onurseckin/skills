import { createHmac } from "node:crypto";
import type { CookieTemplateSpec, PersonaDefinition } from "../parameters/index.ts";
import type {
  SessionCookie,
  LocalStorageEntry,
  BrowserStorageOrigin,
  BrowserStorageState,
  PersonaSessionContext,
} from "./types.ts";

export function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}

export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/gu, "+").replace(/_/gu, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

export const MOCK_JWT_SECRET = "olt-test-mock-jwt-secret-key-32-chars-long";
