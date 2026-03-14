import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VideoSOP Pro - 動画から作業標準書を自動生成",
  description:
    "工作機械の検査・組立・メンテナンス作業の動画から、AIが自動的に作業標準書（SOP）を生成するプラットフォーム",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
