// SDK protocol smoke test only: the merchant and confirmation callback are mocked.
// It signs an x402 payload, but no transaction is submitted or settled onchain.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { base58 } from '@scure/base';
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { purchaseX402 } from '../src/x402-spender.ts';
import { DEVNET_USDC } from '../src/magicblock.ts';

const payer = Keypair.generate();
const payTo = Keypair.generate().publicKey.toBase58();
let challenged = 0;
let signed = 0;
const server = createServer((req, res) => {
  if (!req.headers['payment-signature']) {
    challenged++;
    const required = { x402Version: 2, resource: { url: `http://127.0.0.1:${server.address().port}/report` },
      accepts: [{ scheme: 'exact', network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        asset: DEVNET_USDC, amount: '1000', payTo, maxTimeoutSeconds: 60,
        extra: { feePayer: payer.publicKey.toBase58() } }] };
    res.writeHead(402, { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(required) });
    res.end();
  } else {
    signed++;
    const payload = JSON.parse(Buffer.from(req.headers['payment-signature'], 'base64').toString());
    if (payload.accepted.payTo !== payTo || payload.accepted.amount !== '1000') {
      res.writeHead(400); res.end(); return;
    }
    res.writeHead(200, { 'PAYMENT-RESPONSE': encodePaymentResponseHeader({ success: true,
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', transaction: 'mock-only' }) });
    res.end('sandbox resource');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const dir = mkdtempSync(join(tmpdir(), 'mercury-x402-handshake-'));
process.env.MERCURY_X402_JOURNAL = join(dir, 'journal.json');
try {
  const result = await purchaseX402({ taskId: randomUUID(), serviceId: 'local',
    registry: { local: { url: `http://127.0.0.1:${server.address().port}/report`, payTo,
      maxMicro: '1000', periodCapMicro: '5000', expiresAt: '2030-01-01T00:00:00.000Z' } },
    signerSecret: base58.encode(payer.secretKey), rpcUrl: 'https://api.devnet.solana.com',
    confirmTransaction: async () => true });
  console.log(JSON.stringify({ status: result.status, challenged, signed,
    resourceText: result.resourceText, note: 'mock merchant; no onchain settlement' }));
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
