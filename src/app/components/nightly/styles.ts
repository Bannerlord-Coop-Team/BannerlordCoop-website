// Shared class names so every nightly page uses the site's button, label and field treatments.
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const primaryButtonClass = `inline-flex min-h-12 items-center justify-center gap-2 rounded-sm border border-crimson bg-crimson px-6 font-label text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

export const secondaryButtonClass = `inline-flex min-h-12 items-center justify-center gap-2 rounded-sm border border-white/20 bg-background/30 px-6 font-label text-sm font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:border-gold/60 hover:text-gold ${focusRing}`;

export const textButtonClass = `inline-flex min-h-10 items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted transition-colors hover:text-[#cf555c] disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

export const eyebrowClass = "font-label text-xs font-semibold uppercase tracking-[0.24em] text-gold";

export const headingClass = "font-display text-5xl font-semibold leading-[0.95] text-foreground sm:text-6xl";

export const ledeClass = "mt-6 max-w-2xl text-base leading-7 text-foreground-muted";

export const finePrintClass = "mt-8 max-w-xl border-t border-white/10 pt-5 text-xs leading-6 text-foreground-dim";

export const alertClass = "mt-4 rounded-sm border border-crimson/60 bg-crimson/10 px-4 py-3 text-sm leading-6 text-foreground";
