"use client";

import React, { useState } from "react";
import { Copy, Check, ArrowRight } from "lucide-react";

export function CodeShowcase() {
  const [copied, setCopied] = useState(false);

  const rustCode = `#[ephemeral]
#[program]
pub mod mercury {
    use super::*;

    /// Execute private company payment via PDA-signed SPL Token CPI
    pub fn execute_payment(ctx: Context<ExecutePayment>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        require!(policy.private_ready, MercuryError::PrivacyNotActive);

        // Enforced inside MagicBlock PER enclave:
        // ACL restricts transaction logs & balances to authorized keys
        token::transfer(
            ctx.accounts.into_transfer_context(),
            request.amount_micro,
        )?;

        request.status = STATUS_EXECUTED;
        policy.spent_micro = policy.spent_micro.checked_add(request.amount_micro)?;
        Ok(())
    }
}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(rustCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="code" className="py-28 relative max-w-7xl mx-auto px-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Left Side: Headline & Copy */}
        <div className="lg:col-span-5 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.05] border border-white/10 text-xs font-mono text-emerald-400">
            <span>Solana Anchor + MagicBlock PER</span>
          </div>

          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.1]">
            Powerful and confidential. <br />
            <span className="text-zinc-400 font-normal">Just as you need.</span>
          </h2>

          <p className="text-base text-zinc-400 leading-relaxed">
            Every Mercurii account starts as an empty shell on Solana base, delegates to
            MagicBlock&apos;s Private Ephemeral Rollups, and locks down permissions before
            confidential state is written. One atomic PER transaction handles the check,
            SPL CPI transfer, and status update.
          </p>

          <div className="pt-2 flex items-center gap-4">
            <a
              href="https://explorer.solana.com/address/34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L?cluster=devnet"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 rounded-full bg-white text-black font-semibold text-xs tracking-tight hover:bg-zinc-200 transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.2)]"
            >
              <span>View Onchain IDL</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>

            <span className="text-xs font-mono text-zinc-500">
              3,165 Lines Rust Verified
            </span>
          </div>
        </div>

        {/* Right Side: Code Window (Matching MagicBlock.xyz exactly) */}
        <div className="lg:col-span-7">
          <div className="code-window rounded-2xl overflow-hidden">
            {/* Window Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] bg-[#0c0d14]">
              {/* Traffic light dots */}
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>

              {/* Center filename */}
              <span className="text-xs font-mono text-zinc-400">
                programs/mercury/src/lib.rs
              </span>

              {/* Right: Rust Pill & Copy button */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  rust
                </span>
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                  title="Copy Code"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Code Body */}
            <div className="p-6 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto text-zinc-300 bg-[#07080d]">
              <pre>
                <code>
                  <span className="text-emerald-400 font-semibold">#[ephemeral]</span>
                  {"\n"}
                  <span className="text-emerald-400 font-semibold">#[program]</span>
                  {"\n"}
                  <span className="text-purple-400 font-semibold">pub mod</span>{" "}
                  <span className="text-white font-bold">mercury</span> {"{\n"}
                  {"    "}
                  <span className="text-purple-400">use</span> super::*;
                  {"\n\n"}
                  {"    "}
                  <span className="text-zinc-500 italic">
                    {"/// Execute private company payment via PDA-signed SPL Token CPI"}
                  </span>
                  {"\n"}
                  {"    "}
                  <span className="text-purple-400 font-semibold">pub fn</span>{" "}
                  <span className="text-blue-400 font-semibold">execute_payment</span>(
                  {"\n"}
                  {"        "}ctx: Context&lt;ExecutePayment&gt;,
                  {"\n"}
                  {"    "}) -&gt; <span className="text-yellow-400">Result</span>&lt;()&gt; {"{\n"}
                  {"        "}
                  <span className="text-purple-400">let</span> policy = &amp;
                  <span className="text-purple-400">mut</span> ctx.accounts.policy;
                  {"\n"}
                  {"        "}require!(policy.private_ready, MercuryError::PrivacyNotActive);
                  {"\n\n"}
                  {"        "}
                  <span className="text-zinc-500 italic">
                    {"// Enforced inside MagicBlock PER enclave"}
                  </span>
                  {"\n"}
                  {"        "}token::
                  <span className="text-blue-400">transfer</span>(
                  {"\n"}
                  {"            "}ctx.accounts.into_transfer_context(),
                  {"\n"}
                  {"            "}request.amount_micro,
                  {"\n"}
                  {"        "})?;
                  {"\n\n"}
                  {"        "}request.status = STATUS_EXECUTED;
                  {"\n"}
                  {"        "}policy.spent_micro = policy.spent_micro.
                  <span className="text-blue-400">checked_add</span>(request.amount_micro)?;
                  {"\n"}
                  {"        "}
                  <span className="text-emerald-400">Ok</span>(())
                  {"\n"}
                  {"    }"}
                  {"\n"}
                  {"}"}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
