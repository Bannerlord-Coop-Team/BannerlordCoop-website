import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { State } from "./ControlPlanePresentation";

it.each([
    ["running", "Sleeping — wakes when a player connects"],
    ["stopped", "suspended"],
    [undefined, "suspended"],
])("renders suspended admin state with %s intent", (desiredState, label) => {
    const html = renderToStaticMarkup(<State value="suspended" desiredState={desiredState} />);
    expect(html).toContain(`>${label}</span>`);
    if (desiredState === "running") expect(html).not.toContain("on hold");
    else expect(html).not.toContain("Sleeping");
});
