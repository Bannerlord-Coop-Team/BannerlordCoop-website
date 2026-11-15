import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
    title: { default: "Nightly Access", template: "%s | Nightly Access | Bannerlord Co-op" },
    // Transactional pages also set robots: noindex; only the landing page is meant for search.
    referrer: "no-referrer",
};

/** Wraps every /nightly page in the site's navigation and footer. */
export default function NightlyLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <Navbar />
            <main className="flex min-h-svh flex-col bg-background">{children}</main>
            <Footer />
        </>
    );
}
