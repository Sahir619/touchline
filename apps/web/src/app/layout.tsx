import type { Metadata, Viewport } from "next";
import { Saira, Saira_Condensed } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Body / UI face — exposed as --font-sans
const saira = Saira({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Display face — scores, odds, headlines — exposed as --font-display
const sairaCondensed = Saira_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Touchline",
  title: {
    default: "Touchline: call it before your mates do",
    template: "%s · Touchline",
  },
  description:
    "A free-to-play World Cup prediction game on Solana. Make your calls on live odds, a live AI pundit reacts to yours, and you climb the table to prove you called it before your mates. Not betting, just bragging rights, on record.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Touchline",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "Touchline",
    title: "Touchline: call it before your mates do",
    description:
      "Make your calls on live World Cup odds, a live AI pundit reacts to yours, climb the table and prove you called it. Free to play on Solana.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Touchline: call it before your mates do",
    description:
      "Make your calls on live World Cup odds, a live AI pundit reacts to yours, climb the table and prove you called it. Free to play on Solana.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0E15",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${saira.variable} ${sairaCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
