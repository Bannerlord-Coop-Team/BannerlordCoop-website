import Image from "next/image";

export function Hero() {
    return (
        <section
            className="relative isolate flex min-h-[calc(100svh-60px)] overflow-hidden"
            aria-labelledby="hero-heading"
        >
            <Image
                src="/images/singleleader.png"
                alt=""
                fill
                priority
                sizes="100vw"
                className="-z-30 object-cover object-center"
            />

            <div aria-hidden="true" className="absolute inset-0 -z-20 bg-black/15" />
            <div aria-hidden="true" className="absolute inset-0 -z-20 bg-linear-to-r from-background via-background/85 to-background/15" />
            <div aria-hidden="true" className="absolute inset-0 -z-20 bg-linear-to-t from-background via-transparent to-background/35" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_22%_55%,rgba(143,29,35,0.18),transparent_34%)]" />

            <div className="site-container relative z-10 grid flex-1 items-center py-24 pb-36 lg:grid-cols-12">
                <div className="lg:col-span-11 lg:col-start-2">
                    <div className="max-w-4xl">
                        <p className="font-label text-sm font-semibold uppercase tracking-[0.24em] text-gold">
                            A Mount &amp; Blade II: Bannerlord Coop Module
                        </p>

                        <h1
                            id="hero-heading"
                            className="mt-6 font-display text-6xl font-semibold leading-[0.84] tracking-[-0.035em] text-foreground sm:text-7xl lg:text-8xl"
                        >
                            Rally The Warband.
                            <br />
                            Raise The Banner.
                            <br />
                            <span className="text-crimson">Conquer Calradia.</span>
                        </h1>

                    <p className="mt-8 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg sm:leading-8">
                            Experience the Bannerlord campaign with friends. Build
                            armies, manage kingdoms, trade, raid, and fight together
                            in one shared world.
                    </p>

                    <div className="mt-10 flex flex-wrap items-center gap-4">
                        <a
                            href="#download"
                            className="rounded-sm border border-crimson bg-crimson px-7 py-3.5 font-label text-sm font-semibold uppercase tracking-[0.16em] text-white transition-colors duration-300 hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                            Ride To Conquest
                        </a>

                        <a
                            href="https://discord.gg/bannerlordcoop"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-sm border border-white/20 bg-background/70 px-7 py-3.5 font-label text-sm font-semibold uppercase tracking-[0.16em] text-foreground transition-colors duration-300 hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                            Join the Discord
                        </a>
                    </div>
                    </div>
                </div>
            </div>
        </section>
    );
}