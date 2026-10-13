"use client";

import React from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function DevnetProofs() {
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const proofs = [
    {
      title: "Anchor Smart Contract",
      label: "Program ID",
      value: "34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L",
      link: "https://explorer.solana.com/address/34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L?cluster=devnet",
      status: "Deployed (v1.52 SBF)",
    },
    {
      title: "Circle Devnet USDC Vault",
      label: "Company Policy PDA",
      value: "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW",
      link: "https://explorer.solana.com/address/362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW?cluster=devnet",
      status: "Active & Delegated",
    },
    {
      title: "Batch Payroll Approval Proof",
      label: "PER Transaction · finalized at MagicBlock slot 476577461",
      value: "56EJD3KHVV36bGZ4MAZDhiMjiJ9wL13HcH4ws78j5avg7HN4DweChg2tUsCUfbaPMjJMU6ybjx3WhnDWxiNTTP7A",
      link: "https://explorer.solana.com/tx/56EJD3KHVV36bGZ4MAZDhiMjiJ9wL13HcH4ws78j5avg7HN4DweChg2tUsCUfbaPMjJMU6ybjx3WhnDWxiNTTP7A?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app",
      status: "9/9 Items Settled",
    },
    {
      title: "Autonomous Agent Spend Proof",
      label: "PER Float Spend · finalized at MagicBlock slot 468306306",
      value: "36iv6JU7B2a2YSxVKpn9Z6bh4B7N7nHWmw7fPV1dBikTcc6MYTgYV21mn71C16bZD3Ebfq9UPhQqW7QjbLdXJvWz",
      link: "https://explorer.solana.com/tx/36iv6JU7B2a2YSxVKpn9Z6bh4B7N7nHWmw7fPV1dBikTcc6MYTgYV21mn71C16bZD3Ebfq9UPhQqW7QjbLdXJvWz?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app",
      status: "1,000 Micro USDC Bounded",
    },
  ];

  return (
    <section id="proofs" className="py-20 relative max-w-5xl mx-auto px-4">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <Badge variant="success" dot className="mb-3">
          Onchain Verifiable
        </Badge>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-white">
          Live Solana Devnet Verification
        </h2>
        <p className="mt-3 text-sm sm:text-base text-zinc-400">
          Every capability is backed by live onchain proofs deployed on Solana Devnet with Circle
          USDC and MagicBlock TEE rollups.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {proofs.map((proof, idx) => (
          <div
            key={idx}
            className="p-5 rounded-2xl glass-panel border border-white/10 hover:border-white/20 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-white tracking-tight">
                  {proof.title}
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  {proof.status}
                </span>
              </div>
              <span className="text-[11px] font-mono text-zinc-500">{proof.label}</span>
              <div className="mt-1 flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/80 border border-white/5">
                <span className="font-mono text-xs text-zinc-300 truncate max-w-[260px] sm:max-w-[320px]">
                  {proof.value}
                </span>
                <button
                  onClick={() => copyToClipboard(proof.value, idx)}
                  className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                  title="Copy address"
                >
                  {copiedIndex === idx ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
              <span className="text-zinc-500 font-mono text-[11px]">Solana Devnet</span>
              <a
                href={proof.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <span>View on Explorer</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
