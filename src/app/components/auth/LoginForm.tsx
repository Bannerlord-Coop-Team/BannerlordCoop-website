"use client";

import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { ArrowRight, LoaderCircle, LockKeyhole, Mail, MailCheck } from "lucide-react";
import { FormEvent, ReactNode, useState } from "react";

type OAuthProvider = "google" | "discord";
type PendingAction = OAuthProvider | "email" | null;

function GoogleIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
            <path
                fill="#4285F4"
                d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
            />
            <path
                fill="#34A853"
                d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
            />
            <path
                fill="#FBBC05"
                d="M6.39 13.87A6 6 0 0 1 6.07 12c0-.65.11-1.28.32-1.87V7.51H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.49l3.35-2.62Z"
            />
            <path
                fill="#EA4335"
                d="M12 6.01c1.47 0 2.78.5 3.82 1.5l2.88-2.87A9.66 9.66 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z"
            />
        </svg>
    );
}

function DiscordIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
            <path d="M19.54 5.34A17.4 17.4 0 0 0 15.2 4a12 12 0 0 0-.55 1.13 16.1 16.1 0 0 0-5.3 0A12 12 0 0 0 8.8 4a17.5 17.5 0 0 0-4.34 1.35C1.72 9.4.98 13.34 1.35 17.22a17.7 17.7 0 0 0 5.32 2.69c.43-.58.81-1.2 1.14-1.84a11.4 11.4 0 0 1-1.8-.87l.44-.34a12.5 12.5 0 0 0 11.1 0l.44.34c-.58.34-1.18.63-1.8.87.33.64.71 1.26 1.14 1.84a17.6 17.6 0 0 0 5.32-2.69c.43-4.5-.74-8.4-3.11-11.88ZM8.34 14.83c-1.07 0-1.94-.98-1.94-2.18 0-1.2.85-2.18 1.94-2.18 1.08 0 1.95.99 1.93 2.18 0 1.2-.85 2.18-1.93 2.18Zm7.32 0c-1.07 0-1.94-.98-1.94-2.18 0-1.2.85-2.18 1.94-2.18 1.08 0 1.95.99 1.93 2.18 0 1.2-.85 2.18-1.93 2.18Z" />
        </svg>
    );
}

function ProviderButton({
    children,
    disabled,
    loading,
    onClick,
}: {
    children: ReactNode;
    disabled: boolean;
    loading: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="group flex min-h-13 w-full items-center justify-center gap-3 rounded-sm border border-white/15 bg-white/[0.035] px-4 font-label text-sm font-semibold uppercase tracking-[0.12em] text-foreground transition-all duration-200 hover:border-gold/55 hover:bg-gold/[0.06] hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
            {loading ? (
                <>
                    <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
                    Connecting
                </>
            ) : (
                children
            )}
        </button>
    );
}

