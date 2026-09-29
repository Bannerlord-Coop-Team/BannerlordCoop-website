import { notFound } from "next/navigation";
import { LocalLoginForm } from "./LocalLoginForm";

/** Exposes disposable password login only in the local image with local Supabase configured. */
export default function LocalLoginPage() {
    if (process.env.NODE_ENV !== "development" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://supabase-tls.localhost:8443") notFound();
    return <main className="mx-auto max-w-md space-y-6 px-6 py-16">
        <h1 className="text-2xl font-semibold">Local development sign-in</h1>
        <p>Disposable local account. No email delivery or external OAuth is used.</p>
        <LocalLoginForm />
    </main>;
}
