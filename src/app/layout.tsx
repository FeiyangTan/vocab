import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** 英文内容的衬线体（`font-serif`）。UI 外壳仍用 Geist —— 整站衬线会显得旧 */
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "vocab",
  description: "个人英语单词记录与复习",
  // iPhone「添加到主屏」后以独立 App 形式全屏运行，没有 Safari 的地址栏
  appleWebApp: { capable: true, title: "vocab", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // 亮暗两套底色都要给 —— 只给一个值的话，另一套下 iOS 的状态栏底色会和页面对不上
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#14120f" },
  ],
  // 防止 iOS 上输入框聚焦时整页缩放
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
