/** Holds the navbar's height and announces it as loading while the viewer-dependent navbar streams in. */
export function NavbarFallback({ label }: { label: string }) {
    return <div role="status" aria-label={label} className="h-16 border-b border-white/10 bg-background" />;
}
