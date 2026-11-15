// Renders the gateway's few remaining HTML pages: the create-build install page and the error page.

const SITE_HERO_IMAGE = "https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/07491ba62e3b038b16458402b4cc92dccf71b985/public/images/singleleader.png";

// Wraps an HTML page in a response with the gateway's locked-down security headers.
export function html(body: string, status = 200): Response {
    return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "content-security-policy": `default-src 'none'; img-src ${SITE_HERO_IMAGE}; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } });
}

// Lays out one branded gateway page around already-escaped content.
export function page(title: string, eyebrow: string, content: string, pageClass = ""): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#070806"><title>${escapeHtml(title)} | Bannerlord Co-op</title><style>${GATEWAY_CSS}</style></head><body><div class="backdrop" style="--hero:url('${SITE_HERO_IMAGE}')" aria-hidden="true"></div><header class="site-header"><a class="brand" href="/" aria-label="Bannerlord Co-op Nightly Access home"><span class="brand-mark" aria-hidden="true"><i></i><b></b></span><span>Bannerlord Co-op</span></a><span class="product-label">Nightly Access</span></header><main class="shell ${escapeHtml(pageClass)}"><section class="card"><div class="card-accent" aria-hidden="true"></div><p class="eyebrow">${escapeHtml(eyebrow)}</p>${content}</section></main><footer><span>Bannerlord Co-op</span><span class="footer-rule"></span><span>Private nightly gateway</span></footer></body></html>`;
}

// Renders the branded error page for one user-facing message.
export function errorPage(message: string): string {
    return page("Access unavailable", "Nightly access", `<div class="status-icon error" aria-hidden="true"><span>!</span></div><h1>Access <span>unavailable.</span></h1><p class="lede">${escapeHtml(message)}</p><div class="support-note"><strong>Need a hand?</strong><span><a href="https://discord.gg/bannerlordcoop">Ask in the Bannerlord Co-op Discord</a> and include the message shown above.</span></div>`, "status-page");
}

// Maps a gateway error code to the message shown on the HTML error page.
export function gatewayErrorMessage(code: string): string {
    if (code === "migration_in_progress") {
        return "Nightly access is briefly paused while account data is moved. Try again in a few minutes.";
    }
    if (code === "already_used") {
        return "That create-build installer link was already used. Ask staff for a new /create-build link.";
    }
    if (code === "expired_token") {
        return "That create-build installer link has expired.";
    }
    if (code === "pin_incomplete") {
        return "That create-build installer is not ready yet. Ask staff to run /create-build again.";
    }
    if (code === "pin_identity_conflict") {
        return "That create-build installer no longer matches this build. Ask staff for a new /create-build link.";
    }
    if (code === "pin_mint_unavailable") {
        return "Create-build installer links are not configured on this gateway.";
    }
    return "Access could not be verified. Run the installer again or ask in the Bannerlord Co-op Discord.";
}

