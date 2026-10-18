import type { Metadata } from "next";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { getLocale, getMessages, getOpenGraphLocale, getTranslations } from "@/app/lib/localization/server";
import { getEnabledLocales } from "@/app/lib/localization/registry";
import { ImpersonationBanner } from "@/app/components/admin/ImpersonationBanner";
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


/** Resolves shared metadata from the same explicit locale cookie as the root document. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations("common");
  return {
  metadataBase: new URL("https://bannerlordcoop.com"),

  title: {
    default: "Bannerlord Coop",
    template: "%s | Bannerlord Coop",
  },

  description: t("metadata.description"),

  openGraph: {
    type: "website",
    locale: await getOpenGraphLocale(),
    siteName: "Bannerlord Coop",
    title: "Bannerlord Coop",
    description: t("metadata.description"),
    images: [
      {
        url: "/images/banner.png",
        width: 1200,
        height: 630,
        alt: "Bannerlord Coop",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "Bannerlord Coop",
    description: t("metadata.description"),
    images: ["/images/banner.png"],
  }
  };
}

/** Delivers only common messages globally; page providers own all page namespace payloads. */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages(["common"], locale);
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${cormorantGaramond.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LocalizationProvider locale={locale} messages={messages} enabledLocales={getEnabledLocales()}>
          <ImpersonationBanner />{children}
        </LocalizationProvider>
      </body>
    </html>
  );
}
