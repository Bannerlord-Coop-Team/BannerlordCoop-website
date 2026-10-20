import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackUrl, isPermittedOriginScheme } from "./loopback-origin";

test("only the loopback hostnames count as loopback", () => {
    for (const value of ["http://localhost:3000", "http://127.0.0.1:8796", "http://[::1]:8796"]) {
        assert.equal(isLoopbackUrl(new URL(value)), true, value);
    }
    for (const value of ["http://localhost.:3000", "http://127.0.0.2", "http://localhost.example.com", "http://0.0.0.0", "http://[::2]"]) {
        assert.equal(isLoopbackUrl(new URL(value)), false, value);
    }
});

test("https is always allowed and other schemes never are", () => {
    for (const nodeEnv of [undefined, "production", "development", "test"]) {
        assert.equal(isPermittedOriginScheme(new URL("https://project.supabase.co"), nodeEnv), true);
        assert.equal(isPermittedOriginScheme(new URL("ws://127.0.0.1:8796"), nodeEnv), false);
    }
});

test("loopback http is allowed only under next dev, and non-loopback http never", () => {
    const loopback = new URL("http://127.0.0.1:55421");
    assert.equal(isPermittedOriginScheme(loopback, "development"), true);
    assert.equal(isPermittedOriginScheme(loopback, "production"), false);
    assert.equal(isPermittedOriginScheme(loopback, "test"), false);
    assert.equal(isPermittedOriginScheme(loopback, undefined), false);
    assert.equal(isPermittedOriginScheme(new URL("http://project.supabase.co"), "development"), false);
});
