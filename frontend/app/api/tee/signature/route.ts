import { NextResponse } from "next/server";

const MAGICBLOCK_TEE_RPC = "https://devnet-tee.magicblock.app";
const MAGICBLOCK_ER_RPC = "https://devnet.magicblock.app";

/** Signature status lookup against a MagicBlock network (PER or public ER).
 * getSignatureStatuses reads public transaction status, so no TEE auth token
 * is needed — the token only gates reads of private account state. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const signature = searchParams.get("signature");
  const network = searchParams.get("network") === "er" ? "er" : "tee";
  const rpc = network === "er" ? MAGICBLOCK_ER_RPC : MAGICBLOCK_TEE_RPC;
  if (!signature || signature.length > 128) {
    return NextResponse.json({ success: false, error: "signature query param is required" }, { status: 400 });
  }
  try {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }] }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`MagicBlock RPC failed (${response.status})`);
    const json = await response.json() as {
      error?: { message?: string };
      result?: { value: Array<{ slot: number; err: unknown; confirmationStatus: string | null } | null> };
    };
    if (json.error) throw new Error(json.error.message ?? "MagicBlock RPC returned an error");
    const status = json.result?.value[0] ?? null;
    return NextResponse.json({ success: true, data: {
      signature,
      rpc,
      found: status !== null,
      slot: status?.slot ?? null,
      err: status?.err ?? null,
      errorMessage: status?.err == null ? null :
        typeof status.err === "string" ? status.err : JSON.stringify(status.err),
      confirmationStatus: status?.confirmationStatus ?? null,
      finalized: status?.confirmationStatus === "finalized" && status?.err == null,
    } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Lookup failed" }, { status: 502 });
  }
}