const GATEWAY_CSS = `
:root{--background:#070806;--foreground:#e8e4da;--muted:#96938b;--dim:#67665f;--crimson:#8f1d23;--crimson-hover:#a4232a;--gold:#aa9760;--border:rgba(232,228,218,.12);--border-gold:rgba(170,151,96,.25)}
*{box-sizing:border-box}html{min-height:100%;background:var(--background)}body{min-height:100vh;margin:0;color:var(--foreground);background:var(--background);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;overflow-x:hidden}::selection{background:var(--crimson);color:#fff}.backdrop{position:fixed;inset:0;z-index:0;background-image:linear-gradient(90deg,rgba(7,8,6,.98) 0%,rgba(7,8,6,.91) 42%,rgba(7,8,6,.55) 100%),linear-gradient(0deg,#070806 0%,transparent 44%,rgba(7,8,6,.5) 100%),radial-gradient(circle at 23% 55%,rgba(143,29,35,.22),transparent 35%),var(--hero);background-size:cover;background-position:62% center}.backdrop:after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px);background-size:100% 4px;opacity:.45;mask-image:linear-gradient(to bottom,transparent,#000 20%,#000 80%,transparent)}
.site-header{position:relative;z-index:2;width:min(calc(100% - 3rem),1280px);height:76px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(232,228,218,.1)}.brand{display:flex;align-items:center;gap:12px;color:var(--foreground);text-decoration:none;font-family:Georgia,"Times New Roman",serif;font-size:17px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.brand-mark{position:relative;width:25px;height:25px;display:inline-block}.brand-mark i,.brand-mark b{position:absolute;left:11px;top:1px;width:3px;height:24px;background:var(--gold);transform:rotate(45deg);transform-origin:center}.brand-mark b{transform:rotate(-45deg)}.brand-mark i:after,.brand-mark b:after{content:"";position:absolute;width:9px;height:2px;background:var(--gold);left:-3px;top:16px}.product-label{font-size:11px;font-weight:650;letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
.shell{position:relative;z-index:1;width:min(calc(100% - 3rem),1280px);margin:auto;display:grid;grid-template-columns:repeat(12,1fr);padding:64px 0}.card{position:relative;grid-column:2/span 7;max-width:760px;padding:48px 52px 50px;background:linear-gradient(145deg,rgba(17,18,15,.96),rgba(10,11,9,.92));border:1px solid var(--border);box-shadow:0 28px 90px rgba(0,0,0,.38)}.card:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 0 0,rgba(170,151,96,.1),transparent 42%)}.card-accent{position:absolute;top:-1px;left:52px;width:80px;height:2px;background:var(--gold);box-shadow:0 0 18px rgba(170,151,96,.35)}.card>*:not(.card-accent){position:relative}.eyebrow{margin:0 0 17px;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:var(--gold)}h1{max-width:680px;margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(43px,5vw,70px);font-weight:500;line-height:.92;letter-spacing:-.035em;text-wrap:balance}h1 span{color:var(--crimson)}.lede{max-width:650px;margin:25px 0 0;color:var(--muted);font-size:16px;line-height:1.75;text-wrap:pretty}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:22px;margin-top:32px}.button{min-height:50px;display:inline-flex;align-items:center;justify-content:center;gap:16px;padding:14px 22px;border:1px solid var(--crimson);border-radius:2px;background:var(--crimson);color:#fff;text-decoration:none;font:700 12px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:.13em;text-transform:uppercase;cursor:pointer;transition:background .2s,border-color .2s,color .2s}.button:hover{background:var(--crimson-hover);border-color:var(--crimson-hover)}.button:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:3px}.fine-print{max-width:560px;margin:28px 0 0;padding-top:20px;border-top:1px solid var(--border);color:var(--dim);font-size:12px;line-height:1.65}
.support-note{display:grid;grid-template-columns:minmax(130px,.55fr) 1fr;gap:20px;margin-top:30px;padding:19px 20px;border-left:2px solid var(--gold);background:rgba(170,151,96,.055);font-size:12px;line-height:1.55}.support-note strong{color:var(--gold);font-size:10px;letter-spacing:.12em;text-transform:uppercase}.support-note span{color:var(--muted)}.support-note a{color:var(--foreground);text-underline-offset:3px}.support-note a:hover{color:var(--gold)}
.status-page .card{grid-column:3/span 6;max-width:680px}.status-icon{width:46px;height:46px;margin:0 0 25px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border-gold);color:var(--gold);font:500 24px/1 Georgia,serif;transform:rotate(45deg)}.status-icon>span{transform:rotate(-45deg)}.status-icon.error{border-color:rgba(143,29,35,.65);color:#cf555c}
footer{position:relative;z-index:2;width:min(calc(100% - 3rem),1280px);min-height:54px;margin:0 auto;display:flex;align-items:center;gap:13px;color:var(--dim);font-size:9px;font-weight:650;letter-spacing:.17em;text-transform:uppercase}footer>span:first-child{color:var(--muted)}.footer-rule{width:28px;height:1px;background:var(--crimson)}
@media(max-width:900px){.shell{display:block;width:min(calc(100% - 2rem),720px);padding:42px 0}.card,.status-page .card{max-width:none;padding:39px 34px}.site-header,footer{width:calc(100% - 2rem)}.backdrop{background-position:68% center}}
@media(max-width:600px){.site-header{height:66px}.brand{font-size:13px;letter-spacing:.08em}.brand-mark{transform:scale(.82)}.product-label{display:none}.shell{padding:24px 0}.card,.status-page .card{padding:31px 22px 30px}.card-accent{left:22px;width:58px}h1{font-size:39px}.lede{font-size:14px;line-height:1.65}.support-note{grid-template-columns:1fr;gap:7px}.actions{align-items:stretch;flex-direction:column}.actions .button{width:100%;max-width:100%;padding-inline:14px;text-align:center;font-size:10px;letter-spacing:.08em;white-space:normal}.backdrop{opacity:.72;background-position:72% center}footer{justify-content:center}.footer-rule,footer span:last-child{display:none}.status-icon{transform:none}.status-icon>span{transform:none}}
@media(prefers-reduced-motion:no-preference){.card{animation:arrive .45s ease-out both}@keyframes arrive{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}}
`;

// Escapes text for safe interpolation into HTML.
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
