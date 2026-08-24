# Live console deployment

This Compose stack runs the console gateway, the outbound Bannerlord node agent, and Caddy TLS termination on the external VPS.

Copy the service-specific environment examples to `gateway.env` and `node-agent.env`, set matching node tokens, then run:

```bash
docker compose up -d --build
```

The checked-in Caddy hostname uses `sslip.io` for the current `15.204.120.17` host. Replace it with a project-controlled hostname when available, update `CONSOLE_GATEWAY_URL`, `CONSOLE_GATEWAY_NODE_URL`, and allowed website origins together, then redeploy.

Neither the gateway nor node agent publishes a direct port. Only Caddy exposes TCP 80/443 and UDP 443. The node agent targets the fixed `bannerlordcoop` container through the Docker socket.

The deployed node environment should set:

```env
BANNERLORD_CONTAINER=bannerlordcoop
BANNERLORD_UPDATE_IMAGE=ghcr.io/bannerlord-coop-team/bannerlord-coop-dedicated-server:latest
BANNERLORD_DATA_VOLUME=bannerlordcoop-data
BANNERLORD_DATA_PATH=/srv/data
BANNERLORD_UDP_PORT=4200
BANNERLORD_READY_LOG_PATTERN='"phase":"serving"'
```

Update refuses to recreate containers that diverge from this supported specification. A replacement must remain running and emit the readiness marker; otherwise the agent verifies restoration of the previous container and reports the failed update.
