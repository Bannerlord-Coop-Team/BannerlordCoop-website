import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage, sendSmtpMail, SmtpError, type SmtpSocket, type SmtpTransport } from "./smtp.ts";

type Step = { expect: RegExp; reply: string };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
const message = { from: "alerts@example.test", to: ["a@example.test", "b@example.test"], subject: "Region request: France", text: "Line one\n.Line two" };
const credentials = { username: "bot", password: "secret" };

// Scripted SMTP server: each client command (or DATA body) is matched against the next step and answered.
class FakeSocket implements SmtpSocket {
    received: string[] = [];
    closed = false;
    private inbound = "";
    private outbound = new Uint8Array(0);
    private waiters: (() => void)[] = [];
    private dataMode = false;
    constructor(private readonly script: Step[], greeting = "220 smtp.example.test ESMTP\r\n") { this.enqueue(greeting); }
    async read(buffer: Uint8Array): Promise<number | null> {
        while (this.outbound.length === 0) {
            if (this.closed) return null;
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
        const count = Math.min(this.outbound.length, buffer.length);
        buffer.set(this.outbound.subarray(0, count));
        this.outbound = this.outbound.slice(count);
        return count;
    }
    async write(data: Uint8Array): Promise<number> {
        if (this.closed) throw new Error("socket closed");
        this.inbound += decoder.decode(data);
        this.process();
        return data.length;
    }
    close(): void { this.closed = true; for (const wake of this.waiters.splice(0)) wake(); }
    private enqueue(text: string) {
        const bytes = encoder.encode(text);
        const combined = new Uint8Array(this.outbound.length + bytes.length);
        combined.set(this.outbound); combined.set(bytes, this.outbound.length);
        this.outbound = combined;
        for (const wake of this.waiters.splice(0)) wake();
    }
    private process() {
        for (;;) {
            const terminator = this.dataMode ? "\r\n.\r\n" : "\r\n";
            const index = this.inbound.indexOf(terminator);
            if (index < 0) return;
            const command = this.inbound.slice(0, index);
            this.inbound = this.inbound.slice(index + terminator.length);
            const entry = this.dataMode ? `<DATA>${command}` : command;
            this.received.push(entry);
            this.dataMode = false;
            const step = this.script.shift();
            if (step === undefined) return; // leave the client waiting
            if (!step.expect.test(entry)) throw new Error(`Unexpected SMTP command: ${entry}`);
            if (command === "DATA" && step.reply.startsWith("354")) this.dataMode = true;
            this.enqueue(step.reply);
        }
    }
}

function fakeTransport(sockets: { plain?: FakeSocket; tls?: FakeSocket; upgraded?: FakeSocket }) {
    const calls: string[] = [];
    const transport: SmtpTransport = {
        connect: async (target) => { calls.push(`connect ${target.hostname}:${target.port}`); return sockets.plain!; },
        connectTls: async (target) => { calls.push(`connectTls ${target.hostname}:${target.port}`); return sockets.tls!; },
        startTls: async (socket, target) => { calls.push(`startTls ${target.hostname}`); assert.equal(socket, sockets.plain); return sockets.upgraded!; },
    };
    return { calls, transport };
}

const deliverySteps = (): Step[] => [
    { expect: /^MAIL FROM:<alerts@example\.test>$/u, reply: "250 ok\r\n" },
    { expect: /^RCPT TO:<a@example\.test>$/u, reply: "250 ok\r\n" },
    { expect: /^RCPT TO:<b@example\.test>$/u, reply: "251 forwarded\r\n" },
    { expect: /^DATA$/u, reply: "354 go ahead\r\n" },
    { expect: /^<DATA>/u, reply: "250 queued\r\n" },
    { expect: /^QUIT$/u, reply: "221 bye\r\n" },
];

test("sends over implicit TLS with AUTH PLAIN, dot-stuffed base64 body and closes the socket", async () => {
    const tls = new FakeSocket([
        { expect: /^EHLO example\.test$/u, reply: "250-smtp.example.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n" },
        { expect: /^AUTH PLAIN /u, reply: "235 authenticated\r\n" },
        ...deliverySteps(),
    ]);
    const { calls, transport } = fakeTransport({ tls });
    await sendSmtpMail(transport, { hostname: "smtp.example.test", port: 465, tls: "implicit", ...credentials }, message, () => new Date("2026-10-01T12:00:00.000Z"));
    assert.deepEqual(calls, ["connectTls smtp.example.test:465"]);
    assert.equal(tls.received[1], `AUTH PLAIN ${base64("\0bot\0secret")}`);
    assert.deepEqual(tls.received.filter((entry) => !entry.startsWith("<DATA>")), [
        "EHLO example.test", tls.received[1], "MAIL FROM:<alerts@example.test>", "RCPT TO:<a@example.test>", "RCPT TO:<b@example.test>", "DATA", "QUIT",
    ]);
    const data = tls.received.find((entry) => entry.startsWith("<DATA>"))!.slice("<DATA>".length);
    const [headers, body] = data.split("\r\n\r\n");
    assert.match(headers, /^From: <alerts@example\.test>\r\nTo: <a@example\.test>, <b@example\.test>\r\nSubject: Region request: France\r\nDate: Thu, 01 Oct 2026 12:00:00 \+0000\r\nMessage-ID: <[0-9a-f-]{36}@example\.test>\r\nMIME-Version: 1\.0\r\nContent-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64$/u);
    assert.equal(Buffer.from(body.replace(/\r\n/gu, ""), "base64").toString("utf8"), message.text);
    assert.ok(!data.includes("\n.Line"), "the encoded body never exposes a bare leading dot");
    assert.equal(tls.closed, true);
});

test("upgrades with STARTTLS before any credential and falls back to AUTH LOGIN", async () => {
    const plain = new FakeSocket([
        { expect: /^EHLO example\.test$/u, reply: "250-smtp.example.test\r\n250 STARTTLS\r\n" },
        { expect: /^STARTTLS$/u, reply: "220 ready\r\n" },
    ]);
    const upgraded = new FakeSocket([
        { expect: /^EHLO example\.test$/u, reply: "250-smtp.example.test\r\n250 AUTH LOGIN\r\n" },
        { expect: /^AUTH LOGIN$/u, reply: "334 VXNlcm5hbWU6\r\n" },
        { expect: new RegExp(`^${base64("bot")}$`, "u"), reply: "334 UGFzc3dvcmQ6\r\n" },
        { expect: new RegExp(`^${base64("secret")}$`, "u"), reply: "235 authenticated\r\n" },
        ...deliverySteps(),
    ], "");
    const { calls, transport } = fakeTransport({ plain, upgraded });
    await sendSmtpMail(transport, { hostname: "smtp.example.test", port: 2525, tls: "starttls", ...credentials }, message);
    assert.deepEqual(calls, ["connect smtp.example.test:2525", "startTls smtp.example.test"]);
    assert.deepEqual(plain.received, ["EHLO example.test", "STARTTLS"]);
    assert.equal(upgraded.received[1], "AUTH LOGIN");
    assert.equal(upgraded.closed, true);
});

test("never authenticates when STARTTLS is unavailable or data arrives before the upgrade", async () => {
    const missing = new FakeSocket([{ expect: /^EHLO/u, reply: "250 smtp.example.test\r\n" }]);
    await assert.rejects(
        sendSmtpMail(fakeTransport({ plain: missing }).transport, { hostname: "smtp.example.test", port: 2525, tls: "starttls", ...credentials }, message),
        (error: unknown) => error instanceof SmtpError && /STARTTLS/u.test(error.message),
    );
    assert.deepEqual(missing.received, ["EHLO example.test"]);
    assert.equal(missing.closed, true);

    const injected = new FakeSocket([
        { expect: /^EHLO/u, reply: "250-smtp.example.test\r\n250 STARTTLS\r\n" },
        { expect: /^STARTTLS$/u, reply: "220 ready\r\n250 injected\r\n" },
    ]);
    const { calls, transport } = fakeTransport({ plain: injected, upgraded: new FakeSocket([], "") });
    await assert.rejects(
        sendSmtpMail(transport, { hostname: "smtp.example.test", port: 2525, tls: "starttls", ...credentials }, message),
        (error: unknown) => error instanceof SmtpError && /before TLS upgrade/u.test(error.message),
    );
    assert.deepEqual(calls, ["connect smtp.example.test:2525"]);
    assert.equal(injected.closed, true);
});

test("surfaces rejected commands without sending the message body", async () => {
    const tls = new FakeSocket([
        { expect: /^EHLO/u, reply: "250-smtp.example.test\r\n250 AUTH PLAIN\r\n" },
        { expect: /^AUTH PLAIN/u, reply: "235 ok\r\n" },
        { expect: /^MAIL FROM/u, reply: "250 ok\r\n" },
        { expect: /^RCPT TO:<a@example\.test>$/u, reply: "550 5.1.1 no such user\r\n" },
    ]);
    await assert.rejects(
        sendSmtpMail(fakeTransport({ tls }).transport, { hostname: "smtp.example.test", port: 465, tls: "implicit", ...credentials }, message),
        (error: unknown) => error instanceof SmtpError && error.message === "SMTP RCPT rejected: 550 5.1.1 no such user",
    );
    assert.ok(!tls.received.includes("DATA"));
    assert.equal(tls.closed, true);

    const unsupported = new FakeSocket([{ expect: /^EHLO/u, reply: "250-smtp.example.test\r\n250 AUTH XOAUTH2\r\n" }]);
    await assert.rejects(
        sendSmtpMail(fakeTransport({ tls: unsupported }).transport, { hostname: "smtp.example.test", port: 465, tls: "implicit", ...credentials }, message),
        /no supported authentication/u,
    );
    assert.deepEqual(unsupported.received, ["EHLO example.test"]);
});

test("times out and closes the socket when the server stops replying", async () => {
    const tls = new FakeSocket([{ expect: /^EHLO/u, reply: "250-smtp.example.test\r\n250 AUTH PLAIN\r\n" }]);
    await assert.rejects(
        sendSmtpMail(fakeTransport({ tls }).transport, { hostname: "smtp.example.test", port: 465, tls: "implicit", timeoutMilliseconds: 50, ...credentials }, message),
        (error: unknown) => error instanceof SmtpError && error.message === "SMTP timeout",
    );
    assert.equal(tls.closed, true);
});

test("rejects invalid addresses before opening a connection", async () => {
    const { calls, transport } = fakeTransport({});
    const options = { hostname: "smtp.example.test", port: 465, tls: "implicit" as const, ...credentials };
    await assert.rejects(sendSmtpMail(transport, options, { ...message, to: ["not an address"] }), /Invalid recipient/u);
    await assert.rejects(sendSmtpMail(transport, options, { ...message, to: [] }), /Invalid recipient/u);
    await assert.rejects(sendSmtpMail(transport, options, { ...message, from: "a@example.test\r\nRCPT TO:<x@y.z>" }), /Invalid sender/u);
    await assert.rejects(sendSmtpMail(transport, options, { ...message, fromName: "Bannerlord\r\nBcc: x@y.z" }), /Invalid sender name/u);
    await assert.rejects(sendSmtpMail(transport, options, { ...message, fromName: "x".repeat(101) }), /Invalid sender name/u);
    assert.deepEqual(calls, []);
});

test("formats the sender display name as a quoted string or encoded word", () => {
    const meta = { date: new Date("2026-10-01T00:00:00.000Z"), messageId: "id@example.test" };
    const base = { from: "a@example.test", to: ["b@example.test"], subject: "Hi", text: "x" };
    assert.ok(encodeMessage({ ...base, fromName: "Bannerlord Coop" }, meta).startsWith(`From: "Bannerlord Coop" <a@example.test>\r\n`));
    assert.ok(encodeMessage({ ...base, fromName: " " }, meta).startsWith("From: <a@example.test>\r\n"));
    assert.ok(encodeMessage({ ...base, fromName: `Coop "Team"` }, meta).startsWith(`From: =?utf-8?B?${base64(`Coop "Team"`)}?= <a@example.test>\r\n`));
    assert.ok(encodeMessage({ ...base, fromName: "Équipe" }, meta).startsWith(`From: =?utf-8?B?${base64("Équipe")}?= <a@example.test>\r\n`));
});

test("encodes non-ASCII subjects and wraps the base64 body at 76 columns", () => {
    const encoded = encodeMessage({ from: "a@example.test", to: ["b@example.test"], subject: "Région française", text: "x".repeat(200) }, { date: new Date("2026-10-01T00:00:00.000Z"), messageId: "id@example.test" });
    assert.ok(encoded.includes(`Subject: =?utf-8?B?${base64("Région française")}?=\r\n`));
    const body = encoded.split("\r\n\r\n")[1];
    assert.ok(body.split("\r\n").every((line) => line.length <= 76 && line.length > 0));
    assert.equal(Buffer.from(body.replace(/\r\n/gu, ""), "base64").toString("utf8"), "x".repeat(200));
});
