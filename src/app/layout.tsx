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

/** The serif for English content (`font-serif`). The UI shell stays on Geist — serif
 *  everywhere would read as dated */
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "vocab",
  description: "Capture and review English vocabulary",
  // After iPhone's "Add to Home Screen" it runs full-screen as its own app, with no Safari
  // address bar
  appleWebApp: { capable: true, title: "vocab", statusBarStyle: "black-translucent" },
  other: {
    /*
     * 🔴 Written by hand, because `appleWebApp.capable` above **does not emit it**.
     *
     * Next 16 renders capable as `<meta name="mobile-web-app-capable">` (the standard name
     * Chrome pushed), while WebKit to this day only recognises the `apple-` prefixed one —
     * both names have to be present.
     *
     * iOS 15.4+ actually goes full-screen from the manifest's `display: standalone` too, so
     * newer systems don't need this; it stays as a fallback for older ones, at a cost of one
     * line.
     */
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  // Both light and dark colours are required — with only one, iOS's status bar tint won't
  // match the page under the other scheme
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#14120f" },
  ],
  // Stops iOS zooming the whole page when an input takes focus
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
