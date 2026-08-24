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
        name: "Afdian (爱发电)",
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
                            <ul className="mt-8 max-w-3xl divide-y divide-white/10 border border-white/10 bg-surface/75">
                                {supportOptions.map((option) => (
                                    <li key={option.name}>
                                        <a
                                            href={option.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="group flex min-h-18 items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-gold/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold sm:px-6"
                                        >
                                            <span className="min-w-0">
                                                <span className="block font-display text-2xl font-semibold text-foreground transition-colors group-hover:text-gold">
                                                    {option.name}
                                                </span>
                                                <span className="mt-1 block text-sm leading-5 text-foreground-muted">
                                                    {option.descriptor}
                                                </span>
                                            </span>
                                            <span aria-hidden="true" className="shrink-0 font-display text-2xl text-gold">
                                                ↗
                                            </span>
                                            <span className="sr-only">(opens in a new tab)</span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-8 max-w-2xl font-display text-2xl leading-8 text-foreground sm:text-3xl sm:leading-10">
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
