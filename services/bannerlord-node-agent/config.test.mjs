import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SERVER_ID, loadServerConfigurations } from "./config.mjs";

const sharedEnvironment = {
    BANNERLORD_READY_LOG_PATTERN: "server-ready",
    BANNERLORD_UPDATE_IMAGE: "ghcr.io/example/bannerlord:latest",
};

test("loads the legacy single-server configuration", () => {
    const configurations = loadServerConfigurations({
        ...sharedEnvironment,
        BANNERLORD_CONTAINER: "bannerlordcoop",
        BANNERLORD_DATA_PATH: "/srv/data",
        BANNERLORD_DATA_VOLUME: "bannerlordcoop-data",
        BANNERLORD_UDP_PORT: "4200",
    });

    assert.deepEqual(configurations.get(DEFAULT_SERVER_ID), {
        container: "bannerlordcoop",
        dataPath: "/srv/data",
        dataVolume: "bannerlordcoop-data",
        readinessPattern: "server-ready",
        udpPort: 4200,
        updateImage: "ghcr.io/example/bannerlord:latest",
    });
});

test("loads isolated configurations for multiple servers", () => {
    const configurations = loadServerConfigurations({
        ...sharedEnvironment,
        AGENT_SERVERS: JSON.stringify({
            "bannerlord-one": {
                container: "bannerlord-one",
                dataVolume: "bannerlord-one-data",
                udpPort: 4200,
            },
            "bannerlord-two": {
                container: "bannerlord-two",
                dataPath: "/game-data",
                dataVolume: "bannerlord-two-data",
                readinessPattern: "second-ready",
                udpPort: 4201,
                updateImage: "ghcr.io/example/bannerlord:canary",
            },
        }),
    });

    assert.equal(configurations.size, 2);
    assert.deepEqual(configurations.get("bannerlord-one"), {
        container: "bannerlord-one",
        dataPath: "/srv/data",
        dataVolume: "bannerlord-one-data",
        readinessPattern: "server-ready",
        udpPort: 4200,
        updateImage: "ghcr.io/example/bannerlord:latest",
    });
    assert.deepEqual(configurations.get("bannerlord-two"), {
        container: "bannerlord-two",
        dataPath: "/game-data",
        dataVolume: "bannerlord-two-data",
        readinessPattern: "second-ready",
        udpPort: 4201,
        updateImage: "ghcr.io/example/bannerlord:canary",
    });
});

test("rejects server configurations that share a lifecycle resource", () => {
    const base = {
        first: {
            container: "container-one",
            dataVolume: "data-one",
            udpPort: 4200,
        },
        second: {
            container: "container-two",
            dataVolume: "data-two",
            udpPort: 4201,
        },
    };

    for (const [field, value, expectedMessage] of [
        ["container", "container-one", "same container"],
        ["dataVolume", "data-one", "same data volume"],
        ["udpPort", 4200, "same UDP port"],
    ]) {
        const servers = structuredClone(base);
        servers.second[field] = value;
        assert.throws(
            () => loadServerConfigurations({ AGENT_SERVERS: JSON.stringify(servers) }),
            new RegExp(expectedMessage),
        );
    }
});

test("rejects unsafe or ambiguous server configuration", () => {
    for (const idLikeContainer of ["abc123", "a".repeat(64)]) {
        assert.throws(
            () => loadServerConfigurations({
                AGENT_SERVERS: JSON.stringify({
                    first: {
                        container: idLikeContainer,
                        dataVolume: "data-one",
                        udpPort: 4200,
                    },
                }),
            }),
            /stable Docker name/,
        );
    }
    assert.throws(
        () => loadServerConfigurations({
            AGENT_SERVERS: JSON.stringify({
                first: {
                    container: "container-one",
                    dataPath: "/srv/../data",
                    dataVolume: "data-one",
                    udpPort: 4200,
                },
            }),
        }),
        /normalized absolute container path/,
    );
    assert.throws(
        () => loadServerConfigurations({
            AGENT_SERVERS: JSON.stringify({
                first: {
                    container: "container-one",
                    dataVolume: "data-one",
                    typoPort: 4200,
                    udpPort: 4200,
                },
            }),
        }),
        /unsupported key typoPort/,
    );
});
