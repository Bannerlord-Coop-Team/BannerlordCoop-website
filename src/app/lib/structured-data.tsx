export const SITE_URL = "https://bannerlordcoop.com";

/** Profiles that identify the project to search engines, in `Organization.sameAs`. */
export const PROJECT_PROFILES = [
    "https://discord.gg/bannerlordcoop",
    "https://github.com/Bannerlord-Coop-Team/BannerlordCoop",
    "https://www.patreon.com/c/bannerlordcoop",
    "https://steamcommunity.com/sharedfiles/filedetails/?id=3770450698",
    "https://www.nexusmods.com/mountandblade2bannerlord/mods/2387",
    "https://www.moddb.com/mods/bannerlord-coop",
] as const;

/** Organization node shared by every page's structured data. */
export const organizationNode = {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Bannerlord Co-op",
    url: SITE_URL,
    logo: `${SITE_URL}/images/banner.png`,
    sameAs: [...PROJECT_PROFILES],
} as const;

/**
 * Serializes schema.org JSON-LD for a `<script>` element. Escaping `<` keeps translated or
 * catalog text from closing the element early.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", ...data }).replace(/</g, "\\u003c") }}
        />
    );
}
