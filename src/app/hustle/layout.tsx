import type { Metadata } from "next";
import HustleNav from "@/components/hustle/HustleNav";
import AgentAutoRun from "@/components/hustle/AgentAutoRun";

export const metadata: Metadata = {
  title: "副業パイプライン - 稼ぐための作業を自動化する",
  description:
    "市場調査に基づいて現実的な副業を選び、案件の判定・提案文・コンテンツ生成を自動化し、実効時給で撤退判断まで行うツール",
};

export default function HustleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AgentAutoRun />
      <HustleNav />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
