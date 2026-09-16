import { ArrowLeft, Server, Swords } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
    return (
        <main className="relative isolate flex min-h-svh overflow-hidden bg-background">
            <Image
                src="/images/notfound.png"
                alt=""
                fill
                priority
                sizes="100vw"
                className="object-cover object-[58%_center] opacity-30"
            />

            <div aria-hidden="true" className="absolute inset-0 bg-linear-to-r from-background via-background/70 to-background/55"/>
            <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-background via-transparent to-background/60"/>
            <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_28%_48%,rgba(143,29,35,0.16),transparent_38%)]"/>

            <div className="site-container relative z-10 flex min-h-svh flex-col">
                <header className="flex min-h-20 items-center sm:min-h-24">
                    <Link
                        href="/"
                        aria-label="Bannerlord Coop home"
                        className="inline-flex items-center gap-3 text-foreground transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                    >
                        <span className="flex items-center justify-center rounded-full bg-background/60 text-gold backdrop-blur-sm">
                            <Swords
                                aria-hidden="true"
                                className="size-5"
                                strokeWidth={3}
                            />
                        </span>

                        <span className="font-display font-semibold uppercase tracking-[0.12em] sm:text-lg">
                            Bannerlord Coop
                        </span>
                    </Link>
                </header>

                <section className="flex flex-1 items-center py-12 sm:py-16">
                    <div className="max-w-2xl">
                        <p className="font-label text-sm font-semibold uppercase tracking-[0.28em] text-gold">
                            Error 404
                        </p>

                        <div aria-hidden="true" className="mt-5 h-px w-16 bg-gold"/>

                        <h1 className="mt-7 font-display text-5xl font-semibold leading-[0.95] text-foreground sm:text-7xl lg:text-8xl">
                            No page to be displayed.
                        </h1>

                        <p className="mt-6 max-w-xl text-base leading-7 text-foreground-muted sm:text-lg sm:leading-8">
                            The page you were looking for may have moved, been
                            removed, or never existed. Return to familiar
                            territory or continue to the server directory.
                        </p>

                        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                            <Link
                                href="/"
                                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-sm bg-crimson/30 border border-crimson/30 px-6 font-label text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                <ArrowLeft
                                    aria-hidden="true"
                                    className="size-4"
                                />
                                Return home
                            </Link>

                            <Link
                                href="/servers"
                                prefetch={false}
                                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-sm border border-white/20 bg-background/30 px-6 font-label text-sm font-semibold uppercase tracking-[0.14em] text-foreground backdrop-blur-sm transition-colors hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                <Server
                                    aria-hidden="true"
                                    className="size-4"
                                />
                                Browse servers
                            </Link>
                        </div>
                    </div>
                </section>

                <footer className="py-6 font-label text-[0.65rem] uppercase tracking-[0.16em] text-foreground-dim sm:py-8">
                    No banner rises without friends
                </footer>
            </div>
        </main>
    );
}