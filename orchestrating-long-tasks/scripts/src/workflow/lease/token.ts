import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newLeaseToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenMatches(token: unknown, digest: string): boolean {
  if (typeof token !== "string") return false;
  const left = Buffer.from(tokenDigest(token), "hex");
  const right = Buffer.from(digest, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
