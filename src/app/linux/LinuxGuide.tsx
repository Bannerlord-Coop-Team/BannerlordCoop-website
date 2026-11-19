"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import distroData from "./content/distros.json";
import sectionData from "./content/sections.json";
import { GuideProvider, GuideSection, scopeSvg } from "./Blocks";
import {
    WIZARD_STEPS,
    guideCopy,
    parseRoute,
    routeHash,
    type Distro,
    type GuideRoute,
    type Section,
} from "./guide-model";
import type { GuidePack } from "./messages";
import "./linux-guide.css";

const sections = (sectionData as { sections: Section[] }).sections;
const distros = distroData as Distro[];
const sectionIds = new Set(sections.map((section) => section.id));
const DISTRO_KEY = "blc-distro-v1";

function needsDistro(route: GuideRoute): boolean {
    if (route.view === "wizard") return true;
    if (route.view === "manual" && route.section !== "faq" && !route.openAi) return true;
    return false;
}

const distroListeners = new Set<() => void>();

function subscribeHash(onChange: () => void) {
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
        window.removeEventListener("hashchange", onChange);
        window.removeEventListener("popstate", onChange);
    };
}

function subscribeDistro(onChange: () => void) {
    distroListeners.add(onChange);
    const onStorage = (event: StorageEvent) => {
        if (event.key === DISTRO_KEY) onChange();
    };
    window.addEventListener("storage", onStorage);
    return () => {
        distroListeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
    };
}

function readDistro(): string | null {
    try {
        const value = localStorage.getItem(DISTRO_KEY);
        return value && distros.some((item) => item.id === value) ? value : null;
    } catch {
        return null;
    }
}

function emitDistro() {
    distroListeners.forEach((listener) => listener());
}

function readHash() {
    return window.location.hash;
}

