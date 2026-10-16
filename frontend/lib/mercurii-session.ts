import type { AccessRole } from "./mercurii-client";

export const PRIVATE_SESSION_STORAGE_KEY = "mercurii.private-session";

export type CachedPrivateSession = {
  address: string;
  company: string;
  token: string;
  expiresAt: number;
  role: AccessRole;
  grantAddress: string | null;
};

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const roles = new Set<AccessRole>(["founder", "finance", "manager", "requester", "viewer", "agent", "member"]);

/** A TEE login may survive a same-tab refresh, but never a closed tab. */
export function readCachedPrivateSession(storage: SessionStorageLike, now = Date.now()): CachedPrivateSession | null {
  try {
    const raw = storage.getItem(PRIVATE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CachedPrivateSession>;
    if (!addressPattern.test(value.address ?? "") || !addressPattern.test(value.company ?? "") ||
        typeof value.token !== "string" || !value.token || typeof value.expiresAt !== "number" ||
        !Number.isFinite(value.expiresAt) || value.expiresAt <= now || !roles.has(value.role as AccessRole) ||
        (value.grantAddress !== null && value.grantAddress !== undefined && !addressPattern.test(value.grantAddress))) {
      storage.removeItem(PRIVATE_SESSION_STORAGE_KEY);
      return null;
    }
    return {
      address: value.address!, company: value.company!, token: value.token,
      expiresAt: value.expiresAt, role: value.role as AccessRole,
      grantAddress: value.grantAddress ?? null,
    };
  } catch {
    try { storage.removeItem(PRIVATE_SESSION_STORAGE_KEY); } catch { /* Storage unavailable. */ }
    return null;
  }
}

export function cachePrivateSession(storage: SessionStorageLike, session: CachedPrivateSession): void {
  storage.setItem(PRIVATE_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearCachedPrivateSession(storage: SessionStorageLike): void {
  try { storage.removeItem(PRIVATE_SESSION_STORAGE_KEY); } catch { /* Storage unavailable. */ }
}
