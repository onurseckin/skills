import { describe, expect, it } from "bun:test";
import { SessionAuthResolver } from "../../../olt/scripts/src/capture/runners/session-auth-resolver.ts";
import type { CaptureAuthConfig } from "../../../olt/scripts/src/capture/config/types.ts";
import type {
  CaptureCookie,
  CapturePageDriver,
  ResolvedSessionAuth,
} from "../../../olt/scripts/src/capture/runners/types.ts";

describe("session-auth-resolver: user resolution and driver token application", () => {
  describe("resolveUser", () => {
    it("returns cached session if available", () => {
      const resolver = new SessionAuthResolver();
      const session: ResolvedSessionAuth = {
        userId: "cached-user",
        role: "member",
        name: "Member User",
        headers: {},
        resolvedAt: new Date().toISOString(),
      };
      resolver.cacheSession("cached-user", session);
      expect(resolver.resolveUser("cached-user")).toBe(session);
    });

    it("returns simulated session when authConfig users is missing", () => {
      const resolver = new SessionAuthResolver({} as unknown as CaptureAuthConfig);
      const session = resolver.resolveUser("any-user");
      expect(session?.userId).toBe("any-user");
      expect(session?.role).toBe("any-user");
      expect(session?.name).toBe("Simulated user");
    });

    it("finds direct user by ID", () => {
      const resolver = new SessionAuthResolver({
        tokenHeaderName: "X-Custom-Token",
        users: {
          "user@example.com": {
            id: "user@example.com",
            name: "Email User",
            role: "customer",
            token: "raw-token-value",
            headers: { "X-Extra": "value" },
          },
        },
      });

      const session = resolver.resolveUser("user@example.com");
      expect(session?.userId).toBe("user@example.com");
      expect(session?.headers["X-Custom-Token"]).toBe("raw-token-value");
      expect(session?.headers["X-Extra"]).toBe("value");
    });

    it("falls back to resolveRole when user ID is not directly in users map", () => {
      const resolver = new SessionAuthResolver({
        users: {
          userKey: {
            id: "my-id",
            name: "Role User",
            role: "specialist",
          },
        },
      });

      const session = resolver.resolveUser("specialist");
      expect(session?.userId).toBe("my-id");
      expect(session?.role).toBe("specialist");
    });
  });

  describe("applyAuthToHeaders", () => {
    it("merges base headers with session auth headers", () => {
      const resolver = new SessionAuthResolver();
      const session: ResolvedSessionAuth = {
        userId: "u1",
        role: "admin",
        name: "Admin",
        headers: { Authorization: "Bearer xyz", "X-Custom": "123" },
        resolvedAt: new Date().toISOString(),
      };

      const result = resolver.applyAuthToHeaders(
        { Accept: "application/json", "X-Custom": "old" },
        session,
      );
      expect(result).toEqual({
        Accept: "application/json",
        Authorization: "Bearer xyz",
        "X-Custom": "123",
      });
    });
  });

  describe("applyAuthToDriver", () => {
    it("sets extra HTTP headers and sets cookies via driver.setCookies", async () => {
      const resolver = new SessionAuthResolver();
      const session: ResolvedSessionAuth = {
        userId: "u1",
        role: "admin",
        name: "Admin",
        headers: { Authorization: "Bearer xyz" },
        cookies: [{ name: "session_id", value: "abc", path: "/" }],
        resolvedAt: new Date().toISOString(),
      };

      let headersSet: Record<string, string> = {};
      let cookiesSet: CaptureCookie[] = [];

      const driver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async (headers) => {
          headersSet = headers;
        },
        setCookies: async (cookies) => {
          cookiesSet = cookies;
        },
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => ({}) as never,
      };

      await resolver.applyAuthToDriver(driver, session);
      expect(headersSet).toEqual({ Authorization: "Bearer xyz" });
      expect(cookiesSet).toEqual([{ name: "session_id", value: "abc", path: "/" }]);
    });

    it("falls back to driver.setCookie if setCookies is not available", async () => {
      const resolver = new SessionAuthResolver();
      const session: ResolvedSessionAuth = {
        userId: "u1",
        role: "admin",
        name: "Admin",
        headers: {},
        cookies: [
          { name: "cookie1", value: "v1", path: "/" },
          { name: "cookie2", value: "v2", path: "/" },
        ],
        resolvedAt: new Date().toISOString(),
      };

      const individualCookies: CaptureCookie[] = [];

      const driver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        setCookie: async (cookie) => {
          individualCookies.push(cookie);
        },
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => ({}) as never,
      };

      await resolver.applyAuthToDriver(driver, session);
      expect(individualCookies).toEqual([
        { name: "cookie1", value: "v1", path: "/" },
        { name: "cookie2", value: "v2", path: "/" },
      ]);
    });

    it("does not call header or cookie setters when session has none", async () => {
      const resolver = new SessionAuthResolver();
      const session: ResolvedSessionAuth = {
        userId: "u1",
        role: "admin",
        name: "Admin",
        headers: {},
        resolvedAt: new Date().toISOString(),
      };

      let headersCalled = false;
      const driver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {
          headersCalled = true;
        },
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => ({}) as never,
      };

      await resolver.applyAuthToDriver(driver, session);
      expect(headersCalled).toBe(false);
    });
  });
});
