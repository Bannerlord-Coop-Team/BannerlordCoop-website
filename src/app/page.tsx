export default function Home() {
    return (
        <main className="site-container py-24">
            <div className="max-w-4xl">
                <p className="font-label text-sm font-semibold uppercase tracking-[0.2em] text-gold">
                    Bannerlord Coop
                </p>

                <h1 className="mt-5 font-display text-6xl font-semibold leading-[0.9] tracking-[-0.025em] text-foreground md:text-8xl">
                    Fight with your Friends, Conquer Together
                </h1>

                <p className="mt-8 max-w-2xl font-sans text-lg leading-8 text-foreground-muted">
                    Create friendships, command armies, and shape a shared campaign
                    alongside your fellow warriors.
                </p>

                <div className="mt-14 border-t border-white/10 pt-8">
                    <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-foreground-dim">
                        Realm status
                    </p>

                    <p className="mt-2 font-label text-4xl font-semibold tabular-nums text-foreground">
                        34,769 Warriors
                    </p>
                </div>
            </div>
        </main>
    );
}
