import type { Metadata } from "next";
import { Barlow_Condensed, Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});


export const metadata: Metadata = {
  metadataBase: new URL("https://bannerlordcoop.com"),

  title: {
    default: "Bannerlord Coop",
    template: "%s | Bannerlord Coop",
  },

  description: "Play the Mount & Blade II: Bannerlord campaign with friends in a shared multiplayer world.",

  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Bannerlord Coop",
    title: "Bannerlord Coop",
    description: "Play the Mount & Blade II: Bannerlord campaign with friends in a shared multiplayer world.",
    images: [
      {
        url: "/images/banner.png",
        width: 1080,
        height: 1080,
        alt: "Bannerlord Coop",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "Bannerlord Coop",
    description: "Play the Mount & Blade II: Bannerlord campaign with friends in a shared multiplayer world.",
    images: ["/images/banner.png"],
  }
};


export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${cormorantGaramond.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
