import type { Metadata } from "next";
import { MercuriiApp } from "@/components/app/mercurii-app";

export const metadata: Metadata = {
  title: "Mercurii Private Finance",
  description: "Mercurii private stablecoin operations workspace.",
};

export default function WorkspacePage() {
  return <MercuriiApp />;
}