export function LoginForm({
    initialError,
    nextPath,
}: {
    initialError?: string;
    nextPath?: string;
}) {
    const [email, setEmail] = useState("");
    const [pending, setPending] = useState<PendingAction>(null);
    const [error, setError] = useState(initialError ?? "");
    const [emailSent, setEmailSent] = useState(false);

    function callbackUrl() {
        const callback = new URL("/auth/callback", window.location.origin);
        if (nextPath) callback.searchParams.set("next", nextPath);
        return callback.toString();
    }

    function messageFrom(errorValue: unknown) {
        return errorValue instanceof Error
            ? errorValue.message
            : "Something went wrong. Please try again.";
    }

    async function signInWithProvider(provider: OAuthProvider) {
        setError("");
        setPending(provider);

        try {
            const supabase = getSupabaseBrowserClient();
            const { error: signInError } = await supabase.auth.signInWithOAuth({
                provider,
                options: { redirectTo: callbackUrl() },
            });

            if (signInError) throw signInError;
        } catch (signInError) {
            setError(messageFrom(signInError));
            setPending(null);
        }
    }

    async function signInWithEmail(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setPending("email");

        try {
            const supabase = getSupabaseBrowserClient();
            const { error: signInError } = await supabase.auth.signInWithOtp({
                email: email.trim(),
                options: {
                    emailRedirectTo: callbackUrl(),
                    shouldCreateUser: true,
                },
            });

            if (signInError) throw signInError;
            setEmailSent(true);
        } catch (signInError) {
            setError(messageFrom(signInError));
        } finally {
            setPending(null);
        }
    }

    if (emailSent) {
        return (
            <div className="py-4 text-center" aria-live="polite">
                <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-gold">
                    <MailCheck aria-hidden="true" className="size-6" />
                </div>
                <p className="mt-6 font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                    Dispatch sent
                </p>
                <h1 className="mt-3 font-display text-4xl font-semibold text-foreground">
                    Check your inbox
                </h1>
                <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-foreground-muted">
                    We sent a secure sign-in link to <strong className="font-medium text-foreground">{email}</strong>.
                    The link can only be used once.
                </p>
                <button
                    type="button"
                    onClick={() => {
                        setEmailSent(false);
                        setEmail("");
                    }}
                    className="mt-8 font-label text-xs font-semibold uppercase tracking-[0.16em] text-gold underline decoration-gold/40 underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                    Use a different email
                </button>
            </div>
        );
    }

    const isBusy = pending !== null;

    return (
        <>
            <div>
                <p className="font-label text-xs font-semibold uppercase tracking-[0.24em] text-gold">
                    Player access
                </p>
                <h1 className="mt-3 font-display text-4xl font-semibold leading-none tracking-tight text-foreground sm:text-5xl">
                    Return to the campaign.
                </h1>
                <p className="mt-4 max-w-md text-sm leading-6 text-foreground-muted sm:text-base">
                    Sign in to manage your profile and stay connected to your warband.
                </p>
            </div>

            {error && (
                <p
                    role="alert"
                    className="mt-6 border-l-2 border-crimson bg-crimson/10 px-3 py-2 text-sm leading-5 text-red-200"
                >
                    {error}
                </p>
            )}

            <div className={`${error ? "mt-4" : "mt-8"} grid gap-3 sm:grid-cols-2`}>
                <ProviderButton
                    disabled={isBusy}
                    loading={pending === "google"}
                    onClick={() => signInWithProvider("google")}
                >
                    <GoogleIcon />
                    Google
                </ProviderButton>
                <ProviderButton
                    disabled={isBusy}
                    loading={pending === "discord"}
                    onClick={() => signInWithProvider("discord")}
                >
                    <DiscordIcon />
                    Discord
                </ProviderButton>
            </div>

            <div className="my-7 flex items-center gap-4" aria-hidden="true">
                <span className="h-px flex-1 bg-white/10" />
                <span className="font-label text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-foreground-muted">
                    Or use email
                </span>
                <span className="h-px flex-1 bg-white/10" />
            </div>

            <form onSubmit={signInWithEmail}>
                <label
                    htmlFor="email"
                    className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground-muted"
                >
                    Email address
                </label>
                <div className="relative mt-2">
                    <Mail
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-foreground-muted"
                    />
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        disabled={isBusy}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="commander@example.com"
                        className="min-h-13 w-full rounded-sm border border-white/15 bg-background/65 py-3 pr-4 pl-11 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted hover:border-white/25 focus:border-gold/65 focus:ring-1 focus:ring-gold/30 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                </div>

                <button
                    type="submit"
                    disabled={isBusy}
                    className="group mt-4 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-sm border border-crimson bg-crimson px-5 font-label text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors duration-200 hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {pending === "email" ? (
                        <>
                            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                            Sending link
                        </>
                    ) : (
                        <>
                            Continue with email
                            <ArrowRight
                                aria-hidden="true"
                                className="size-4 transition-transform group-hover:translate-x-0.5"
                            />
                        </>
                    )}
                </button>
            </form>

            <div className="mt-6 flex items-start gap-3 border-t border-white/10 pt-5 text-xs leading-5 text-foreground-muted">
                <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold-muted" />
                <p>
                    We&apos;ll email you a one-time magic link. No password to remember, and we never post to your connected accounts.
                </p>
            </div>
        </>
    );
}
