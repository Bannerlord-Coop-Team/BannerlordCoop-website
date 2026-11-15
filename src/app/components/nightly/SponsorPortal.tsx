import type { SponsorPortalData, SponsorSeat } from "@/app/lib/nightly/client";
import { CreateSponsorCodeForm, RemoveSeatForm, type CreateCodeAction, type RemoveSeatAction } from "./SponsorPortalForms";
import { headingClass, ledeClass, primaryButtonClass } from "./styles";

const ROLES = "Staff, Tester, Patreon, Boosty, or Afdian";
const seatDateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/** Renders the signed-in sponsor's seats with the create-code and remove-seat actions. */
export function SponsorPortal({ data, createCode, removeSeat }: {
    data: SponsorPortalData;
    createCode: CreateCodeAction;
    removeSeat: RemoveSeatAction;
}) {
    const used = data.seats.length;
    const open = Math.max(data.limit - used, 0);
    return (
        <>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className={headingClass}>Your <span className="text-crimson">warband.</span></h1>
                    <p className={ledeClass}>
                        Create a code for friends to use during installation. Their access remains tied to your current qualifying
                        {` ${ROLES} `}Discord role.
                    </p>
                </div>
                <div className="inline-flex shrink-0 items-center gap-3 self-start border border-gold/25 bg-gold/[0.04] px-4 py-3 lg:self-auto" aria-label={`${used} of ${data.limit} seats used`}>
                    <strong className="font-display text-4xl leading-none text-gold">{used}</strong>
                    <span className="font-label text-[0.65rem] uppercase leading-4 tracking-[0.14em] text-foreground-dim">of {data.limit}<br />seats used</span>
                </div>
            </div>
            <CreateSponsorCodeForm action={createCode} hasSeats={used > 0} limit={data.limit} />
            <section className="mt-10" aria-labelledby="seat-heading">
                <div className="flex items-center justify-between border-b border-gold/25 pb-3">
                    <h2 id="seat-heading" className="font-label text-sm font-semibold uppercase tracking-[0.17em] text-foreground">Sponsored accounts</h2>
                    <span className="font-label text-xs font-semibold uppercase tracking-[0.14em] text-gold">{open} open</span>
                </div>
                <ul className="divide-y divide-white/10 border-b border-white/10">
                    {used === 0 ? <EmptySeats /> : data.seats.map((seat, index) => (
                        <SeatRow key={seat.discordUserId} seat={seat} index={index} removeSeat={removeSeat} />
                    ))}
                </ul>
            </section>
        </>
    );
}

/** Renders one sponsored account with its remove action. */
function SeatRow({ seat, index, removeSeat }: { seat: SponsorSeat; index: number; removeSeat: RemoveSeatAction }) {
    return (
        <li className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto]">
            <span className="font-mono text-xs text-foreground-dim">{String(index + 1).padStart(2, "0")}</span>
            <span className="flex min-w-0 flex-col gap-1">
                <span className="font-label text-[0.65rem] uppercase tracking-[0.13em] text-foreground-dim">Discord account</span>
                <code className="break-all font-mono text-sm text-foreground">{seat.discordUserId}</code>
                {seat.createdAt !== null && (
                    <span className="text-xs text-foreground-dim">Added {seatDateFormat.format(seat.createdAt)}</span>
                )}
            </span>
            <div className="col-start-2 sm:col-start-auto">
                <RemoveSeatForm action={removeSeat} discordUserId={seat.discordUserId} />
            </div>
        </li>
    );
}

/** Explains the empty seat list. */
function EmptySeats() {
    return (
        <li className="flex flex-col gap-2 py-6">
            <strong className="font-display text-lg font-semibold text-foreground">No seats claimed yet.</strong>
            <span className="text-sm text-foreground-dim">Create a sponsor code and send it to a friend you trust.</span>
        </li>
    );
}

/** Invites an eligible member to sign in to the sponsor portal; flags an expired session when relevant. */
export function SponsorLogin({ expired }: { expired: boolean }) {
    return (
        <>
            <h1 className={headingClass}>Bring your <span className="text-crimson">warband.</span></h1>
            {expired && (
                <p role="status" className="mt-6 max-w-2xl border-l-2 border-gold bg-gold/[0.06] px-4 py-3 text-sm leading-6 text-foreground-muted">
                    Your sponsor session has ended. Sign in again to manage sponsored accounts.
                </p>
            )}
            <p className={ledeClass}>
                Staff, Testers, and Patreon, Boosty, or Afdian supporters can each share nightly access with up to 10 Discord accounts.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
                <a className={primaryButtonClass} href="/nightly/sponsor/login">
                    Continue with Discord <span aria-hidden="true">&rarr;</span>
                </a>
            </div>
            <p className="mt-8 max-w-xl border-t border-white/10 pt-5 text-xs leading-6 text-foreground-dim">
                We verify your qualifying {ROLES} Discord role when you sign in and whenever a sponsored friend installs or updates.
            </p>
        </>
    );
}
