import { ServerDirectoryTable } from "@/app/components/servers/ServerDirectoryTable";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

const server = {
    id: "4789e6c3-708e-44d1-ab83-b68c705a6022",
    name: "Managed Campaign",
    status: "Offline" as const,
    connectionType: "Direct" as const,
    joinUrl: "bannerlordcoop://join/4789e6c3-708e-44d1-ab83-b68c705a6022",
    players: null,
};

test("does not advertise management for a listing-only managed server", () => {
    const html = renderToStaticMarkup(
        <ServerDirectoryTable servers={[server]} emptyMessage="No servers" />,
    );

    assert.doesNotMatch(html, />Manage</u);
    assert.doesNotMatch(html, /\/servers\/4789e6c3/iu);
});

test("keeps an explicit live-console management link", () => {
    const html = renderToStaticMarkup(
        <ServerDirectoryTable
            servers={[{ ...server, manageUrl: `/servers/${server.id}` }]}
            emptyMessage="No servers"
        />,
    );

    assert.match(html, />Manage</u);
    assert.match(html, /\/servers\/4789e6c3/iu);
});
