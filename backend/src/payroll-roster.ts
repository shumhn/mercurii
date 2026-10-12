import { PublicKey } from "@solana/web3.js";
import { asAddress } from "./magicblock.ts";

export type RosterIssue = { row: number | null; message: string };
export type RosterItem = { row: number; recipient: string; amountMicro: number; label: string | null;
  cadence?: "weekly" | "biweekly" | "monthly"; firstPayDate?: string };
export type RosterPreview = { items: RosterItem[]; errors: RosterIssue[]; totalMicro: string; canCreateRun: boolean };

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else field += char;
      continue;
    }
    if (char === '"') {
      if (field !== "" || closedQuote) throw new Error("Malformed CSV quote");
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      closedQuote = false;
      if (char !== ",") {
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else {
      if (closedQuote && char !== " " && char !== "\t") throw new Error("Malformed CSV quote");
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

export function previewPayrollCsv(input: unknown): RosterPreview {
  if (typeof input !== "string" || input.length > 64_000) throw new Error("csvText must be a CSV string under 64 KB");
  const rows = csvRows(input.replace(/^\uFEFF/, ""));
  if (rows.length === 0) throw new Error("Payroll CSV is empty");
  if (rows.length > 101) throw new Error("Payroll CSV exceeds 100 employees");
  const headers = rows[0]!.map((value) => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error("Payroll CSV has duplicate headers");
  const walletIndex = headers.findIndex((value) => ["wallet", "wallet_address", "recipient", "address"].includes(value));
  const amountIndex = headers.findIndex((value) => ["amount_usdc", "amount"].includes(value));
  const labelIndex = headers.findIndex((value) => ["name", "label"].includes(value));
  const cadenceIndex = headers.findIndex((value) => value === "cadence");
  const firstDateIndex = headers.findIndex((value) => ["first_pay_date", "firstpaydate"].includes(value));
  if ((cadenceIndex < 0) !== (firstDateIndex < 0)) {
    throw new Error("Individual payroll needs both cadence and first_pay_date columns");
  }
  if (walletIndex < 0 || amountIndex < 0) throw new Error("Payroll CSV needs wallet and amount_usdc columns");
  const items: RosterItem[] = [];
  const errors: RosterIssue[] = [];
  const seen = new Set<string>();
  let total = 0n;
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index]!;
    const rowNumber = index + 1;
    if (row.length !== headers.length) {
      errors.push({ row: rowNumber, message: "Column count does not match the header" });
      continue;
    }
    let recipient: string;
    try {
      recipient = asAddress(row[walletIndex]?.trim(), "wallet");
      if (!PublicKey.isOnCurve(new PublicKey(recipient).toBytes())) throw new Error("Wallet must have an owner key");
    } catch {
      errors.push({ row: rowNumber, message: "Invalid employee wallet" });
      continue;
    }
    if (seen.has(recipient)) {
      errors.push({ row: rowNumber, message: "Duplicate employee wallet" });
      continue;
    }
    seen.add(recipient);
    const amount = row[amountIndex]?.trim() ?? "";
    if (!/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount)) {
      errors.push({ row: rowNumber, message: "Amount must be positive USDC with at most 6 decimals" });
      continue;
    }
    const [whole, fraction = ""] = amount.split(".");
    const micro = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
    if (micro <= 0n || micro > BigInt(Number.MAX_SAFE_INTEGER) || total + micro > BigInt(Number.MAX_SAFE_INTEGER)) {
      errors.push({ row: rowNumber, message: "Amount or roster total is outside supported range" });
      continue;
    }
    const label = labelIndex < 0 ? null : row[labelIndex]?.trim() || null;
    if (label && label.length > 80) {
      errors.push({ row: rowNumber, message: "Name is too long" });
      continue;
    }
    let cadence: RosterItem["cadence"];
    let firstPayDate: string | undefined;
    if (cadenceIndex >= 0) {
      const value = row[cadenceIndex]?.trim().toLowerCase();
      if (value !== "weekly" && value !== "biweekly" && value !== "monthly") {
        errors.push({ row: rowNumber, message: "Cadence must be weekly, biweekly, or monthly" });
        continue;
      }
      cadence = value;
      firstPayDate = row[firstDateIndex]?.trim();
      const date = firstPayDate && /^\d{4}-\d{2}-\d{2}$/.test(firstPayDate)
        ? new Date(`${firstPayDate}T00:00:00.000Z`) : null;
      if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== firstPayDate) {
        errors.push({ row: rowNumber, message: "first_pay_date must be a valid YYYY-MM-DD date" });
        continue;
      }
    }
    total += micro;
    items.push({ row: rowNumber, recipient, amountMicro: Number(micro), label,
      ...(cadence ? { cadence, firstPayDate } : {}) });
  }
  return { items, errors, totalMicro: total.toString(),
    canCreateRun: errors.length === 0 && items.length >= 1 && items.length <= 100 };
}
