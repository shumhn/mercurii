import { Navbar } from "@/components/sections/navbar";
import { Hero } from "@/components/sections/hero";
import { SocialProof } from "@/components/sections/social-proof";
import { FounderStory } from "@/components/sections/founder-story";
import { BusinessAccount } from "@/components/sections/business-account";
import { OperationalComparison } from "@/components/sections/operational-comparison";
import { TeamControl } from "@/components/sections/team-control";
import { AgentControl } from "@/components/sections/agent-control";
import { GlobalPayments } from "@/components/sections/global-payments";
import { IncorporationPath } from "@/components/sections/incorporation-path";
import { FAQs } from "@/components/sections/faqs";
import { CtaBanner } from "@/components/sections/cta-banner";
import { Footer } from "@/components/sections/footer";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#F2F2F1] text-gray-950 font-sans selection:bg-blue-600/10 selection:text-blue-900">
      {/* Request Finance Navbar */}
      <Navbar />

      {/* Hero section with exact 3-tier headline, buttons, and app window mockup */}
      <Hero />

      {/* Social proof logos */}
      <SocialProof />

      {/* Founder problem story */}
      <FounderStory />

      {/* The Foundation: Business Account & Multi-currency Flow */}
      <BusinessAccount />

      {/* From blocked to operational comparison section */}
      <OperationalComparison />

      {/* Global payments reaching everywhere you operate */}
      <GlobalPayments />

      {/* Role-based company controls */}
      <TeamControl />

      {/* Safe AI assistant and bounded agent spending */}
      <AgentControl />

      {/* A clear path from incorporation to getting paid */}
      <IncorporationPath />

      {/* FAQs Section */}
      <FAQs />

      {/* CTA Banner in Signature Blue */}
      <CtaBanner />

      {/* Footer */}
      <Footer />
    </main>
  );
}
