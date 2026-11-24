import type { ReactNode } from "react";
import { DiscordHelpNote } from "./NightlySupport";
import { finePrintClass, headingClass, ledeClass } from "./styles";

/** The colours and glyph of each status tone. */
const TONES = {
    success: { colors: "border-[#5f9565]/60 text-[#88b28b]", glyph: "✓" },
    error: { colors: "border-crimson/70 text-[#cf555c]", glyph: "!" },
} as const;

/** Draws the diamond status mark used on success and error pages. */
function StatusMark({ tone }: { tone: keyof typeof TONES }) {
    const { colors, glyph } = TONES[tone];
    return (
        <div aria-hidden="true" className={`mb-6 flex size-11 rotate-45 items-center justify-center border ${colors}`}>
            <span className="-rotate-45 font-display text-2xl leading-none">{glyph}</span>
        </div>
    );
}

/** Renders a successful step and reminds the user to go back to the installer. */
export function NightlySuccess({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
    return (
        <>
            <StatusMark tone="success" />
            <h1 className={headingClass}>{title}</h1>
            <p className={ledeClass}>{message}</p>
            {children}
            <p className={finePrintClass}>You may safely close this tab once the installer continues.</p>
        </>
    );
}

/** Renders the "Access unavailable" page with a mapped message, optional help and the Discord pointer. */
export function NightlyError({ message, children }: { message: string; children?: ReactNode }) {
    return (
        <>
            <StatusMark tone="error" />
            <h1 className={headingClass}>
                Access <span className="text-crimson">unavailable.</span>
            </h1>
            <p className={ledeClass} role="alert">{message}</p>
            {children}
            <DiscordHelpNote />
        </>
    );
}
