export const fileButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
export const filePrimaryButtonClass = `${fileButtonClass} !border-gold/50 !bg-gold/15 !text-gold`;
/** A workspace button whose action replaces or removes data, such as restoring a backup over the current save. */
export const fileDangerButtonClass = `${fileButtonClass} !border-red-400/40 !text-red-200 hover:!border-red-300/60 hover:!bg-red-500/10`;
/** A borderless square button for row actions that only need an icon, such as refresh or remove. */
export const fileIconButtonClass = "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-foreground-muted transition hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
