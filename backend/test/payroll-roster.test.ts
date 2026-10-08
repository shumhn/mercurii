import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { previewPayrollCsv } from "../src/payroll-roster.ts";

test("payroll CSV preview parses quoted names and exact USDC micro amounts", () => {
  const first = Keypair.generate().publicKey.toBase58();
  const second = Keypair.generate().publicKey.toBase58();
  const csv = `name,wallet,amount_usdc\r\n"A, Person",${first},12.345678\r\nB,${second},0.000001\r\n`;
  const preview = previewPayrollCsv(csv);
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.items[0]?.label, "A, Person");
  assert.equal(preview.items[0]?.amountMicro, 12_345_678);
  assert.equal(preview.totalMicro, "12345679");
  assert.equal(preview.canCreateRun, true);
});

test("payroll CSV reports invalid and duplicate rows before any run is created", () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const preview = previewPayrollCsv(`wallet,amount_usdc\n${wallet},1\n${wallet},2\nnot-a-wallet,3\n`);
  assert.equal(preview.items.length, 1);
  assert.equal(preview.errors.length, 2);
  assert.deepEqual(preview.errors.map((error) => error.row), [3, 4]);
  assert.equal(preview.canCreateRun, false);
  assert.throws(() => previewPayrollCsv("wallet,name\nabc,A"), /amount_usdc/);
  assert.throws(() => previewPayrollCsv('wallet,amount_usdc\n"unterminated,1'), /Unclosed/);
});
