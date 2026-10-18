// Minimal SMTP submission client for the Supabase Edge runtime (Deno). One message per
// call, TLS mandatory: implicit TLS on connect or STARTTLS before any credential is sent.
// Sockets are injected so Node tests can script a fake server.
const EMAIL_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/u;
const MAXIMUM_REPLY_BYTES = 16 * 1_024;
const MAXIMUM_SUBJECT_LENGTH = 200;
const MAXIMUM_NAME_LENGTH = 100;
const DEFAULT_TIMEOUT_MILLISECONDS = 15_000;
const CRLF = "\r\n";

export type SmtpSocket = {
    read(buffer: Uint8Array): Promise<number | null>;
    write(data: Uint8Array): Promise<number>;
    close(): void;
};
export type SmtpTransport = {
    connect(target: { hostname: string; port: number }): Promise<SmtpSocket>;
    connectTls(target: { hostname: string; port: number }): Promise<SmtpSocket>;
    startTls(socket: SmtpSocket, target: { hostname: string }): Promise<SmtpSocket>;
};
export type SmtpOptions = {
    hostname: string;
    port: number;
    tls: "implicit" | "starttls";
    username: string;
    password: string;
    timeoutMilliseconds?: number;
};
export type SmtpMessage = { from: string; fromName?: string; to: readonly string[]; subject: string; text: string };
type Reply = { code: number; lines: string[] };

export class SmtpError extends Error {}

export function isEmailAddress(value: unknown): value is string {
    return typeof value === "string" && value.length <= 254 && EMAIL_ADDRESS.test(value);
}

export async function sendSmtpMail(
    transport: SmtpTransport,
    options: SmtpOptions,
    message: SmtpMessage,
    now: () => Date = () => new Date(),
): Promise<void> {
    if (!isEmailAddress(message.from)) throw new SmtpError("Invalid sender address");
    if (message.to.length === 0 || !message.to.every(isEmailAddress)) throw new SmtpError("Invalid recipient address");
    if (message.fromName !== undefined && !isDisplayName(message.fromName)) throw new SmtpError("Invalid sender name");
    const domain = message.from.split("@")[1];
    const data = encodeMessage(message, { date: now(), messageId: `${crypto.randomUUID()}@${domain}` });
    const deadline = Date.now() + (options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS);
    const target = { hostname: options.hostname, port: options.port };
    const session = new Session(await connect(transport, options.tls, target, deadline), deadline);
    try {
        const greeting = await session.reply();
        if (greeting.code !== 220) throw new SmtpError(`SMTP greeting rejected: ${describe(greeting)}`);
        let ehlo = await session.command(`EHLO ${domain}`, "EHLO", [250]);
        if (options.tls === "starttls") {
            if (!capabilities(ehlo).has("STARTTLS")) throw new SmtpError("SMTP server does not offer STARTTLS");
            await session.command("STARTTLS", "STARTTLS", [220]);
            await session.upgrade(transport, options.hostname);
            ehlo = await session.command(`EHLO ${domain}`, "EHLO", [250]);
        }
        const mechanisms = authMechanisms(ehlo);
        if (mechanisms.has("PLAIN")) {
            await session.command(`AUTH PLAIN ${base64(`\0${options.username}\0${options.password}`)}`, "AUTH", [235]);
        } else if (mechanisms.has("LOGIN")) {
            await session.command("AUTH LOGIN", "AUTH", [334]);
            await session.command(base64(options.username), "AUTH", [334]);
            await session.command(base64(options.password), "AUTH", [235]);
        } else {
            throw new SmtpError("SMTP server offers no supported authentication mechanism");
        }
        await session.command(`MAIL FROM:<${message.from}>`, "MAIL", [250]);
        for (const recipient of message.to) await session.command(`RCPT TO:<${recipient}>`, "RCPT", [250, 251]);
        await session.command("DATA", "DATA", [354]);
        await session.send(dotStuff(data) + CRLF + "." + CRLF);
        const accepted = await session.reply();
        if (accepted.code !== 250) throw new SmtpError(`SMTP message rejected: ${describe(accepted)}`);
        // The message is accepted; a failed QUIT must not turn delivery into an error.
        try { await session.command("QUIT", "QUIT", [221]); } catch { /* delivered */ }
    } finally {
        session.close();
    }
}

