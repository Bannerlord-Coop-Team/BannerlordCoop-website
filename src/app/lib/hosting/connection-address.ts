/** Current managed profiles advertise one game port per slot; use that persisted port. */
export function connectionAddress(ip: string | null, ports: readonly number[]): string | null {
    const host = typeof ip === "string" ? ip.trim() : null;
    const port = Array.isArray(ports) ? ports[0] : undefined;
    if (!host || /[\s/\\?#@]/u.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    // Brackets keep IPv6 addresses unambiguous when a port is appended.
    const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `${address}:${port}`;
}

// One IPv4 octet, 0 to 255 without leading zeros, and one IPv6 group of up to four hex digits.
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/u;
const IPV6_GROUP = /^[0-9A-Fa-f]{1,4}$/u;
const JOIN_ADDRESS = /^(?:(\d{1,3}(?:\.\d{1,3}){3})|\[([0-9A-Fa-f:.]+)\]):(\d{1,5})$/u;

/**
 * Whether a value is an address players can join as written: a real IPv4 address, or a real IPv6 address in
 * brackets, with a port from 1 to 65535. Runs in the browser as well as on the server.
 */
export function isJoinAddress(value: unknown): value is string {
    const match = typeof value === "string" ? JOIN_ADDRESS.exec(value) : null;
    if (match === null) return false;
    const port = Number(match[3]);
    return (match[1] !== undefined ? IPV4.test(match[1]) : isIPv6(match[2]!)) && port >= 1 && port <= 65_535;
}

// Eight groups, or fewer around one "::"; the last two may be written as an IPv4 address.
function isIPv6(value: string) {
    const halves = value.split("::");
    if (halves.length > 2) return false;
    const groups = halves.map((half) => half === "" ? [] : half.split(":"));
    const all = groups.flat();
    // Only the address's final group may be IPv4, so not one written before a trailing "::".
    const last = groups[groups.length - 1]!.at(-1);
    const tail = last !== undefined && last.includes(".") ? (IPV4.test(last) ? 2 : -1) : 0;
    if (tail < 0) return false;
    const hex = tail === 2 ? all.slice(0, -1) : all;
    if (!hex.every((group) => IPV6_GROUP.test(group))) return false;
    const count = hex.length + tail;
    return halves.length === 2 ? count <= 7 : count === 8;
}
