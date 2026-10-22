import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"], weight: ["500", "600"] });

export const metadata: Metadata = {
  title: { default: "ZecWise — Your guide to everything Zcash", template: "%s · ZecWise" },
  description: "ZecWise is an AI research assistant for Zcash: shielded transactions, wallets, protocol upgrades, the ecosystem and more, with real, clickable sources.",
};

export const viewport: Viewport = { themeColor: "#143528", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