/** Interactive Linux setup guide: distro picker, one-step wizard, checklist and FAQ. */
export function LinuxGuide({ pack }: { pack: GuidePack }) {
    const copy = useMemo(() => guideCopy(pack), [pack]);
    const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
    const distroId = useSyncExternalStore(subscribeDistro, readDistro, () => null);
    const requested = parseRoute(hash, sectionIds);
    const route = needsDistro(requested) && !distroId ? { view: "distro" as const } : requested;
    const [pending, setPending] = useState<GuideRoute | null>(null);
    const [status, setStatus] = useState("");
    const [term, setTerm] = useState<{ title: string; body: string; left: number; top: number } | null>(null);
    const distro = distros.find((item) => item.id === distroId) ?? null;

    const go = useCallback((next: GuideRoute, mode: "push" | "replace" = "push") => {
        const nextHash = routeHash(next);
        if (mode === "replace") window.history.replaceState(null, "", nextHash);
        else window.history.pushState(null, "", nextHash);
        window.dispatchEvent(new Event("hashchange"));
        window.scrollTo({ top: 0, behavior: "auto" });
    }, []);

    function chooseDistro(id: string) {
        try {
            localStorage.setItem(DISTRO_KEY, id);
        } catch {
            /* private mode can refuse storage; the choice still applies to this visit */
        }
        emitDistro();
        const resume = pending;
        setPending(null);
        if (resume) go(resume, "replace");
        else window.scrollTo({ top: 0, behavior: "auto" });
        setStatus(copy.t(distros.find((item) => item.id === id)?.name || id));
    }

    const wizardIndex = route.view === "wizard" ? Math.max(0, WIZARD_STEPS.indexOf(route.step as (typeof WIZARD_STEPS)[number])) : 0;
    const wizardId = WIZARD_STEPS[wizardIndex];
    const wizardSection = sections.find((section) => section.id === wizardId);

    useEffect(() => {
        if (route.view !== "wizard") return;
        function onKey(event: KeyboardEvent) {
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, select, pre, [role='tablist']")) return;
            if (event.key === "ArrowRight") {
                event.preventDefault();
                const next = WIZARD_STEPS[Math.min(wizardIndex + 1, WIZARD_STEPS.length - 1)];
                if (wizardIndex >= WIZARD_STEPS.length - 1) go({ view: "start" });
                else go({ view: "wizard", step: next });
            }
            if (event.key === "ArrowLeft" && wizardIndex > 0) {
                event.preventDefault();
                go({ view: "wizard", step: WIZARD_STEPS[wizardIndex - 1] });
            }
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [go, route.view, wizardIndex]);

    const here = route.view === "wizard"
        ? copy.t("Step-by-step")
        : route.view === "distro"
            ? copy.t("Choose your distro")
            : route.view === "manual"
                ? copy.t(sections.find((section) => section.id === route.section)?.title || "Full checklist")
                : "";
    const shortHere = route.view === "manual" && !route.section ? copy.nav("dFullShort") : route.view === "manual" && route.section === "terminal" ? copy.nav("dCliShort") : "";
    const showDistro = Boolean(distro) && (route.view === "wizard" || (route.view === "manual" && route.section !== "faq"));
    const progress = route.view === "wizard" ? copy.tKey("ui.step_of", "Step {n} of {total}", { n: wizardIndex + 1, total: WIZARD_STEPS.length }) : "";
    const nextLabel = wizardIndex >= WIZARD_STEPS.length - 1
        ? copy.t("Finish")
        : copy.tKey("ui.next_colon", "Next: {title}", { title: copy.t(sections.find((section) => section.id === WIZARD_STEPS[wizardIndex + 1])?.title || "") });

    const provider = {
        copy,
        distro,
        sections,
        showFolded: false,
        forceOpenId: route.view === "manual" && route.openAi ? "faq-ai-assistant" : undefined,
        onStatus: setStatus,
    };

    return (
        <GuideProvider value={provider}>
            <main
                id="linux-guide"
                className={`linux-guide${route.view === "wizard" ? " is-wizard" : ""}${route.view === "manual" || route.view === "distro" ? " is-wide" : ""}`}
                aria-label={copy.t("Guide content")}
                onClick={(event) => {
                    const button = (event.target as HTMLElement).closest("button.term-def");
                    if (!button) {
                        if (term && !(event.target as HTMLElement).closest(".term-popover")) setTerm(null);
                        return;
                    }
                    event.preventDefault();
                    const rect = button.getBoundingClientRect();
                    setTerm({
                        title: button.getAttribute("data-term") || "",
                        body: button.getAttribute("data-def") || "",
                        left: Math.max(16, Math.min(rect.left, window.innerWidth - 336)),
                        top: rect.bottom + 10,
                    });
                }}
            >
                <div className="linux-backdrop" aria-hidden="true" />
                <p className="sr-only" role="status" aria-live="polite">{status}</p>
                {route.view !== "start" && (
                    <nav className="subnav" aria-label={copy.t("Guide")}>
                        <div className="subnav-inner">
                            <button type="button" className="subnav-back" onClick={() => go({ view: "start" })}>
                                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                <span>{copy.t("Menu")}</span>
                            </button>
                            <span className="subnav-sep" aria-hidden="true">/</span>
                            <span className="subnav-here" aria-current="page" data-short={shortHere || undefined}>{here}</span>
                            {showDistro && distro && (
                                <div className="subnav-distro" role="group" aria-label={copy.nav("dYour").replace(/[:：]\s*$/, "")} style={{ ["--d" as string]: distro.color }}>
                                    <span className="subnav-distro-ico" aria-hidden="true" dangerouslySetInnerHTML={{ __html: scopeSvg(distro.svg, "subnav") }} />
                                    <strong className="subnav-distro-name">{copy.t(distro.name)}</strong>
                                    <button type="button" className="subnav-change" data-short={copy.nav("dChangeShort")} onClick={() => { setPending(route); go({ view: "distro" }); }}>
                                        {copy.nav("dChange")}
                                    </button>
                                </div>
                            )}
                            {route.view === "wizard" && <p className="subnav-step">{progress}</p>}
                        </div>
                        {route.view === "wizard" && (
                            <div className="progress subnav-progress" role="progressbar" aria-valuemin={1} aria-valuemax={WIZARD_STEPS.length} aria-valuenow={wizardIndex + 1} aria-valuetext={progress}>
                                <span style={{ width: `${((wizardIndex + 1) / WIZARD_STEPS.length) * 100}%` }} />
                            </div>
                        )}
                    </nav>
                )}

                {route.view === "start" && (
                    <section className="view is-active" aria-labelledby="start-title">
                        <div className="measure measure-start">
                            <p className="step-kicker">{copy.t("Linux setup guide")}</p>
                            <h1 className="step-title" id="start-title">{copy.t("How do you want to set this up?")}</h1>
                            <p className="step-sub">{copy.t("Install and run Bannerlord Co-op on Linux.")}</p>
                            <div className="flow">
                                <button type="button" className="choice choice-recommended" onClick={() => go({ view: "wizard", step: WIZARD_STEPS[0] })}>
                                    <span className="recommendation">{copy.t("Recommended")}</span>
                                    <strong>{copy.t("Step-by-step")}</strong>
                                    <span className="muted">{copy.t("Walk through one task at a time.")}</span>
                                </button>
                                <button type="button" className="choice" onClick={() => go({ view: "manual", section: "terminal" })}>
                                    <strong>{copy.t("Install with one script")}</strong>
                                    <span className="muted">{copy.t("One copy-paste script for your distro.")}</span>
                                </button>
                                <button type="button" className="choice" onClick={() => go({ view: "manual" })}>
                                    <strong>{copy.t("Full checklist")}</strong>
                                    <span className="muted">{copy.t("Read every stage on a single page.")}</span>
                                </button>
                                <button type="button" className="choice" onClick={() => go({ view: "manual", section: "faq" })}>
                                    <strong>{copy.t("FAQ")}</strong>
                                    <span className="muted">{copy.t("Quick answers and Linux notes.")}</span>
                                </button>
                            </div>
                        </div>
                    </section>
                )}

                {route.view === "distro" && (
                    <section className="view is-active" aria-labelledby="distro-title">
                        <div className="measure measure-start">
                            <p className="step-kicker">{copy.t("Linux setup guide")}</p>
                            <h1 className="step-title" id="distro-title">{copy.nav("dTitle")}</h1>
                            <p className="step-sub">{copy.nav("dSub")}</p>
                            <div className="flow distro-flow" role="group" aria-label={copy.nav("dGroup")}>
                                {distros.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="choice distro-opt"
                                        style={{ ["--d" as string]: item.color, ["--ig" as string]: item.glyph }}
                                        aria-pressed={item.id === distroId}
                                        onClick={() => chooseDistro(item.id)}
                                    >
                                        <span className={item.art ? "distro-ico is-art" : "distro-ico"} dangerouslySetInnerHTML={{ __html: scopeSvg(item.svg, item.id) }} />
                                        <strong>{copy.t(item.name)}</strong>
                                        <span className="muted">{copy.nav(item.blurbKey)}</span>
                                    </button>
                                ))}
                            </div>
                            {distroId && pending && (
                                <p className="distro-actions">
                                    <button type="button" className="btn btn-sm" onClick={() => chooseDistro(distroId)}>{copy.nav("dKeep")}</button>
                                </p>
                            )}
                        </div>
                    </section>
                )}

                {route.view === "wizard" && wizardSection && (
                    <section className="view is-active" aria-labelledby="wizard-live">
                        <h1 id="wizard-live" className="sr-only">{progress}: {copy.t(wizardSection.title)}</h1>
                        <div className="measure wizard-stage">
                            <GuideSection section={wizardSection} wizard alone />
                        </div>
                        <div className="wiz-footer">
                            {wizardIndex > 0 && (
                                <button type="button" className="btn" onClick={() => go({ view: "wizard", step: WIZARD_STEPS[wizardIndex - 1] })}>{copy.t("Previous")}</button>
                            )}
                            <button type="button" className="btn" onClick={() => go({ view: "manual", section: "troubleshooting" })}>{copy.t("Help")}</button>
                            <button type="button" className="btn btn-primary" onClick={() => {
                                if (wizardIndex >= WIZARD_STEPS.length - 1) go({ view: "start" });
                                else go({ view: "wizard", step: WIZARD_STEPS[wizardIndex + 1] });
                            }}>{nextLabel}</button>
                        </div>
                    </section>
                )}

                {(route.view === "manual" || route.view === "start") && (
                    <section className={`view${route.view === "manual" ? " is-active" : ""}`} hidden={route.view !== "manual" ? true : undefined} aria-labelledby={route.view === "manual" ? "manual-title" : undefined}>
                        <div className="measure pad">
                            {route.view === "manual" && !route.section ? (
                                <div className="manual-page-head">
                                    <h1 className="step-title" id="manual-title">{copy.t("Full checklist")}</h1>
                                    <p className="step-sub">{copy.t("All install stages on one page.")}</p>
                                </div>
                            ) : null}
                            {(route.view === "manual" && route.section ? sections.filter((section) => section.id === route.section) : sections).map((section) => (
                                <GuideSection key={section.id} section={section} alone={route.view === "manual" && Boolean(route.section)} />
                            ))}
                        </div>
                    </section>
                )}

                {term && (
                    <div className="term-popover" role="tooltip" style={{ left: term.left, top: term.top }}>
                        <p className="term-popover-title">{term.title}</p>
                        <p className="term-popover-body">{term.body}</p>
                    </div>
                )}
            </main>
        </GuideProvider>
    );
}
