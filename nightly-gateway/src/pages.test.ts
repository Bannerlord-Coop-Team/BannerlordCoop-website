import assert from "node:assert/strict";
import test from "node:test";
import { errorPage, gatewayErrorMessage, page } from "./pages";

test("gateway pages use the site brand without weakening page security", () => {
    const markup = page(
        `Nightly <access>`,
        `Supporter "builds"`,
        `<h1>Known-safe content</h1>`,
        `claim-page`,
    );

    assert.match(markup, /Bannerlord Co-op/);
    assert.match(markup, /Nightly Access/);
    assert.match(markup, /--crimson:#8f1d23/);
    assert.match(markup, /singleleader\.png/);
    assert.match(markup, /<title>Nightly &lt;access&gt; \| Bannerlord Co-op<\/title>/);
    assert.match(markup, /Supporter &quot;builds&quot;/);
    assert.match(markup, /class="shell claim-page"/);
    assert.doesNotMatch(markup, /<script/i);
});

test("create-build and generic errors link the fixed General Help invite and escape the message", () => {
    for (const code of ["already_used", "pin_incomplete", "pin_identity_conflict", "unexpected"]) {
        const markup = errorPage(gatewayErrorMessage(code));
        assert.match(markup, /Create a General Help support ticket in <a href="https:\/\/discord\.gg\/5vJzfz5Zzy" target="_blank" rel="noopener noreferrer">our Discord<\/a>/);
    }
    assert.match(errorPage(gatewayErrorMessage("unexpected")), /Run the installer again\./);
    assert.match(errorPage("<script>test</script>"), /&lt;script&gt;test&lt;\/script&gt;/);
});
