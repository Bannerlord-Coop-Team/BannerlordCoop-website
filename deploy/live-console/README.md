# Live console deployment

This Compose stack runs the console gateway, the outbound Bannerlord node agent, and Caddy TLS termination on the external VPS.

Copy the service-specific environment examples to `gateway.env` and `node-agent.env`, set matching node tokens, then run:

```bash
docker compose up -d --build
```

The checked-in Caddy hostname uses `sslip.io` for the current `15.204.120.17` host. Replace it with a project-controlled hostname when available, update `CONSOLE_GATEWAY_URL`, `CONSOLE_GATEWAY_NODE_URL`, and allowed website origins together, then redeploy.

Neither the gateway nor node agent publishes a direct port. Only Caddy exposes TCP 80/443 and UDP 443. One node-agent process can control multiple explicitly allowlisted containers on the VPS.

Configure the same server IDs across the three trust boundaries:

1. Website `CONSOLE_SERVER_CATALOG` lists the cards/routes shown to Admins.
2. Gateway `CONSOLE_SERVER_NODES` maps each server ID to this node ID.
3. Node `AGENT_SERVERS` maps each server ID to its isolated Docker resources.

Example website and gateway configuration:

```env
# Netlify website
CONSOLE_SERVER_CATALOG=[{"id":"bannerlord-live-one","name":"Bannerlord Server One","address":"15.204.120.17:4200","nodeId":"vps-15-204-120-17","provider":"External VPS"},{"id":"bannerlord-live-two","name":"Bannerlord Server Two","address":"15.204.120.17:4201","nodeId":"vps-15-204-120-17","provider":"External VPS"}]

# gateway.env
CONSOLE_SERVER_NODES={"bannerlord-live-one":"vps-15-204-120-17","bannerlord-live-two":"vps-15-204-120-17"}
```

Example node configuration:

```env
BANNERLORD_UPDATE_IMAGE=ghcr.io/bannerlord-coop-team/bannerlord-coop-dedicated-server:latest
BANNERLORD_DATA_PATH=/srv/data
BANNERLORD_READY_LOG_PATTERN='"phase":"serving"'
AGENT_SERVERS={"bannerlord-live-one":{"container":"bannerlord-one","dataVolume":"bannerlord-one-data","udpPort":4200},"bannerlord-live-two":{"container":"bannerlord-two","dataVolume":"bannerlord-two-data","udpPort":4201}}
```

Container names, named volumes, and UDP ports must be unique. The agent refuses ambiguous or unknown configuration keys. Each update validates only the selected server's declared volume, port, restart policy, and security settings. A replacement must remain running and emit its configured readiness marker; otherwise the agent verifies restoration of that server's previous container.
