import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyJoinButton } from "./CopyJoinButton";

test("join is a copy button, not a custom-protocol navigation link", () => {
    const html = renderToStaticMarkup(<CopyJoinButton address="203.0.113.10:7210" />);
    assert.match(html, /<button/);
    assert.match(html, /Copy 203\.0\.113\.10:7210/);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /href=|disabled=""|bannerlordcoop:\/\//);
});

test("missing endpoint and offline servers cannot be joined", () => {
    assert.match(renderToStaticMarkup(<CopyJoinButton address={null} />), /disabled=""/);
    assert.match(renderToStaticMarkup(<CopyJoinButton address="203.0.113.10:7210" disabled />), /disabled=""/);
});
