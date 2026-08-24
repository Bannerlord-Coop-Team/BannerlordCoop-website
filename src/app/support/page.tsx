import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Support Bannerlord Coop | Bannerlord Coop",
    description:
        "Support the volunteer team behind Bannerlord Coop through Patreon, Buy Me a Coffee, PayPal, Afdian, or Boosty.",
};

const supportOptions = [
    {
        name: "Patreon",
        descriptor: "Become a monthly supporter",
        href: "https://www.patreon.com/c/bannerlordcoop",
    },
    {
        name: "Buy Me a Coffee",
        descriptor: "Send a one-time contribution",
        href: "https://buymeacoffee.com/bannerlordcoop",
    },
    {
        name: "PayPal",
        descriptor: "Donate directly",
        href: "https://www.paypal.com/donate/?hosted_button_id=KHBSK4FXQ9GKS",
    },
    {
        name: "Afdian",
        descriptor: "Support us from China",
        href: "https://ifdian.net/a/BannerlordCoop",
    },
    {
        name: "Boosty",
        descriptor: "Additional international support option",
        href: "https://boosty.to/bannerlordcoop/donate",
    },
] as const;

const projectExpenses = [
    {
        label: "Development tools",
        detail: "Software and services used to build, test, and maintain the mod.",
    },
    {
        label: "Hosting infrastructure",
        detail: "Reliable services that keep project resources available.",
    },
    {
        label: "Dedicated servers",
        detail: "Stable environments for development, testing, and the community.",
    },
    {
        label: "Distribution costs",
        detail: "The systems needed to deliver updates to players.",
    },
    {
        label: "Other expenses",
        detail: "Practical project costs that help the volunteer team keep moving.",
    },
] as const;

const otherWaysToHelp = [
    "Play the mod",
    "Report bugs",
    "Create content",
    "Share Bannerlord Coop",
] as const;

