/** Maps a horizontal tablist key to the next tab position, wrapping at both ends; null for other keys or no tabs. */
export function tabKeyStep(key: string, position: number, count: number): number | null {
    if (count === 0) return null;
    switch (key) {
        case "Home": return 0;
        case "End": return count - 1;
        case "ArrowRight": return (position + 1) % count;
        case "ArrowLeft": return (position + count - 1) % count;
        default: return null;
    }
}