export function encodeMessage(message: SmtpMessage, meta: { date: Date; messageId: string }): string {
    const headers = [
        `From: ${fromHeader(message)}`,
        `To: ${message.to.map((address) => `<${address}>`).join(", ")}`,
        `Subject: ${encodeSubject(message.subject)}`,
        `Date: ${meta.date.toUTCString().replace(/GMT$/u, "+0000")}`,
        `Message-ID: <${meta.messageId}>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
    ];
    return headers.join(CRLF) + CRLF + CRLF + wrap(base64(message.text), 76);
}

async function connect(
    transport: SmtpTransport,
    tls: SmtpOptions["tls"],
    target: { hostname: string; port: number },
    deadline: number,
): Promise<SmtpSocket> {
    const pending = tls === "implicit" ? transport.connectTls(target) : transport.connect(target);
    try {
        return await within(deadline, pending, null);
    } catch (error) {
        // A connection that completes after the deadline must not leak.
        pending.then((socket) => socket.close(), () => undefined);
        throw error;
    }
}

class Session {
    private buffer = new Uint8Array(0);
    constructor(private socket: SmtpSocket, private readonly deadline: number) {}

    async command(line: string, label: string, accepted: readonly number[]): Promise<Reply> {
        if (!PRINTABLE_ASCII.test(line)) throw new SmtpError(`Invalid SMTP ${label} command`);
        await this.send(line + CRLF);
        const reply = await this.reply();
        if (!accepted.includes(reply.code)) throw new SmtpError(`SMTP ${label} rejected: ${describe(reply)}`);
        return reply;
    }

    async send(text: string): Promise<void> {
        let data = new TextEncoder().encode(text);
        while (data.length > 0) {
            const written = await within(this.deadline, this.socket.write(data), () => this.socket.close());
            if (!Number.isInteger(written) || written <= 0) throw new SmtpError("SMTP connection closed");
            data = data.subarray(written);
        }
    }

    async reply(): Promise<Reply> {
        const lines: string[] = [];
        let code: number | null = null;
        for (;;) {
            const line = await this.line();
            const match = /^(\d{3})(?:([ -])(.*))?$/u.exec(line);
            if (match === null || (code !== null && Number(match[1]) !== code)) throw new SmtpError("Malformed SMTP reply");
            code = Number(match[1]);
            lines.push(match[3] ?? "");
            if (match[2] !== "-") return { code, lines };
        }
    }

    async upgrade(transport: SmtpTransport, hostname: string): Promise<void> {
        // Bytes received before the handshake would be a STARTTLS command-injection attempt.
        if (this.buffer.length !== 0) throw new SmtpError("Unexpected data before TLS upgrade");
        this.socket = await within(this.deadline, transport.startTls(this.socket, { hostname }), () => this.socket.close());
    }

    close(): void {
        try { this.socket.close(); } catch { /* already closed */ }
    }

    private async line(): Promise<string> {
        for (;;) {
            const newline = this.buffer.indexOf(0x0a);
            if (newline >= 0) {
                const end = newline > 0 && this.buffer[newline - 1] === 0x0d ? newline - 1 : newline;
                const line = new TextDecoder().decode(this.buffer.subarray(0, end));
                this.buffer = this.buffer.slice(newline + 1);
                return line;
            }
            if (this.buffer.length >= MAXIMUM_REPLY_BYTES) throw new SmtpError("SMTP reply too large");
            const chunk = new Uint8Array(4_096);
            const count = await within(this.deadline, this.socket.read(chunk), () => this.socket.close());
            if (count === null || count <= 0) throw new SmtpError("SMTP connection closed");
            const combined = new Uint8Array(this.buffer.length + count);
            combined.set(this.buffer);
            combined.set(chunk.subarray(0, count), this.buffer.length);
            this.buffer = combined;
        }
    }
}

function within<T>(deadline: number, promise: Promise<T>, cancel: (() => void) | null): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        cancel?.();
        promise.catch(() => undefined);
        return Promise.reject(new SmtpError("SMTP timeout"));
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { cancel?.(); reject(new SmtpError("SMTP timeout")); }, remaining);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function capabilities(ehlo: Reply): Set<string> {
    return new Set(ehlo.lines.slice(1).map((line) => line.trim().toUpperCase().split(/[ =]/u)[0]));
}

function authMechanisms(ehlo: Reply): Set<string> {
    const mechanisms = new Set<string>();
    for (const line of ehlo.lines.slice(1)) {
        const upper = line.trim().toUpperCase();
        if (upper.startsWith("AUTH ") || upper.startsWith("AUTH=")) {
            for (const mechanism of upper.slice(5).split(/[ =]/u)) if (mechanism) mechanisms.add(mechanism);
        }
    }
    return mechanisms;
}

function describe(reply: Reply): string {
    return `${reply.code} ${reply.lines[0] ?? ""}`.trim().slice(0, 200);
}

function isDisplayName(value: string): boolean {
    return value.trim().length > 0 && value.length <= MAXIMUM_NAME_LENGTH && !/[\x00-\x1f\x7f]/u.test(value);
}

function fromHeader(message: SmtpMessage): string {
    const name = message.fromName?.trim();
    if (!name) return `<${message.from}>`;
    const encoded = PRINTABLE_ASCII.test(name) && !/["\\]/u.test(name) ? `"${name}"` : `=?utf-8?B?${base64(name)}?=`;
    return `${encoded} <${message.from}>`;
}

function encodeSubject(subject: string): string {
    if (subject.length === 0 || subject.length > MAXIMUM_SUBJECT_LENGTH) throw new SmtpError("Invalid subject");
    return PRINTABLE_ASCII.test(subject) ? subject : `=?utf-8?B?${base64(subject)}?=`;
}

function dotStuff(data: string): string {
    return data.split(CRLF).map((line) => (line.startsWith(".") ? `.${line}` : line)).join(CRLF);
}

function wrap(value: string, width: number): string {
    const lines: string[] = [];
    for (let index = 0; index < value.length; index += width) lines.push(value.slice(index, index + width));
    return lines.join(CRLF);
}

function base64(value: string): string {
    let binary = "";
    for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
    return btoa(binary);
}
