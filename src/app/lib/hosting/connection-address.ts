/** Current managed profiles advertise one game port per slot; use that persisted port. */
export function connectionAddress(ip: string | null, ports: readonly number[]): string | null {
    const host = typeof ip === "string" ? ip.trim() : null;
    const port = Array.isArray(ports) ? ports[0] : undefined;
    if (!host || /[\s/\\?#@]/u.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    // Brackets keep IPv6 addresses unambiguous when a port is appended.
    const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `${address}:${port}`;
}
