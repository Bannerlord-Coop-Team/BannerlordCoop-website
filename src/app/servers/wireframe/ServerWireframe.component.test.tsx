import assert from "node:assert/strict";
import { test } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ServerWireframe from "./ServerWireframe";

test("public wireframe starts with a concealed address and clearly labeled demo console", () => {
    const html = renderToStaticMarkup(<ServerWireframe />);
    assert.match(html, /Public wireframe/);
    assert.match(html, /No live connections/);
    assert.match(html, /id="server-address"[^>]*>Hidden</);
    assert.match(html, /aria-controls="server-address" aria-expanded="false"/);
    assert.doesNotMatch(html, /203\.0\.113\.42/);
    assert.match(html, /Download logs/);
    assert.match(html, /aria-label="Demo server controls"/);
    assert.match(html, /title="Copy demo IP and port"/);
    assert.match(html, /Copy join address/);
    assert.match(html, /aria-label="Edit server name"/);
    assert.doesNotMatch(html, /Explore the controls|Watch the campaign|flex-col-reverse/);
    assert.match(html, /aria-expanded="false" aria-controls="command-picker"/);
    assert.match(html, /aria-label="Insert announce command"/);
    assert.doesNotMatch(html, /Welcome to the campaign!/);
    assert.equal((html.match(/>Information<\/h3>/g) ?? []).length, 1);
    assert.doesNotMatch(html, /4 \/ 8 players|Campaign day 126|Last saved 2 minutes ago/);
    assert.doesNotMatch(html, /Server management \/ UX exploration|Backups, restores and save transfers are simulated/);
    assert.match(html, /aria-label="Demo console output"/);
    for (const workspace of ["Console", "Backups", "Save &amp; config", "Settings"]) {
        assert.ok(html.includes(workspace));
    }
});

test("demo lifecycle confirms interruptions and keeps controls and status in sync", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label)!;
    const click = async (label: string) => { await act(async () => button(label).click()); };
    try {
        await act(async () => root.render(<ServerWireframe />));
        assert.equal(button("Start").disabled, true);
        await click("Stop");
        assert.ok(container.textContent?.includes("Running · demo"));
        assert.equal(document.activeElement, button("Cancel"));
        await click("Cancel");
        assert.equal(container.querySelector("#lifecycle-confirmation"), null);
        assert.ok(container.textContent?.includes("Running · demo"));
        await click("Restart");
        await click("Restart server");
        assert.ok(container.textContent?.includes("Demo server restarted."));
        assert.equal(button("Start").disabled, true);
        await click("Stop");
        await click("Stop server");
        assert.ok(container.textContent?.includes("Stopped · demo"));
        assert.equal(button("Start").disabled, false);
        assert.equal(button("Stop").disabled, true);
        assert.equal(button("Restart").disabled, true);
        assert.equal(button("Send").disabled, true);
        await click("Start");
        assert.ok(container.textContent?.includes("Running · demo"));
        assert.ok(container.textContent?.includes("Demo server started."));
        assert.equal(button("Stop").disabled, false);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
