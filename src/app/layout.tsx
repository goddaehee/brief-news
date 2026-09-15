import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Noto_Sans_KR } from "next/font/google";
import { Toaster } from "sonner";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import "./globals.css";

const sans = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
  preload: true,
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:8080";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "brief_ — 실시간 AI 뉴스",
    template: "%s — brief_",
  },
  description:
    "AI 업계 소식을 실시간으로. 속보·중요·참고 자동 분류와 한 줄 시사점 — 한국 AI 실무자를 위한 뉴스 터미널.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "brief_",
    description: "실시간 AI 뉴스",
    images: ["/og.jpg"],
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "brief_ — 실시간 AI 뉴스",
    description: "한국 AI 실무자를 위한 뉴스 터미널",
    images: ["/og.jpg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg font-sans text-fg">
        <PreviewHostBridge />
        {children}
        <Toaster
          theme="dark"
          position="bottom-center"
          toastOptions={{
            style: {
              background: "#0d1117",
              border: "1px solid #30363d",
              color: "#c9d1d9",
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              fontSize: 12,
            },
          }}
        />
      </body>
    </html>
  );
}
