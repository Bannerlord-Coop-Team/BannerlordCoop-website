/** One bordered strip of joined buttons, such as Start | Stop | Restart or Pause | 1x | 2x. */
export const segmentedGroupClass = "inline-flex min-h-10 overflow-hidden rounded-md border border-white/15 bg-white/[0.03] divide-x divide-white/15";

/** A button inside a segmented group; aria-pressed marks the selected choice in a toggle group. */
export const segmentedButtonClass = "inline-flex min-h-10 items-center justify-center gap-1 px-2 py-2 text-xs font-medium text-foreground transition hover:bg-gold/10 focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:bg-gold/15 aria-pressed:text-gold aria-pressed:shadow-[inset_0_-2px_0_var(--color-gold)] sm:gap-2 sm:px-3 sm:text-sm";

/** A standalone toolbar button matching the segmented groups beside it. */
export const toolbarButtonClass = "inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-white/15 bg-white/[0.03] px-2 py-2 text-xs font-medium text-foreground transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2 sm:px-3 sm:text-sm";

/** A borderless, low-emphasis toolbar button for rare housekeeping actions. */
export const ghostButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm text-foreground-muted transition hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

/** A borderless square icon button, such as a menu trigger; aria-expanded marks it while its menu is open. */
export const iconButtonClass = "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-foreground-muted transition hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold aria-expanded:bg-white/5 aria-expanded:text-foreground";

/** A full-width row inside an overflow menu panel. */
export const menuItemClass = "flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-foreground transition hover:bg-white/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
