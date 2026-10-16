import assert from "node:assert/strict";
import test from "node:test";
import { cachePrivateSession, PRIVATE_SESSION_STORAGE_KEY, readCachedPrivateSession } from "../lib/mercurii-session.ts";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const session = {
  address: "6z7fat8vLSpEg6AGPtqW6xGVXYMGQcviHj46c2HAF4wk",
  company: "HyqFG3AbfVJ1thS2DA6BLqu5vxkoaf5fUEcH9K8QGANm",
  token: "private-tee-token",
  expiresAt: 2_000_000,
  role: "founder",
  grantAddress: null,
};

test("private session survives a same-tab refresh while it is valid", () => {
  const target = storage();
  cachePrivateSession(target, session);
  assert.deepEqual(readCachedPrivateSession(target, 1_000_000), session);
});

test("expired private session is removed instead of restoring stale access", () => {
  const target = storage();
  cachePrivateSession(target, session);
  assert.equal(readCachedPrivateSession(target, 2_000_000), null);
  assert.equal(target.getItem(PRIVATE_SESSION_STORAGE_KEY), null);
});
