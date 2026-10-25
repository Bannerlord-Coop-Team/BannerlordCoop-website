import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReleaseNotes } from "./ReleaseNotes";

/** Renders release notes into a detached element for text and structure assertions. */
function render(body: string) {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<ReleaseNotes body={body} emptyMessage="No release notes." />);
    return container;
}

it("hides HTML comments that GitHub does not render, such as release-coordination metadata", () => {
    const notes = render([
        '<!-- release-coordination {"tag":"v0.1.6","client_sha":"5f4d63cc097517"} -->',
        "# Highlights",
        "",
        "Faster saves <!-- internal note --> for everyone.",
        "",
        "<!--",
        "multi-line maintainer note",
        "-->",
        "- Fixed **sieges**",
    ].join("\n"));

    expect(notes.textContent).not.toMatch(/release-coordination|client_sha|internal note|maintainer note|<!--|-->/);
    expect(notes.querySelector("h3")?.textContent).toBe("Highlights");
    expect(notes.querySelector("p")?.textContent).toMatch(/^Faster saves\s+for everyone\.$/);
    expect(notes.querySelector("li")?.textContent).toBe("Fixed sieges");
});

it("lets long auto-linked pull request URLs wrap instead of overflowing narrow screens", () => {
    const notes = render("Fixed sieges in https://github.com/Bannerlord-Coop-Team/BannerlordCoop/pull/3451.");

    expect(notes.querySelector("a")?.getAttribute("href")).toBe("https://github.com/Bannerlord-Coop-Team/BannerlordCoop/pull/3451");
    expect(notes.firstElementChild?.className).toContain("wrap-anywhere");
});

it("shows the empty message when a release body holds only comments", () => {
    expect(render('<!-- release-coordination {"tag":"v0.1.6"} -->\n').textContent).toBe("No release notes.");
});

it("treats an unterminated comment as hiding the rest of the body, as GitHub does", () => {
    const notes = render("Visible line\n\n<!-- unfinished note\nhidden line");

    expect(notes.textContent).toContain("Visible line");
    expect(notes.textContent).not.toMatch(/unfinished|hidden line/);
});
