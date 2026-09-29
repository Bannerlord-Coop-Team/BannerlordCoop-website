import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingButton } from "./LoadingButton";
import { LoadingSpinner } from "./LoadingSpinner";
import { PageLoadingState } from "./PageLoadingState";
import { Skeleton } from "./Skeleton";

describe("loading UI", () => {
    it("renders a decorative spinner without a label", () => {
        const html = renderToStaticMarkup(<LoadingSpinner />);

        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain("animate-spin");
        expect(html).not.toContain('role="status"');
    });

    it("exposes a spinner status when given a label", () => {
        const html = renderToStaticMarkup(
            <LoadingSpinner label="Loading servers…" />,
        );

        expect(html).toContain('role="status"');
        expect(html).toContain("Loading servers");
    });

    it("exposes accessible page busy information", () => {
        const html = renderToStaticMarkup(
            <PageLoadingState label="Loading account…" />,
        );

        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('aria-label="Loading account…"');
        expect(html).toContain('role="status"');
    });

    it("hides skeletons from assistive technology", () => {
        const html = renderToStaticMarkup(
            <Skeleton className="h-4 w-20" />,
        );

        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain("animate-pulse");
        expect(html).toContain("h-4 w-20");
    });

    it("renders loading buttons as submit buttons and preserves disabled state", () => {
        const enabled = renderToStaticMarkup(
            <LoadingButton pendingText="Saving…">Save</LoadingButton>,
        );
        const disabled = renderToStaticMarkup(
            <LoadingButton pendingText="Saving…" disabled>Save</LoadingButton>,
        );

        expect(enabled).toContain('type="submit"');
        expect(enabled).toContain("Save");
        expect(enabled).not.toContain("disabled");
        expect(disabled).toContain('disabled=""');
        expect(disabled).toContain('aria-disabled="true"');
    });
});