import { LoginForm } from "@/app/components/auth/LoginForm";
import { ArrowLeft, Swords } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Sign In",
    description: "Sign in to your Bannerlord Coop account.",
};

type LoginPageProps = {
    searchParams: Promise<{
        error?: string | string[];
        next?: string | string[];
    }>;
};

function firstValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
    const params = await searchParams;
    const initialError = firstValue(params.error);
    const nextPath = firstValue(params.next);

    return (
        <main className="relative min-h-svh overflow-hidden bg-background lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(30rem,0.95fr)]">
            <aside className="relative hidden min-h-svh overflow-hidden border-r border-white/10 lg:block">
                <Image
                    src="/images/singleleader.png"
                    alt="Bannerlord warrior overlooking a battlefield"
                    fill
                    priority
                    sizes="55vw"
                    className="object-cover object-[57%_center]"
                />
                <div aria-hidden="true" className="absolute inset-0 bg-black/15" />
                <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-linear-to-r from-background/75 via-background/10 to-background/45"
                />
                <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-linear-to-t from-background via-background/15 to-background/50"
                />
                <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[radial-gradient(circle_at_42%_62%,rgba(143,29,35,0.12),transparent_38%)]"
                />

                <Link
                    href="/"
                    className="absolute top-8 left-8 z-10 flex items-center gap-3 text-foreground transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold xl:top-10 xl:left-12"
                    aria-label="Bannerlord Coop home"
                >
                    <span className="flex size-10 items-center justify-center rounded-full border border-gold/35 bg-background/60 text-gold backdrop-blur-sm">
                        <Swords aria-hidden="true" className="size-5" strokeWidth={2.5} />
                    </span>
                    <span className="font-display text-lg font-semibold uppercase tracking-[0.12em]">
                        Bannerlord Coop
                    </span>
                </Link>

                <div className="absolute right-12 bottom-12 left-12 z-10 max-w-2xl xl:right-16 xl:bottom-16 xl:left-16">
                    <div className="mb-5 h-px w-16 bg-gold" />
                    <blockquote className="font-display text-3xl font-semibold leading-tight text-foreground xl:text-5xl">
                        “No banner rises alone.”
                    </blockquote>
                    <p className="mt-4 max-w-lg text-sm leading-6 text-foreground-muted xl:text-base xl:leading-7">
                        Gather your allies, reclaim your campaign, and continue the conquest together.
                    </p>
                </div>
            </aside>

            <section className="relative isolate flex min-h-svh flex-col bg-surface/95">
                <div className="absolute inset-0 z-0 lg:hidden">
                    <Image
                        src="/images/singleleader.png"
                        alt=""
                        fill
                        priority
                        sizes="100vw"
                        className="object-cover object-[62%_center] opacity-20"
                    />
                    <div className="absolute inset-0 bg-background/80" />
                    <div className="absolute inset-0 bg-linear-to-t from-background via-surface/90 to-background/65" />
                </div>

                <header className="relative z-10 flex min-h-20 items-center justify-between gap-4 px-5 sm:px-8 lg:justify-end lg:px-10 xl:px-14">
                    <Link
                        href="/"
                        className="flex items-center gap-2 text-foreground lg:hidden"
                        aria-label="Bannerlord Coop home"
                    >
                        <Swords aria-hidden="true" className="size-5 text-gold" strokeWidth={2.5} />
                        <span className="font-display text-sm font-semibold uppercase tracking-[0.1em]">
                            Bannerlord Coop
                        </span>
                    </Link>
                    <Link
                        href="/"
                        className="inline-flex min-h-10 items-center gap-2 rounded-sm px-2 font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground-muted transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        <ArrowLeft aria-hidden="true" className="size-4" />
                        <span className="hidden min-[380px]:inline">Back to home</span>
                    </Link>
                </header>

                <div className="relative z-10 flex flex-1 items-center px-5 py-8 sm:px-8 lg:px-12 lg:py-12 xl:px-20">
                    <div className="mx-auto w-full max-w-lg rounded-sm border border-white/10 bg-surface/90 p-6 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-9 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
                        <LoginForm initialError={initialError} nextPath={nextPath} />
                    </div>
                </div>

                <footer className="relative z-10 px-5 py-6 text-center font-label text-[0.65rem] uppercase tracking-[0.14em] text-foreground-muted sm:px-8 lg:px-12">
                    Secure access powered by encrypted authentication
                </footer>
            </section>
        </main>
    );
}