export default function SupportPage() {
    return (
        <>
            <Navbar />
            <main className="min-h-svh bg-background">
                <section
                    className="relative isolate overflow-hidden border-b border-white/10"
                    aria-labelledby="support-heading"
                >
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_78%_32%,rgba(170,151,96,0.11),transparent_28%),radial-gradient(circle_at_18%_90%,rgba(143,29,35,0.1),transparent_30%)]"
                    />
                    <div className="site-container grid gap-10 py-16 sm:py-20 lg:grid-cols-12 lg:items-end lg:gap-12 lg:py-24">
                        <div className="lg:col-span-8">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.24em] text-gold">
                                Support the project
                            </p>
                            <h1
                                id="support-heading"
                                className="mt-4 max-w-4xl font-display text-5xl font-semibold leading-[0.95] text-foreground sm:text-6xl lg:text-7xl"
                            >
                                Support Bannerlord Coop
                            </h1>
                            <p className="mt-6 max-w-2xl font-display text-2xl leading-8 text-foreground sm:text-3xl sm:leading-10">
                                Built by volunteers. Always free.
                            </p>
                            <p className="mt-5 max-w-2xl text-sm leading-7 text-foreground-muted sm:text-base">
                                Bannerlord Coop is developed by a volunteer team and
                                will always be available for free. Contributions help
                                us sustain the work behind the shared campaign, never
                                gate access to it.
                            </p>
                        </div>

                        <aside className="border-l-2 border-gold bg-gold/[0.06] px-6 py-6 lg:col-span-4 lg:px-7 lg:py-8">
                            <span
                                aria-hidden="true"
                                className="block size-5 rotate-45 border border-gold/60 bg-gold/10"
                            />
                            <p className="mt-5 font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                                Community sustained
                            </p>
                            <p className="mt-3 font-display text-2xl font-semibold leading-8 text-foreground">
                                Every contribution gives the team more room to build.
                            </p>
                        </aside>
                    </div>
                </section>

                <section
                    className="border-b border-white/10 bg-surface"
                    aria-labelledby="expenses-heading"
                >
                    <div className="site-container py-14 sm:py-18 lg:py-20">
                        <div className="max-w-3xl">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                                Where support goes
                            </p>
                            <h2
                                id="expenses-heading"
                                className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl"
                            >
                                Keeping the campaign running
                            </h2>
                            <p className="mt-4 text-sm leading-7 text-foreground-muted sm:text-base">
                                Support helps cover development tools, hosting
                                infrastructure, dedicated servers, distribution costs,
                                and other project expenses.
                            </p>
                        </div>

                        <ul className="mt-10 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
                            {projectExpenses.map((expense) => (
                                <li
                                    key={expense.label}
                                    className="bg-surface-raised px-5 py-6 sm:px-6"
                                >
                                    <span
                                        aria-hidden="true"
                                        className="block size-2 rotate-45 bg-gold-muted"
                                    />
                                    <h3 className="mt-5 font-display text-xl font-semibold text-foreground">
                                        {expense.label}
                                    </h3>
                                    <p className="mt-2 text-sm leading-6 text-foreground-muted">
                                        {expense.detail}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                <section
                    className="site-container py-16 sm:py-20 lg:py-24"
                    aria-labelledby="platforms-heading"
                >
                    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
                        <div className="max-w-3xl">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                                Choose what works for you
                            </p>
                            <h2
                                id="platforms-heading"
                                className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl"
                            >
                                Support platforms
                            </h2>
                        </div>
                        <p className="max-w-md text-sm leading-6 text-foreground-muted lg:text-right">
                            Each option supports the same volunteer project. Choose
                            whichever platform is most convenient for you.
                        </p>
                    </div>

                    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {supportOptions.map((option, index) => (
                            <article
                                key={option.name}
                                className="group flex min-w-0 flex-col border border-white/10 bg-surface p-6 transition-colors hover:border-gold/35 sm:p-7"
                            >
                                <div className="flex items-start justify-between gap-5">
                                    <span className="flex size-11 shrink-0 items-center justify-center border border-gold/30 bg-gold/[0.06]">
                                        <span
                                            aria-hidden="true"
                                            className="size-2 rotate-45 bg-gold"
                                        />
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className="font-label text-xs font-semibold tracking-[0.16em] text-foreground-dim"
                                    >
                                        {String(index + 1).padStart(2, "0")}
                                    </span>
                                </div>

                                <h3 className="mt-8 font-display text-3xl font-semibold text-foreground">
                                    {option.name}
                                </h3>
                                <p className="mt-2 min-h-12 text-sm leading-6 text-foreground-muted">
                                    {option.descriptor}
                                </p>

                                <a
                                    href={option.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-7 inline-flex min-h-12 w-full items-center justify-between gap-3 border border-crimson bg-crimson/10 px-4 font-label text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:border-crimson-hover hover:bg-crimson hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                                >
                                    <span>Support on {option.name}</span>
                                    <span
                                        aria-hidden="true"
                                        className="shrink-0 text-base leading-none"
                                    >
                                        ↗
                                    </span>
                                    <span className="sr-only">
                                        (opens in a new tab)
                                    </span>
                                </a>
                            </article>
                        ))}
                    </div>
                </section>

                <section
                    className="border-t border-white/10 bg-surface"
                    aria-labelledby="other-support-heading"
                >
                    <div className="site-container py-16 sm:py-20">
                        <div className="grid overflow-hidden border border-gold/20 bg-background lg:grid-cols-12">
                            <div className="border-b border-gold/20 px-6 py-8 sm:px-10 sm:py-10 lg:col-span-7 lg:border-r lg:border-b-0 lg:px-12 lg:py-12">
                                <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                                    Every kind of support matters
                                </p>
                                <h2
                                    id="other-support-heading"
                                    className="mt-3 font-display text-4xl font-semibold leading-tight text-foreground sm:text-5xl"
                                >
                                    Financial support is completely optional.
                                </h2>
                                <p className="mt-5 max-w-2xl text-sm leading-7 text-foreground-muted sm:text-base">
                                    Playing the mod, reporting bugs, creating content,
                                    and sharing Bannerlord Coop also help the project
                                    tremendously.
                                </p>
                            </div>

                            <div className="flex flex-col justify-between px-6 py-8 sm:px-10 sm:py-10 lg:col-span-5 lg:px-12 lg:py-12">
                                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                                    {otherWaysToHelp.map((way) => (
                                        <li
                                            key={way}
                                            className="flex items-center gap-3 text-sm text-foreground-muted"
                                        >
                                            <span
                                                aria-hidden="true"
                                                className="size-1.5 shrink-0 rotate-45 bg-gold"
                                            />
                                            {way}
                                        </li>
                                    ))}
                                </ul>

                                <p className="mt-10 border-t border-white/10 pt-7 font-display text-2xl font-semibold leading-8 text-foreground">
                                    Thank you for supporting Bannerlord Coop!
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
            <Footer />
        </>
    );
}
