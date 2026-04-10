import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "院內碼查詢系統",
  description: "南區醫療產品院內碼快速查詢平台，支援院內碼、批價碼、型號與關鍵字搜尋。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
