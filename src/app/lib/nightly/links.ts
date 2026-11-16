/** Canonical nightly gateway host (contract §1/§6); installers and R2 downloads live there, not on the website. */
export const NIGHTLY_GATEWAY_ORIGIN = "https://nightly.bannerlordcoop.com";
export const WINDOWS_INSTALLER_URL = `${NIGHTLY_GATEWAY_ORIGIN}/install.cmd`;
export const LINUX_INSTALLER_URL = `${NIGHTLY_GATEWAY_ORIGIN}/install.sh`;
/** Saved filenames for the installer downloads; they match the gateway's Content-Disposition headers. */
export const WINDOWS_INSTALLER_FILENAME = "BannerlordCoop-Nightly-Installer.cmd";
export const LINUX_INSTALLER_FILENAME = "BannerlordCoop-Nightly-Installer.sh";
export const DISCORD_INVITE_URL = "https://discord.gg/bannerlordcoop";
