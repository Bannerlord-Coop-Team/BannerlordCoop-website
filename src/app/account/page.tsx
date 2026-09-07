import { linkPatreonAccount } from "@/app/account/actions";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Account | Bannerlord Coop",
};

export default async function AccountPage({
    searchParams,
}: {
    searchParams: Promise<{ patreon?: string }>;
}) {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/account");
    const { patreon } = await searchParams;
    const message = patreon === "linked"
        ? "Patreon account linked successfully."
        : patreon === "cancelled"
            ? "Patreon linking was cancelled. You can try again."
            : patreon === "error"
                ? "Could not link your Patreon account. Please try again. A Patreon account can only be linked to one site account."
                : null;

    return (
        <>
            <Navbar />
            <main className="min-h-[70svh] bg-background">
                <section className="site-container py-16 sm:py-20" aria-labelledby="account-heading">
                    <h1 id="account-heading" className="font-display text-4xl font-semibold text-foreground sm:text-5xl">
                        Account
                    </h1>
                    <div id="link-account" className="mt-8 scroll-mt-8">
                        <form action={linkPatreonAccount}>
                            <button
                                type="submit"
                                className="inline-flex min-h-12 items-center justify-center rounded-sm border border-crimson bg-crimson px-6 py-3 font-label text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                Link Patreon account
                            </button>
                        </form>
                        {message && <p role="status" className="mt-4 max-w-xl text-sm text-foreground-muted">{message}</p>}
                    </div>
                </section>
            </main>
            <Footer />
        </>
    );
}
