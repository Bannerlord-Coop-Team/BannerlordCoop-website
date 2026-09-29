import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const fixture = JSON.parse(await readFile(new URL("./dev-login/fixture.json", import.meta.url), "utf8"));

/** Creates or resets the known local account through GoTrue, without writing auth tables directly. */
export async function seedLocalAuth(url, serviceRoleKey, request = fetch) {
    if (!["https://supabase-tls.localhost:8443"].includes(url)) throw new Error("Auth seeding is restricted to the local Supabase gateway");
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
    const headers = { authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, "content-type": "application/json" };
    const accountUrl = `${url}/auth/v1/admin/users/${fixture.accountId}`;
    const existing = await request(accountUrl, { headers });
    if (!existing.ok && existing.status !== 404) throw new Error(`Local auth lookup failed (${existing.status})`);
    const create = existing.status === 404;
    const response = await request(create ? `${url}/auth/v1/admin/users` : accountUrl, {
        method: create ? "POST" : "PUT", headers,
        body: JSON.stringify({ ...(create ? { id: fixture.accountId } : {}), email: fixture.email, password: fixture.password, email_confirm: true }),
    });
    if (!response.ok) throw new Error(`Local auth seed failed (${response.status})`);
    const user = await response.json();
    if (user.id !== fixture.accountId || user.email !== fixture.email) throw new Error("Local auth seed returned an unexpected identity");
    return { accountId: user.id, email: user.email };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = await seedLocalAuth("https://supabase-tls.localhost:8443", process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log(`Seeded local account ${result.accountId} (${result.email}).`);
}
