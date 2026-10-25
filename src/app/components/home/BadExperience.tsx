"use client";

import { useState, type ReactNode } from "react";
import { BadgeCheck, Cookie, Crown, MessageCircleQuestion, X } from "lucide-react";
import "./BadExperience.css";

const cookiePaperwork = [
    {
        heading: "This kingdom uses cookies.",
        description: "And biscuits. And 847 trusted imaginary partners who would love to know your horse's maiden name.",
        decline: "Reject unnecessary cookies",
    },
    {
        heading: "Are you sure you're sure?",
        description: "The Royal Cookie Council has received your request to make a request. Please confirm your confirmation.",
        decline: "Yes, reject them",
    },
    {
        heading: "Think of the tiny bakers.",
        description: "One final click and your refusal will be forwarded to the Department of Ignoring Refusals.",
        decline: "I still reject them",
    },
] as const;

const unhelpfulTips = [
    "It looks like you're trying to use a website. Have you tried clicking something?",
    "To download the mod, first locate the download button. Hope this helps!",
    "Your request is important to us. You are number 9,431 in a queue of 9,431.",
    "Have you considered refreshing? You get to do the cookie paperwork again!",
] as const;

/** Keeps the homepage's deliberate inconveniences local to this route. */
export function BadExperience({ children }: { children: ReactNode }) {
    const [cookieStep, setCookieStep] = useState(0);
    const [cookiesOpen, setCookiesOpen] = useState(true);
    const [assistantOpen, setAssistantOpen] = useState(true);
    const [tip, setTip] = useState(0);
    const [notice, setNotice] = useState("");
    const paperwork = cookiePaperwork[cookieStep];

    function finishPaperwork(accepted: boolean) {
        setCookiesOpen(false);
        setNotice(accepted
            ? "847 imaginary partners are delighted. No actual preferences were saved."
            : "Refusal filed. Please allow 6–8 business centuries. No actual preferences were saved.");
    }

    return (
        <div className="bad-ux">
            <div lang="en" className="bad-ux-bulletin">
                <span className="bad-ux-new">NEW!</span>
                <div className="bad-ux-ticker-window">
                    <p className="bad-ux-ticker">BY ROYAL DECREE: THE WEBSITE HAS BEEN IMPROVED AGAIN &nbsp; ★ &nbsp; NOW WITH 38% MORE CLICKS &nbsp; ★ &nbsp; BEST VIEWED ON A SIEGE ENGINE &nbsp; ★ &nbsp; PLEASE DO NOT ENJOY RESPONSIBLY</p>
                </div>
                <span className="bad-ux-counter">VISITOR #000042</span>
            </div>

            <div lang="en" className="bad-ux-welcome">
                <Crown aria-hidden="true" className="size-9 shrink-0" />
                <div>
                    <p className="text-xs font-bold uppercase tracking-widest">The Royal Calradian Internet Portal™</p>
                    <p className="text-sm">An unnecessarily epic browsing experience. Under construction since 1084.</p>
                </div>
                <span className="bad-ux-seal"><BadgeCheck aria-hidden="true" className="size-5" /> 0% user tested</span>
            </div>

            {children}

            <div lang="en" className="bad-ux-statusbar">
                <span>⚠ Optimizing your inconvenience…</span>
                <button type="button" onClick={() => { setCookieStep(0); setCookiesOpen(true); setNotice(""); }}>Cookie paperwork</button>
                <span className="hidden sm:inline">Connection: one very tired pigeon</span>
            </div>

            <div lang="en" className="bad-ux-notice" role="status">{notice}</div>

            {cookiesOpen && (
                <section lang="en" className="bad-ux-cookies" aria-labelledby="royal-cookie-heading">
                    <div className="bad-ux-window-title">
                        <span className="flex items-center gap-2"><Cookie aria-hidden="true" className="size-4" /> cookie_policy_FINAL_v7_revised.exe</span>
                        <span>{cookieStep + 1}/3</span>
                    </div>
                    <div className="p-4 sm:p-5">
                        <p className="bad-ux-eyebrow">Mandatory optional paperwork</p>
                        <h2 id="royal-cookie-heading" className="mt-1 text-2xl font-black">{paperwork.heading}</h2>
                        <p className="mt-2 text-sm leading-relaxed">{paperwork.description}</p>
                        <div className="mt-4 flex flex-wrap items-center gap-4">
                            <button type="button" className="bad-ux-accept" onClick={() => finishPaperwork(true)}>ACCEPT ALL 847 ✨</button>
                            <button type="button" className="bad-ux-reject" onClick={() => {
                                if (cookieStep === cookiePaperwork.length - 1) finishPaperwork(false);
                                else setCookieStep(cookieStep + 1);
                            }}>{paperwork.decline}</button>
                        </div>
                        <p className="mt-3 text-[10px] text-[#555]">A completely fictional cookie council. Refreshing restarts the bureaucracy.</p>
                    </div>
                </section>
            )}

            <aside lang="en" className="bad-ux-assistant" aria-label="Unhelpful royal assistant">
                {assistantOpen ? (
                    <>
                        <div className="bad-ux-window-title">
                            <span>Sir Clicks-a-Lot • Online-ish</span>
                            <button type="button" aria-label="Dismiss royal assistant" onClick={() => setAssistantOpen(false)}><X aria-hidden="true" className="size-4" /></button>
                        </div>
                        <div className="p-4">
                            <div className="flex items-start gap-3">
                                <span aria-hidden="true" className="text-4xl">🧙‍♂️</span>
                                <p className="text-sm leading-relaxed" aria-live="polite">{unhelpfulTips[tip]}</p>
                            </div>
                            <button type="button" className="bad-ux-help mt-3" onClick={() => setTip((tip + 1) % unhelpfulTips.length)}>That didn&apos;t help. Tell me more.</button>
                        </div>
                    </>
                ) : (
                    <button type="button" className="bad-ux-help flex items-center gap-2" onClick={() => setAssistantOpen(true)}><MessageCircleQuestion aria-hidden="true" className="size-5" /> Need unsolicited help?</button>
                )}
            </aside>
        </div>
    );
}
