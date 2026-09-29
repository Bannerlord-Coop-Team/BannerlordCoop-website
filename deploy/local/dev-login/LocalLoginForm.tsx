"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import fixture from "./fixture.json";

/** Signs into real local Supabase Auth using the seeded development credentials. */
export function LocalLoginForm() {
    const router = useRouter();
    const [email, setEmail] = useState(fixture.email);
    const [password, setPassword] = useState(fixture.password);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    /** Exchanges the local password for a normal Supabase session before opening the server directory. */
    async function signIn(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError("");
        try {
            const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
            if (error) throw error;
            router.push("/servers");
            router.refresh();
        } catch {
            setError("Sign-in failed. Check that the local stack is running and its account seed completed.");
            setPending(false);
        }
    }

    return <form onSubmit={signIn} className="space-y-4">
        <label className="block">Email<input className="mt-1 block w-full rounded border p-2" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
        <label className="block">Password<input className="mt-1 block w-full rounded border p-2" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <button className="rounded border px-4 py-2 disabled:opacity-50" disabled={pending}>{pending ? "Signing in…" : "Sign in locally"}</button>
        {error && <p role="alert">{error}</p>}
    </form>;
}
