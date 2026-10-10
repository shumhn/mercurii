import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { listInvoicePaymentIds, reserveInvoiceFlow } from "../src/invoice-journal.ts";
import { getOrCreatePaymentFlow } from "../src/payment-flow.ts";

test("one vendor invoice stays bound to one private payment across repeated suggestions", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-invoice-"));
  const previousInvoice = process.env.MERCURY_INVOICE_JOURNAL;
  const previousFlow = process.env.MERCURY_PAYMENT_FLOW_JOURNAL;
  process.env.MERCURY_INVOICE_JOURNAL = join(directory, "invoices.json");
  process.env.MERCURY_PAYMENT_FLOW_JOURNAL = join(directory, "flows.json");
  try {
    const args = {
      company: Keypair.generate().publicKey.toBase58(), vendorId: "acme",
      invoiceNumber: "AC-102", agent: Keypair.generate().publicKey.toBase58(),
      recipient: Keypair.generate().publicKey.toBase58(), amountMicro: "12500000",
    };
    const first = reserveInvoiceFlow(args);
    const repeat = reserveInvoiceFlow({ ...args, invoiceNumber: " ac-102 " });
    assert.equal(repeat.paymentId, first.paymentId);
    assert.equal(repeat.requestAddress, first.requestAddress);
    assert.equal(repeat.repeated, true);
    assert.equal(first.repeated, false);
    assert.match(first.paymentId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.throws(() => reserveInvoiceFlow({ ...args, amountMicro: "13000000" }), /different payment terms/);
    assert.throws(() => reserveInvoiceFlow({ ...args, recipient: Keypair.generate().publicKey.toBase58() }),
      /different payment terms/);
    assert.notEqual(reserveInvoiceFlow({ ...args, invoiceNumber: "AC-103" }).paymentId, first.paymentId);
    assert.notEqual(reserveInvoiceFlow({ ...args, vendorId: "other" }).paymentId, first.paymentId);
    const otherCompany = Keypair.generate().publicKey.toBase58();
    const other = reserveInvoiceFlow({ ...args, company: otherCompany });
    assert.notEqual(other.paymentId, first.paymentId);
    assert.equal(reserveInvoiceFlow({ ...args, company: otherCompany }).paymentId, other.paymentId);
    const founderSuggestion = reserveInvoiceFlow({ ...args, invoiceNumber: "AC-FOUNDER",
      includeFinance: false });
    const founderDraft = getOrCreatePaymentFlow(founderSuggestion.paymentId, args.company, {
      requester: args.agent, recipient: args.recipient,
      amountMicro: Number(args.amountMicro), includeFinance: false,
    });
    assert.equal(founderDraft.flow.request, founderSuggestion.requestAddress);
    const disk = readFileSync(process.env.MERCURY_INVOICE_JOURNAL!, "utf8");
    assert.equal(statSync(process.env.MERCURY_INVOICE_JOURNAL!).mode & 0o777, 0o600);
    assert.equal(disk.includes("AC-102"), false);
    assert.equal(disk.includes(args.recipient), false);
    assert.equal(disk.includes(args.amountMicro), false);
    const records = JSON.parse(disk) as { invoices: Array<{ company: string }> };
    assert.ok(records.invoices.some((record) => record.company === args.company));
    assert.ok(records.invoices.some((record) => record.company === otherCompany));
    const companyInvoiceIds = listInvoicePaymentIds(args.company);
    assert.ok(companyInvoiceIds.includes(first.paymentId));
    assert.ok(companyInvoiceIds.includes(founderSuggestion.paymentId));
    assert.equal(companyInvoiceIds.length, 4);
    assert.deepEqual(listInvoicePaymentIds(otherCompany), [other.paymentId]);
    assert.equal(readFileSync(process.env.MERCURY_PAYMENT_FLOW_JOURNAL!, "utf8").includes(args.recipient), false);
  } finally {
    if (previousInvoice === undefined) delete process.env.MERCURY_INVOICE_JOURNAL;
    else process.env.MERCURY_INVOICE_JOURNAL = previousInvoice;
    if (previousFlow === undefined) delete process.env.MERCURY_PAYMENT_FLOW_JOURNAL;
    else process.env.MERCURY_PAYMENT_FLOW_JOURNAL = previousFlow;
    rmSync(directory, { recursive: true, force: true });
  }
});
