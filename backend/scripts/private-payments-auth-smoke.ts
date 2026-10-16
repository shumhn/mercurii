import assert from "node:assert/strict";

const endpoint = new URL("/v1/spl/private-balance", "https://payments.magicblock.app");
endpoint.searchParams.set(
  "address",
  process.env.MERCURY_PRIVATE_BALANCE_ADDRESS ?? "Bt9oNR5cCtnfuMmXgWELd6q5i974PdEMQDUE55nBC57L",
);
endpoint.searchParams.set(
  "mint",
  process.env.MERCURY_PRIVATE_BALANCE_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);
endpoint.searchParams.set("cluster", process.env.MAGICBLOCK_CLUSTER ?? "devnet-private");

async function probe(authorization?: string) {
  const response = await fetch(endpoint, {
    headers: authorization ? { authorization } : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  assert.doesNotMatch(body, /"balance"\s*:/, "an unauthenticated request leaked a balance");
  return { status: response.status, body };
}

const missing = await probe();
assert.equal(missing.status, 422);
assert.match(missing.body, /authorization is required/);

const invalid = await probe("Bearer definitely-invalid");
assert.equal(invalid.status, 403);
assert.match(invalid.body, /TOKEN_IDENTITY_MISMATCH/);

process.stdout.write(JSON.stringify({
  result: "PASS",
  endpoint: endpoint.origin + endpoint.pathname,
  missingAuthorizationDenied: true,
  wrongWalletTokenDenied: true,
  balanceLeaked: false,
}) + "\n");
