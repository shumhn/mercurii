import React from "react";
import { ArrowRight, CheckCircle2, Shield, Zap, Globe, FileText, CreditCard } from "lucide-react";

export function FeaturesGrid() {
  const features = [
    {
      title: "Accounts Payable",
      subtitle: "Simplify invoice processing from receipt to payment",
      description:
        "Import invoices via email or API. Pay one or hundreds of bills in one click using stablecoins or local fiat currency without manual errors.",
      tag: "Payables",
    },
    {
      title: "Mass Payouts & Payroll",
      subtitle: "Pay teams and contractors worldwide in minutes",
      description:
        "Upload CSV rosters or automate recurring payroll. Disburse USDC and local currencies directly to employee wallets or bank accounts with real-time settlement.",
      tag: "Payroll",
    },
    {
      title: "Granular Spending Controls",
      subtitle: "Multi-tier approval workflows tailored to your org",
      description:
        "Assign custom spending caps, manager approval thresholds, and vendor whitelists. Ensure every outbound transfer is verified before execution.",
      tag: "Governance",
    },
    {
      title: "Accounting & Compliance",
      subtitle: "Seamless reconciliation with major accounting software",
      description:
        "Automate bookkeeping with real-time sync to QuickBooks, Xero, and Netsuite. Export audit-ready tax and financial reports with full chain receipts.",
      tag: "Reconciliation",
    },
  ];

  return (
    <section className="py-24 max-w-7xl mx-auto px-6 lg:px-8">
      <div className="max-w-3xl mb-16">
        <span className="text-xs font-semibold text-[#0b44fe] uppercase tracking-wider">
          Enterprise Financial Operations
        </span>
        <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight text-gray-950 mt-3 leading-tight">
          Everything you need to run global business finance.
        </h2>
        <p className="mt-4 text-base text-gray-600">
          Eliminate manual spreadsheet payments, banking delays, and cross-border currency conversion fees.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {features.map((feature, idx) => (
          <div
            key={idx}
            className="p-8 rounded-2xl bg-white border border-gray-200/80 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-[#0b44fe]">
                  {feature.tag}
                </span>
                <span className="text-xs font-mono text-gray-400">0{idx + 1}</span>
              </div>

              <h3 className="text-xl sm:text-2xl font-semibold text-gray-950 tracking-tight">
                {feature.title}
              </h3>
              <p className="text-sm font-medium text-gray-500 mt-1 mb-3">
                {feature.subtitle}
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                {feature.description}
              </p>
            </div>

            <div className="mt-8 pt-4 border-t border-gray-100 flex items-center justify-between">
              <a
                href="#learn-more"
                className="text-xs font-semibold text-[#0b44fe] hover:text-[#0038df] inline-flex items-center gap-1"
              >
                <span>Learn more</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
