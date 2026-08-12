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
                className="-z-30 object-cover object-[62%_center] sm:object-center"
            />

            <div aria-hidden="true" className="absolute inset-0 -z-20 bg-black/15" />
            <div aria-hidden="true" className="absolute inset-0 -z-20 bg-linear-to-r from-background via-background/85 to-background/15" />
            <div aria-hidden="true" className="absolute inset-0 -z-20 bg-linear-to-t from-background via-transparent to-background/35" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_22%_55%,rgba(143,29,35,0.18),transparent_34%)]" />

            <div className="site-container relative z-10 grid flex-1 items-center py-16 sm:py-20 lg:grid-cols-12 lg:py-24 2xl:py-32">
                <div className="flex justify-center lg:col-span-11 lg:col-start-2 lg:block">
                    <div className="max-w-sm text-center sm:max-w-2xl lg:max-w-4xl lg:text-left">
                        <p className="mx-auto max-w-xs font-label text-xs font-semibold uppercase tracking-[0.18em] text-gold sm:max-w-none sm:text-sm sm:tracking-[0.24em] lg:mx-0">
                            A Mount &amp; Blade II: Bannerlord Coop Module
                        </p>

                        <h1
                            id="hero-heading"
                            className="mt-5 font-display text-4xl font-semibold leading-[0.8] tracking-tight text-foreground min-[380px]:text-5xl sm:mt-6 sm:text-6xl md:text-7xl lg:text-8xl 2xl:text-8xl"
                        >
                            Rally The Warband.
                            <br />
                            Raise The Banner.
                            <br />
                            <span className="text-crimson">Conquer Calradia.</span>
                        </h1>

                        <p className="mx-auto mt-6 max-w-2xl font-sans text-sm leading-6 text-foreground-muted sm:mt-8 sm:text-lg sm:leading-8 lg:mx-0">
                            Experience the Bannerlord campaign with friends. Build
                            armies, manage kingdoms, trade, raid, and fight together
                            in one shared world.
                        </p>

                        <div className="mt-8 flex flex-col items-center gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-4 lg:justify-start">
                        <a
                            href="#download"
                            className="inline-flex min-h-12 items-center justify-center rounded-sm border border-crimson bg-crimson px-6 py-3 font-label text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors duration-300 hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-7 sm:py-3.5 sm:tracking-[0.16em]"
                        >
                            Ride To Conquest
                        </a>

                        <a
                            href="https://discord.gg/bannerlordcoop"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-12 items-center justify-center rounded-sm border border-white/20 bg-background/70 px-6 py-3 font-label text-sm font-semibold uppercase tracking-[0.14em] text-foreground transition-colors duration-300 hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-7 sm:py-3.5 sm:tracking-[0.16em]"
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