import { NightlyCard } from "@/app/components/nightly/NightlyCard";
import { headingClass, ledeClass, primaryButtonClass, secondaryButtonClass } from "@/app/components/nightly/styles";
import { DISCORD_INVITE_URL, LINUX_INSTALLER_URL, WINDOWS_INSTALLER_URL } from "@/app/lib/nightly/links";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: { absolute: "Nightly Access | Bannerlord Co-op" },
    description: "Install or update nightly Bannerlord Co-op client and dedicated server builds as Staff, a Tester, a supporter, or a sponsored friend.",
    alternates: { canonical: "/nightly" },
};

const steps = [
    {
        number: "01",
        title: "Download and run",
        body: "Save the Windows or Linux installer launcher, then run it. The window stays open so you can see every prompt or error.",
    },
    {
        number: "02",
        title: "Choose and verify",
        body: "Select the client, dedicated server, or both. Discord access is checked at install and update time.",
    },
] as const;

/** Explains nightly access and links the installers and the sponsor portal (the Worker's former landing page). */
export default function NightlyAccessPage() {
    return (
        <NightlyCard eyebrow="Staff, Supporter & Tester builds" wide>
            <h1 className={headingClass}>
                Test tomorrow&rsquo;s battles <span className="text-crimson">today.</span>
            </h1>
            <p className={ledeClass}>
                Install or update the Bannerlord Co-op client, Windows dedicated server, or both. Nightly builds are available to
                Staff, Testers, and Patreon, Boosty, and Afdian supporters, plus their sponsored friends.
            </p>
            <ol className="mt-8 grid gap-px bg-white/10 sm:grid-cols-2">
                {steps.map((step) => (
                    <li key={step.number} className="bg-background/90 p-5">
                        <span className="block font-label text-xs font-bold tracking-[0.15em] text-crimson">{step.number}</span>
                        <strong className="mt-3 block font-display text-xl font-semibold text-foreground">{step.title}</strong>
                        <p className="mt-2 text-sm leading-6 text-foreground-muted">{step.body}</p>
                    </li>
                ))}
            </ol>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <a className={primaryButtonClass} href={WINDOWS_INSTALLER_URL} download="BannerlordCoop-Nightly-Installer.cmd">
                    Download Windows installer <span aria-hidden="true">&darr;</span>
                </a>
                <a className={primaryButtonClass} href={LINUX_INSTALLER_URL} download="BannerlordCoop-Nightly-Installer.sh">
                    Download Linux installer <span aria-hidden="true">&darr;</span>
                </a>
                <Link className={secondaryButtonClass} href="/nightly/sponsor" prefetch={false}>
                    Manage sponsored accounts
                </Link>
                <a
                    className="px-2 text-center font-label text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted underline underline-offset-4 hover:text-gold"
                    href={DISCORD_INVITE_URL}
                >
                    Join the Discord
                </a>
            </div>
        </NightlyCard>
    );
}
