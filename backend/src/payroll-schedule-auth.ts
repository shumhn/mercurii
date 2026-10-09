import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { asAddress } from "./magicblock.ts";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function payrollScheduleMessage(operation: "create" | "update" | "launch", company: string,
  body: Record<string, unknown>): Uint8Array {
  const { signature: _signature, ...unsigned } = body;
  void _signature;
  const hash = createHash("sha256").update(JSON.stringify(stable(unsigned))).digest("hex");
  return Buffer.from(`Mercury payroll schedule v1\n${operation}\n${asAddress(company, "company")}\n${hash}`, "utf8");
}

export function verifyPayrollScheduleFounder(operation: "create" | "update" | "launch",
  company: string, founder: string, body: Record<string, unknown>, targetScheduleId?: string): void {
  if (asAddress(body.actor, "actor") !== founder) throw new Error("Founder must manage payroll schedules");
  if (targetScheduleId && body.scheduleId !== targetScheduleId) throw new Error("Signed schedule ID does not match URL");
  if (typeof body.signature !== "string") throw new Error("Founder schedule signature is required");
  let signature: Uint8Array;
  try { signature = bs58.decode(body.signature); } catch { throw new Error("Invalid Founder schedule signature"); }
  if (signature.length !== 64 || !nacl.sign.detached.verify(
    payrollScheduleMessage(operation, company, body), signature, new PublicKey(founder).toBytes())) {
    throw new Error("Invalid Founder schedule signature");
  }
}
