import assert from "node:assert/strict";
import test from "node:test";
import { formatUsdc, parseUsdc } from "../lib/mercurii-client.ts";

test("USDC display preserves micro precision and signed budget differences", () => {
  assert.equal(formatUsdc("123456789"), "123.456789 USDC");
  assert.equal(formatUsdc("-1"), "−0.000001 USDC");
  assert.equal(formatUsdc("-123456789"), "−123.456789 USDC");
  assert.equal(formatUsdc("0"), "0 USDC");
  assert.equal(formatUsdc(null), "—");
});

test("USDC input accepts exact decimals and rejects zero or excess precision", () => {
  assert.equal(parseUsdc("12.345678"), 12345678);
  assert.throws(() => parseUsdc("0"));
  assert.throws(() => parseUsdc("1.0000001"));
});
