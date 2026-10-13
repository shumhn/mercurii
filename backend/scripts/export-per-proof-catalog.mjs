import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const state = resolve(root, ".state");
const out = resolve(root, "..", "docs");
const teeRpc = "https://devnet-tee.magicblock.app";
const explorer = (signature) =>
  `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(teeRpc)}`;

const receiptSources = [
  resolve(state, "onboarding-receipts.json"),
  resolve(state, "shared-company-loop-EQouhE3DeMBdTS67Yek2kfFFkK63RSSTXmJ74jFknKTk", "receipts.json"),
];

const sourceReceipts = await Promise.all(receiptSources.map(async (file) => ({
  file,
  receipts: (JSON.parse(await readFile(file, "utf8")).receipts ?? []),
})));

const all = sourceReceipts.flatMap(({ file, receipts }) => receipts
  .filter((receipt) => receipt.chain === "ephemeral" && typeof receipt.signature === "string")
  .map((receipt) => ({ ...receipt, source: relative(resolve(root, ".."), file) })));

const bySignature = new Map();
for (const receipt of all) {
  const previous = bySignature.get(receipt.signature);
  if (!previous || Date.parse(receipt.createdAt) > Date.parse(previous.createdAt)) bySignature.set(receipt.signature, receipt);
}
const receipts = [...bySignature.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

async function teeStatuses(signatures) {
  const result = new Map();
  for (let index = 0; index < signatures.length; index += 128) {
    const chunk = signatures.slice(index, index + 128);
    const response = await fetch(teeRpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: index / 128 + 1, method: "getSignatureStatuses",
        params: [chunk, { searchTransactionHistory: true }] }),
    });
    if (!response.ok) throw new Error(`TEE RPC request failed (${response.status})`);
    const body = await response.json();
    if (body.error) throw new Error(body.error.message ?? "TEE RPC returned an error");
    for (const [offset, signature] of chunk.entries()) result.set(signature, body.result?.value?.[offset] ?? null);
  }
  return result;
}

const statuses = await teeStatuses(receipts.map((receipt) => receipt.signature));
const catalog = receipts.map((receipt) => {
  const status = statuses.get(receipt.signature);
  return {
    source: receipt.source,
    id: receipt.id,
    company: receipt.company,
    target: receipt.target,
    operation: receipt.operation,
    createdAt: receipt.createdAt,
    recordedStatus: receipt.status,
    signature: receipt.signature,
    blockhash: receipt.blockhash,
    customExplorerUrl: explorer(receipt.signature),
    tee: status ? { found: true, slot: status.slot, confirmationStatus: status.confirmationStatus, err: status.err } :
      { found: false, slot: null, confirmationStatus: null, err: null },
  };
});

const shared = sourceReceipts.find(({ file }) => file.endsWith("/receipts.json"))?.receipts ?? [];
const flow = shared.map((receipt) => ({
  ...receipt,
  customExplorerUrl: receipt.chain === "ephemeral" ? explorer(receipt.signature) :
    `https://explorer.solana.com/tx/${receipt.signature}?cluster=devnet`,
  tee: receipt.chain === "ephemeral" ? (() => {
    const status = statuses.get(receipt.signature);
    return status ? { found: true, slot: status.slot, confirmationStatus: status.confirmationStatus, err: status.err } :
      { found: false, slot: null, confirmationStatus: null, err: null };
  })() : null,
}));

const finalized = catalog.filter((row) => row.tee.confirmationStatus === "finalized" && row.tee.err === null).length;
const rows = flow.map((receipt) =>
  `| ${receipt.chain === "ephemeral" ? "PER / TEE" : "Base devnet"} | ${receipt.operation} | ${receipt.tee?.slot ?? "—"} | [proof](${receipt.customExplorerUrl}) |`).join("\n");
const markdown = `# MagicBlock PER proof catalog

Generated from Mercurii's persisted devnet testing receipts on ${new Date().toISOString()}.

- MagicBlock private endpoint: \`${teeRpc}\`
- Unique PER receipts discovered: **${catalog.length}**
- Currently finalized on the TEE validator: **${finalized}**
- The accompanying JSON contains every receipt, operation, signature, TEE slot/finality, source artifact, and custom Explorer URL.

## Complete private payment flow

This is one complete company flow. Base-layer steps create and delegate public shells; the PER/TEE steps create private permissions, write the private request, approve it, and update the private treasury snapshot.

| Network | Operation | TEE slot | Explorer |
| --- | --- | ---: | --- |
${rows}

## How to use a PER proof

Every \`PER / TEE\` link points Solana Explorer at MagicBlock's private devnet validator through \`cluster=custom&customUrl=${encodeURIComponent(teeRpc)}\`. It verifies the transaction against the PER endpoint. Private account contents remain permissioned and are not placed in the URL.

## Machine-readable records

See [magicblock-per-proof-catalog.json](./magicblock-per-proof-catalog.json).
`;

await mkdir(out, { recursive: true });
await writeFile(resolve(out, "magicblock-per-proof-catalog.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(), teeRpc, receiptCount: catalog.length, finalizedCount: finalized,
  completeFlow: flow, receipts: catalog,
}, null, 2)}\n`);
await writeFile(resolve(out, "magicblock-per-proof-catalog.md"), markdown);
console.log(JSON.stringify({ receiptCount: catalog.length, finalizedCount: finalized, out }, null, 2));
