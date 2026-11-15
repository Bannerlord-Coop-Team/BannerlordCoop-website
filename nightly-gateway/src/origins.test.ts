import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_GATEWAY_ORIGIN, LEGACY_GATEWAY_ORIGIN, resolveGatewayOrigin } from "./origins";

test("the gateway origin follows the allowlisted request host and falls back to the canonical host", () => {
    assert.equal(resolveGatewayOrigin(`${CANONICAL_GATEWAY_ORIGIN}/v1/manifests/client`), CANONICAL_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin(new URL(`${LEGACY_GATEWAY_ORIGIN}/v1/pins`)), LEGACY_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin("https://attacker.invalid/v1/manifests/client"), CANONICAL_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin("http://nightly.bannerlordcoop.com/health"), CANONICAL_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin("https://nightly.bannerlordcoop.com:8443/health"), CANONICAL_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin("https://preview.bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/"), CANONICAL_GATEWAY_ORIGIN);
});
