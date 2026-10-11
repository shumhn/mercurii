import React from "react";
import Image from "next/image";

export function Footer() {
  return (
    <footer id="resources" className="border-t border-black/[0.08] bg-[#F2F2F1] pt-20 pb-16">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 pb-16 border-b border-black/[0.06]">
          {/* Logo & Brand description */}
          <div className="col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <span className="relative block size-10 shrink-0">
                <Image
                  src="/mercurii-symbol-blue.png"
                  alt="Mercurii"
                  fill
                  sizes="40px"
                  className="object-contain"
                />
              </span>
              <span className="text-lg font-bold tracking-tight text-gray-950">
                Mercurii
              </span>
            </div>

            <p className="text-xs text-gray-600 max-w-sm leading-relaxed">
              Private financial operations for onchain teams. Receive, hold, and pay USDC
              under on-chain policy — confidentially.
            </p>

            <div className="pt-2">
              <span className="text-xs text-gray-500">
                Live on Solana devnet · Test funds only · Not audited
              </span>
            </div>
          </div>

          {/* Column 1: Product */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-900">
              Product
            </h4>
            <ul className="space-y-2 text-xs text-gray-600">
              <li><a href="#" className="hover:text-gray-950">Private Treasury</a></li>
              <li><a href="#" className="hover:text-gray-950">Private Payroll</a></li>
              <li><a href="#" className="hover:text-gray-950">Team Permissions</a></li>
              <li><a href="#" className="hover:text-gray-950">Agent Budgets</a></li>
              <li><a href="#" className="hover:text-gray-950">Audit Shares</a></li>
            </ul>
          </div>

          {/* Column 2: Teams */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-900">
              Teams
            </h4>
            <ul className="space-y-2 text-xs text-gray-600">
              <li><a href="#" className="hover:text-gray-950">Solana Startups</a></li>
              <li><a href="#" className="hover:text-gray-950">Crypto Agencies</a></li>
              <li><a href="#" className="hover:text-gray-950">Remote Teams</a></li>
              <li><a href="#" className="hover:text-gray-950">AI-Native Businesses</a></li>
            </ul>
          </div>

          {/* Column 3: Resources */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-900">
              Resources
            </h4>
            <ul className="space-y-2 text-xs text-gray-600">
              <li><a href="#" className="hover:text-gray-950">Documentation</a></li>
              <li><a href="#" className="hover:text-gray-950">Live Devnet Proof</a></li>
              <li><a href="#" className="hover:text-gray-950">Privacy Model</a></li>
              <li><a href="#" className="hover:text-gray-950">Trust Assumptions</a></li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright row */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <div>© 2026 Mercurii. Confidential and permissioned — not anonymous.</div>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-gray-800">Privacy Policy</a>
            <a href="#" className="hover:text-gray-800">Terms of Service</a>
            <a href="#" className="hover:text-gray-800">Security &amp; Compliance</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
