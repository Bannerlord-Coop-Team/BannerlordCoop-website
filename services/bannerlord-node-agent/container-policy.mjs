export function assertContainerIdentityAndIsolation(inspection, server) {
    const canonicalName = inspection.Name?.replace(/^\//, "");
    if (canonicalName !== server.container) {
        throw new Error("The lifecycle target must be the container's stable canonical name.");
    }

    const host = inspection.HostConfig ?? {};
    const mounts = inspection.Mounts ?? [];
    const expectedPort = `${server.udpPort}/udp`;
    const portKeys = Object.keys(host.PortBindings ?? {}).filter(
        (key) => host.PortBindings[key] !== null,
    );
    const portBindings = host.PortBindings?.[expectedPort];
    const ownsDeclaredVolume = mounts.length === 1 &&
        mounts[0].Type === "volume" &&
        mounts[0].Name === server.dataVolume &&
        mounts[0].Destination === server.dataPath &&
        mounts[0].RW === true;
    const ownsDeclaredPort = portKeys.length === 1 &&
        portKeys[0] === expectedPort &&
        Array.isArray(portBindings) &&
        portBindings.length === 1 &&
        portBindings[0].HostPort === String(server.udpPort);

    if (!ownsDeclaredVolume || !ownsDeclaredPort) {
        throw new Error(
            "The container does not own this server's declared volume and UDP port.",
        );
    }
}
