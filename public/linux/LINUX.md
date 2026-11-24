
# Bannerlord Co-op on Linux

> Generic public FAQ for hosting a **dedicated server** and playing as a **client** on Linux.
> Linux is supported; Steam Deck is not officially supported (official FAQ). This is a Linux setup guide.

> For beginners and AI coding agents. Always use the **latest** Co-op release for both the dedicated server and the client module unless you intentionally pin `COOP_VERSION` to match an older host. Bannerlord game builds must still match that release’s notes (example only: older notes mentioned Bannerlord v1.4.8).
>
> Related: [bannerlordcoop.com](https://bannerlordcoop.com/) · [Changelog](https://bannerlordcoop.com/changelog) · [GitHub releases](https://github.com/Bannerlord-Coop-Team/BannerlordCoop/releases)
>
> **Privacy:** use placeholders only. Never paste real passwords, account names, or personal home paths into public channels.

**Choose a path:** skip to [TL;DR](#tldr) for a **manual** install. An AI assistant prompt is optional under FAQ — helpful for explaining steps, but may miss Bannerlord-specific details.

---

## Install with one script

The interactive guide offers **one copy-paste script per distro** (Ubuntu, Debian, Linux Mint, Fedora, Arch, Manjaro, openSUSE, Bazzite, Steam Deck, NixOS, other). Each script is written to `~/coop-setup.sh` and run with `bash`; it is idempotent and asks before changing anything.

What a script does: detects the distro and asks to continue; installs what is missing (Steam, 7-Zip, curl, python3) with sudo only for that step; resolves the latest Co-op release from the GitHub API (or `COOP_VERSION`), downloads the client zip and the Windows dedicated-server `.7z` from the release's published links (HTTPS allow-list, **SHA-256 required**), unpacks to `~/Games/BannerlordCoop` (`client-module/Coop`, `server/`), writes `start-server.sh` (Proton, `--data-dir`, `--no-watchdog`) and opens UDP 4200-4201 if ufw/firewalld is active. Options: `COOP_VERSION`, `COOP_DIR`, `COOP_YES=1`.

What it does **not** do (a person must): log in to Steam and own/install Bannerlord, enable the Co-op mod (Workshop or copy `client-module/Coop`; same version for everyone), accept the server EULA on first start, edit `server-config.json`, forward the router port.

The system-specific part of each script (package manager and Steam steps; `as_root` runs a command with `sudo` unless you are already root):

### Ubuntu

```bash
say "Installing tools (sudo)"
as_root apt-get update
as_root apt-get install -y curl ca-certificates p7zip-full iproute2 python3
if have steam; then note "Steam is already installed."; else
  say "Installing Steam (multiverse + i386, sudo)"
  as_root dpkg --add-architecture i386
  if ! grep -rqs 'multiverse' /etc/apt/sources.list /etc/apt/sources.list.d/; then
    as_root apt-get install -y software-properties-common
    as_root add-apt-repository -y multiverse
  fi
  as_root apt-get update
  as_root apt-get install -y steam-installer
fi
```

### Debian

```bash
say "Installing tools (sudo)"
as_root apt-get update
as_root apt-get install -y curl ca-certificates p7zip-full iproute2 python3
if have steam; then note "Steam is already installed."; else
  say "Installing Steam (contrib + non-free + i386, sudo)"
  as_root dpkg --add-architecture i386
  if ! grep -rqsE '(^|[ :])contrib( |$)' /etc/apt/sources.list /etc/apt/sources.list.d/; then
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources; do
      [ -f "$f" ] || continue
      as_root sed -i -E 's/^(Components:.* main)( .*)?$/\1 contrib non-free\2/; s/^(deb .* main)( .*)?$/\1 contrib non-free\2/' "$f"
    done
  fi
  as_root apt-get update
  as_root apt-get install -y steam-installer
fi
```

### Linux Mint

```bash
say "Installing tools (sudo)"
as_root apt-get update
as_root apt-get install -y curl ca-certificates p7zip-full iproute2 python3
if have steam; then note "Steam is already installed."; else
  say "Installing Steam (multiverse + i386, sudo)"
  as_root dpkg --add-architecture i386
  if ! grep -rqs 'multiverse' /etc/apt/sources.list /etc/apt/sources.list.d/; then
    as_root apt-get install -y software-properties-common
    as_root add-apt-repository -y multiverse
  fi
  as_root apt-get update
  as_root apt-get install -y steam-installer
fi
```

### Fedora

```bash
say "Installing tools (sudo)"
as_root dnf install -y curl python3 iproute
as_root dnf install -y 7zip || as_root dnf install -y p7zip p7zip-plugins
if have steam; then note "Steam is already installed."; else
  say "Installing Steam from RPM Fusion (sudo)"
  FEDORA_VER="$(rpm -E %fedora)"
  rpm -q rpmfusion-free-release >/dev/null 2>&1 || as_root dnf install -y "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${FEDORA_VER}.noarch.rpm"
  rpm -q rpmfusion-nonfree-release >/dev/null 2>&1 || as_root dnf install -y "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${FEDORA_VER}.noarch.rpm"
  as_root dnf install -y steam
fi
```

### Arch Linux

```bash
say "Installing tools (sudo) - pacman will ask you to confirm"
as_root pacman -Syu --needed curl 7zip python iproute2
if have steam; then note "Steam is already installed."; else
  say "Installing Steam (multilib, sudo)"
  if ! grep -q '^\[multilib\]' /etc/pacman.conf; then
    as_root sed -i '/^#\[multilib\]/{s/^#//;n;s/^#//}' /etc/pacman.conf
    grep -q '^\[multilib\]' /etc/pacman.conf || printf '\n[multilib]\nInclude = /etc/pacman.d/mirrorlist\n' | as_root tee -a /etc/pacman.conf >/dev/null
  fi
  as_root pacman -Syu --needed steam
fi
```

### Manjaro

```bash
say "Installing tools (sudo) - pacman will ask you to confirm"
as_root pacman -Syu --needed curl 7zip python iproute2
if have steam; then note "Steam is already installed."; else
  say "Installing Steam (multilib, sudo)"
  if ! grep -q '^\[multilib\]' /etc/pacman.conf; then
    as_root sed -i '/^#\[multilib\]/{s/^#//;n;s/^#//}' /etc/pacman.conf
    grep -q '^\[multilib\]' /etc/pacman.conf || printf '\n[multilib]\nInclude = /etc/pacman.d/mirrorlist\n' | as_root tee -a /etc/pacman.conf >/dev/null
  fi
  as_root pacman -Syu --needed steam
fi
```

### openSUSE

```bash
say "Installing tools (sudo)"
as_root zypper --non-interactive refresh
as_root zypper --non-interactive install curl python3 iproute2
as_root zypper --non-interactive install 7zip || as_root zypper --non-interactive install p7zip-full
if have steam; then note "Steam is already installed."; else
  say "Installing Steam (non-OSS repository, sudo)"
  for r in repo-non-oss openSUSE:repo-non-oss; do as_root zypper --non-interactive modifyrepo --enable "$r" 2>/dev/null || true; done
  as_root zypper --non-interactive refresh
  if ! as_root zypper --non-interactive install steam; then
    note "No 'steam' package for this openSUSE release - using Flatpak Steam instead."
    have flatpak || as_root zypper --non-interactive install flatpak
    flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
    flatpak install --user -y flathub com.valvesoftware.Steam
  fi
fi
```

### Bazzite

```bash
for t in curl python3 sha256sum; do have "$t" || die "$t is missing; install it in a Distrobox container or ask for help."; done
if have steam; then note "Steam found: $(command -v steam)"
elif have flatpak; then
  say "Steam not found - installing Flatpak Steam for your user"
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y flathub com.valvesoftware.Steam
else note "Steam not found. Bazzite normally ships it; otherwise install it from the Bazzite store."; fi
```

### Steam Deck

```bash
for t in curl python3 sha256sum; do have "$t" || die "$t is missing."; done
if have steam; then note "Steam found: $(command -v steam)"; else note "Steam not found; on a Deck it is preinstalled. Use Desktop Mode."; fi
```

### NixOS

```bash
if [ -z "${COOP_IN_NIX:-}" ]; then
  have nix-shell || die "nix-shell not found."
  say "Re-running inside nix-shell (curl, 7zz, python3, iproute2)"
  COOP_IN_NIX=1 COOP_YES=1 exec nix-shell -p curl _7zz python3 iproute2 coreutils gnugrep findutils --run "bash '$0'"
fi
have steam || note "Steam is not installed. Add  programs.steam.enable = true;  to configuration.nix, then: sudo nixos-rebuild switch"
```

### Other distros

```bash
for t in curl python3 sha256sum tar xz; do have "$t" || die "$t is required. Install it with your package manager and run the script again."; done
if have steam; then note "Steam found: $(command -v steam)"
elif have flatpak; then
  say "Steam not found - installing Flatpak Steam for your user"
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y flathub com.valvesoftware.Steam
else note "Steam not found. Install Steam with your package manager or from Flathub (com.valvesoftware.Steam)."; fi
```

### SteamCMD

```bash
# Optional inspection only; SteamCMD is NOT the Co-op CDN downloader.
command -v steamcmd
# If installed, view its command-line help:
steamcmd +help +quit
# Do NOT run anonymous app_update 261550 expecting the Co-op server.
# Bannerlord is a licensed game; authenticated depot/branch setup is
# outside this guide and unverified. Never put a password in a command.
```

## TL;DR

1. Own Bannerlord on Steam; install it.
2. Download matching **client** zip + **Windows dedicated server** `.7z` from the same Co-op release.
3. Run `BannerlordCoopServer.exe` under Proton/Wine/umu (no official native Linux dedicated server).
4. Edit `server-config.json` (`saveName`, `password`, `port` default **4200**, `steam`).
5. Install matching Co-op **client** module; join via Steam lobby/invite or direct UDP.
6. Optional: systemd (or equivalent) + backups + firewall allow UDP 4200.

---

## Requirements

| Item | Detail |
|------|--------|
| Game | Steam copy of Bannerlord (AppID **261550**), version matching the Co-op release |
| Co-op | Same release for **client** and **dedicated server** (server pins Co-op SHA at boot) |
| OS | Any modern Linux with Wine/Proton capability |
| Disk | Several GB for the Windows dedicated server archive alone (~4–5 GB class) |
| Network | UDP **4200** for direct connect; Steam lobby needs a logged-in Steam client on the host |
| Tools | `curl`, python3, 7-Zip (`7zz`/`7z`), `ss`/`lsof`, optional firewall CLI |

---

### AI agent prompt (optional)

An AI assistant can help explain this guide, but it may miss Bannerlord-specific details or suggest incorrect fixes. Check commands against the guide before running them.

In the HTML guide, open **FAQ → Can I use an AI assistant?** for the copyable prompt. Optional: download this LINUX.md only if your assistant accepts a file attachment.


---

## 1. Variables

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `<STEAMROOT>` | Steam library root | `$HOME/.local/share/Steam` or Flatpak path below |
| `<PROTON>` | Proton `proton` launcher | `$STEAMROOT/compatibilitytools.d/<ProtonGE>/proton` |
| `<SERVER_DIR>` | Extracted dedicated server folder | `$HOME/Games/BannerlordCoop-DedicatedServer` |
| `<COOP_DATA>` | Server data directory | see Paths |
| `<server-name>` | Save/world name without `.sav` | `MyWorld` |
| `<your-password>` | Join password (or empty) | *(your secret)* |
| `COOP_VERSION` | Optional release pin | unset = latest; example `v0.1.7` |
| `<UDP_PORT>` | Listen port | `4200` |

```bash
# Detect STEAMROOT for the Steam format you chose (do not silently override). Confirm if unsure.
for d in "$HOME/.local/share/Steam" "$HOME/.steam/steam" \
  "$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam" \
  "$HOME/snap/steam/common/.local/share/Steam" \
  "$HOME/snap/steam/common/.steam/steam"; do
  [ -d "$d/steamapps" ] && export STEAMROOT="$d" && break
done
: "${STEAMROOT:?Set STEAMROOT to your Steam client root}"
export STEAM_COMPAT_CLIENT_INSTALL_PATH="$STEAMROOT"
# Prefer a fresh dedicated prefix. Use game compatdata/261550 only with explicit permission.
export STEAM_COMPAT_DATA_PATH="${STEAM_COMPAT_DATA_PATH:-$HOME/Games/BannerlordCoop-Prefix}"
export STEAM_COMPAT_APP_ID=261550 SteamAppId=261550 SteamGameId=261550
export SERVER_DIR="$HOME/Games/BannerlordCoop-DedicatedServer"
export UDP_PORT="${UDP_PORT:-4200}"
export UDP_PORT_NEXT=$((UDP_PORT + 1))
# GAMEDIR may be a secondary library — read libraryfolders.vdf / appmanifest_261550.acf or ask; do not guess.
# export GAMEDIR="…/steamapps/common/Mount & Blade II Bannerlord"
# export COOP_DATA="$STEAM_COMPAT_DATA_PATH/pfx/drive_c/users/steamuser/Documents/Mount and Blade II Bannerlord/CoopData/DedicatedServer"
unset PROTON_ENABLE_WAYLAND
```


---

## 2. Paths

| What | Typical path |
|------|----------------|
| Game (`GAMEDIR`) | Confirm via `libraryfolders.vdf` / `appmanifest_261550.acf` or user — may be a secondary library, not always under `$STEAMROOT` |
| Modules | `…/Modules/` |
| Proton/Wine prefix | Prefer dedicated `$STEAM_COMPAT_DATA_PATH/pfx`; game `compatdata/261550` only with permission |
| **Co-op data under Proton** | `…/pfx/drive_c/users/steamuser/Documents/Mount and Blade II Bannerlord/CoopData/DedicatedServer` |
| Config | `<COOP_DATA>/server-config.json` |
| Saves | `<COOP_DATA>/Game Saves/` |
| Logs | `<COOP_DATA>/logs/coop-server-*.log` |
| Gameplay config | `…/CoopData/mod-config.json` (parent of DedicatedServer) |

Upstream comments also mention `$HOME/Mount and Blade II Bannerlord/CoopData/DedicatedServer` for non-Proton layouts. Under Proton, use the prefix Documents path (or pass `--data-dir`). Boot banner prints `data :` / `conf :`.

**Flatpak Steam** often uses:

`$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam`

Grant filesystem access if the server lives outside the sandbox (`flatpak override`).

**Snap Steam** (optional, unverified across distros): after first launch, detect a directory that contains `steamapps`, commonly:

- `$HOME/snap/steam/common/.local/share/Steam`
- `$HOME/snap/steam/common/.steam/steam`
- `$HOME/snap/steam/current/.local/share/Steam`

Confirm with Steam → Properties → Local Files. Do not hardcode without checking.

**Steam Deck / SteamOS:** not officially supported for Co-op. In Desktop Mode the library is usually `$HOME/.local/share/Steam` (same layout as native). Do not unlock the read-only OS or install a second Steam. Tool installs in Distrobox do not change Deck Steam paths.

---

## 3. Install dependencies (by distro)

### Debian / Ubuntu / Mint / Pop!_OS

```bash
sudo apt update
sudo apt install -y curl ca-certificates p7zip-full iproute2 python3
```

### Fedora / RHEL

```bash
sudo dnf install -y curl 7zip python3 iproute
# Fedora 40 and older: p7zip p7zip-plugins instead of 7zip
```

### Arch / Manjaro / EndeavourOS

```bash
sudo pacman -Syu --needed curl 7zip python iproute2
```

### openSUSE

```bash
sudo zypper install -y curl 7zip python3 iproute2
# Older releases without "7zip": p7zip-full
```

### Immutable (Bazzite / SteamOS / Silverblue / Kinoite)

Prefer user-space tools: Flatpak, Homebrew (ublue), or **distrobox**. Avoid casual `rpm-ostree install` unless you know you need it.

```bash
# Example: tools inside a Debian distrobox
distrobox create -n coop-tools -i docker.io/library/debian:trixie
distrobox enter coop-tools -- sudo apt update
distrobox enter coop-tools -- sudo apt install -y curl ca-certificates p7zip-full iproute2 python3
```

### NixOS

```bash
nix-shell -p curl _7zz python3 iproute2
# or add packages to configuration.nix / a flake
```

### Steam Deck

Desktop Mode. Use Discover / ProtonUp-Qt for Proton-GE. Prefer `$HOME` installs. Same Proton launch pattern as other SteamOS/Bazzite-class systems.

---

## 4. Steam install variants

### Per distro (tested in containers)

- **Ubuntu / Linux Mint:** `sudo dpkg --add-architecture i386`, enable `multiverse`, `sudo apt update`, `sudo apt install steam-installer`.
- **Debian:** `sudo dpkg --add-architecture i386`, add `contrib non-free` after `main` in the apt sources, `sudo apt update`, `sudo apt install steam-installer`.
- **Fedora:** enable RPM Fusion free + nonfree (`rpmfusion-*-release-$(rpm -E %fedora).noarch.rpm` from mirrors.rpmfusion.org), then `sudo dnf install steam`.
- **Arch:** uncomment `[multilib]` (two lines) in `/etc/pacman.conf`, then `sudo pacman -Syu steam`. **Manjaro:** multilib is on by default: `sudo pacman -Syu steam`.
- **openSUSE Tumbleweed:** `sudo zypper modifyrepo --enable repo-non-oss`, `sudo zypper install steam`. Leap 16.0 has no `steam` package: use Flatpak.
- **NixOS:** `programs.steam.enable = true;` in `configuration.nix`, then `sudo nixos-rebuild switch`.
- **Bazzite / Steam Deck:** Steam is preinstalled. Do not install a second copy.

### Flatpak (`com.valvesoftware.Steam`, any distro)

```bash
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y flathub com.valvesoftware.Steam
```

Library: `$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam` ([Flathub: Steam](https://flathub.org/apps/com.valvesoftware.Steam)). If the dedicated server directory is outside the sandbox, prefer a **scoped** filesystem override:

```bash
# Prefer the server directory only (example path - use yours):
flatpak override --user --filesystem="$HOME/Games/BannerlordCoop" com.valvesoftware.Steam
# Avoid --filesystem=home unless a narrower path fails.
```

---

## 5. Obtain Co-op client + dedicated server

Official sources (same release tag for client **and** server):

1. [GitHub releases](https://github.com/Bannerlord-Coop-Team/BannerlordCoop/releases) / Releases API (resolver uses `/releases/latest`, or `/releases/tags/<tag>` when `COOP_VERSION` is set)
2. [Changelog](https://bannerlordcoop.com/changelog) (human-readable links)
3. Release `manifest.json` when published (names, CDN URLs, sha256)

**Do not hardcode a version.** Run the staging resolver in [Install by command line](#install-by-command-line). It selects client and dedicated-server assets by name pattern, prefers published checksums, and prints the resolved version before download. If a checksum is missing, it prints the computed sha256 and says so.

Optional pin when matching an older host (example only): `export COOP_VERSION=v0.1.7`.

After staging, install `client-module/Coop` into each player’s game `Modules/` folder **or** use Workshop. Set `COOP_CLIENT_MODULE` to an installed `Modules/Coop` path to compare `SubModule.xml` against the resolved server tag; the script warns on mismatch.

Self-contained — **no separate .NET runtime**. Read `release-info.txt` for game version + pinned Co-op SHAs. Exit code **4** = Co-op module verification failed.

**Official Linux installer** (client and/or Windows DS):

```bash
curl -fsSL --proto '=https' --tlsv1.2 \
  -o /tmp/coop-install-linux.sh \
  https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/main/installer/install-linux.sh
head -n2 /tmp/coop-install-linux.sh   # expect official marker on line 2
bash /tmp/coop-install-linux.sh
```

**Nightly gateway:** `https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/` returned **HTTP 404** when checked — treat as unavailable / bleeding-edge if it returns. Prefer pinned release builds for long-lived worlds.

**Client install:** unzip into `Modules/`, or Steam Workshop (disable auto-update if you must stay pinned). Workshop can advance past your server version → join refused.

Optional unofficial admin tools are **not** required and not part of official Coop.

---

## 6. Configure the dedicated server

> **Edit after first launch:** the server may regenerate `server-config.json` (JSONC/comments allowed). Stop only this server, set `port` (default **4200**), `steam`, `password` (`<your-password>`), and `saveName` (`<server-name>`), then start again.


Start once (or create the data dir) so `server-config.json` appears in `<COOP_DATA>`.

```jsonc
{
  "saveName": "<server-name>",
  "autosaveMinutes": 5,
  "password": "<your-password>",
  "port": 4200,
  "logFile": true,
  "steam": true
}
```

| Key | Meaning |
|-----|---------|
| `saveName` | Save under `Game Saves/` (no `.sav`). Missing → bootstrap from `default_new_game.sav` |
| `autosaveMinutes` | `0` disables |
| `password` | Empty = open |
| `port` | UDP listen (default **4200**) |
| `steam` | `true` = Steam lobby when Steam client is logged in |
| `logFile` | Write rotating logs under `logs/` |

Gameplay options: `mod-config.json` one level up. Restart after edits. Optional `--data-dir '/absolute/path'`.

---

## 7. Run the server (Proton / GE / Wine / umu)

There is **no official native Linux dedicated server**.

### Proton / Proton-GE (common on Steam Deck / gaming distros)

```bash
# Pick a Proton that runs Bannerlord; GE-Proton is a frequent choice
export PROTON="$STEAMROOT/compatibilitytools.d/<ProtonGE-version>/proton"
pgrep -x steam >/dev/null || echo "Start Steam first if steam:true"
cd "$SERVER_DIR"
"$PROTON" run "$SERVER_DIR/BannerlordCoopServer.exe"
```

### Wine (non-Steam prefix)

Possible for `steam:false` direct-connect / headless hosts when Proton is unavailable.

**Validation (this guide’s disposable tests):**
- **WineHQ Wine 11.0** (`winehq-stable` 11.0.0 / image `docker.io/tianon/wine:11.0.0`) **+ Xvfb** → dedicated server reached real `SERVING` with a UDP join port.
- **Debian stock Wine 8.0** (`apt` `wine`) → **FAIL** (`virtual_setup_exception` stack overflow; no SERVING).
- Wine **9** and **10** were **not** tested here. Treat **11.0** as the **validated** version, **not** a proven minimum for every future Wine release.

Do **not** recommend stock distro `apt`/`dnf` Wine 8.x as a working end-to-end recipe. Prefer WineHQ `winehq-stable` matching the validated 11.0 line, or the `tianon/wine:11.0.0` image. GPU is not required for SERVING; a display server (Xvfb is enough; disable MIT-SHM if the server hangs on startup) is. Prefer Proton with Bannerlord’s compatdata when you already run Steam on the host.

### umu-launcher

Community launcher around Proton. If installed:

```bash
# Example shape only — verify umu flags for your version
umu-run "$SERVER_DIR/BannerlordCoopServer.exe"
```

**Unverified** against every umu release.

### Headless VPS / no Steam UI

- Official behaviour: without a Steam client (or with `"steam": false`) the server runs **direct-connect only** on UDP `<UDP_PORT>`.
- Steam public lobby / players Join over Steam relay needs Steam logged in on the host.
- Running Win64 under Proton/Wine on a headless box works in principle; GPU/display requirements depend on the build — **confirm on your VPS**. Forward/open UDP 4200.

**Ready check:**

```bash
ss -lun | grep 4200
# Log should contain: SERVING - coop server up, waiting for clients
```

With Steam lobby: look for a Steam lobby created line. Local Steam game-server ports **27315/27316** do not need WAN exposure for Steam joins.

---

## 8. Firewall

### ufw

```bash
sudo ufw allow 4200:4201/udp comment 'Bannerlord Co-op'
sudo ufw status
```

### firewalld

```bash
sudo firewall-cmd --permanent --add-port=4200-4201/udp
sudo firewall-cmd --reload
```

### iptables / nftables

Allow UDP 4200 on the WAN-facing interface. Exact rules depend on your chain layout.

Cloud security groups / CGNAT: if you lack a public IPv4, prefer **Steam Join** over raw IP.

---

## 9. Keep it running

### systemd --user

Use a new dedicated prefix, data folder and unit name. Never reuse an existing service or point a test at live saves. Verify manual startup first.

```bash
# Bash: export these four absolute paths from your verified manual launch first:
# SERVER_DIR, PROTON, COOP_PREFIX (dedicated prefix), COOP_DATA_DIR.
# COOP_SERVICE_UNIT and COOP_SERVICE_CONFIG can select isolated test names.
(
  set -euo pipefail
  : "${SERVER_DIR:?Set the verified server folder}"
  : "${PROTON:?Set the verified proton executable}"
  : "${COOP_PREFIX:?Set a dedicated Proton prefix}"
  : "${COOP_DATA_DIR:?Set the intended server data folder}"
  UNIT_NAME="${COOP_SERVICE_UNIT:-coop-server.service}"
  CONFIG_DIR="${COOP_SERVICE_CONFIG:-$HOME/.config/coop-server}"
  case "$UNIT_NAME" in
    coop-server-*.service) ;;
    *) printf '%s\n' 'Use a new coop-server-*.service unit name.'; exit 1 ;;
  esac
  case "$UNIT_NAME" in *[!a-zA-Z0-9_.-]*) exit 1 ;; esac
  for path in "$SERVER_DIR" "$PROTON" "$COOP_PREFIX" "$COOP_DATA_DIR" "$CONFIG_DIR"; do
    case "$path" in /*) ;; *) printf '%s\n' 'All paths must be absolute.'; exit 1 ;; esac
  done
  WINE_SERVER="${COOP_WINESERVER:-${PROTON%/*}/files/bin/wineserver}"
  test -x "$WINE_SERVER"
  command -v script >/dev/null
  test -x "$PROTON"
  test -f "$SERVER_DIR/BannerlordCoopServer.exe"
  if [ ! -f "$COOP_DATA_DIR/eula.txt" ] || ! awk '
    tolower($0) ~ /^[[:space:]]*eula[[:space:]]*=[[:space:]]*true([[:space:]]|$)/ {ok=1}
    END {exit !ok}
  ' "$COOP_DATA_DIR/eula.txt"; then
    printf '%s\n' 'EULA consent required: review bundled EULA.md and LICENSE.txt.'
    printf '%s\n' 'Run the server interactively and decide yourself before installing a service.'
    printf '%s\n' 'Do not automate acceptance or copy a different server acceptance file.'
    exit 1
  fi
  UNIT="$HOME/.config/systemd/user/$UNIT_NAME"
  test ! -e "$UNIT" || { printf '%s\n' 'Unit already exists: refusing overwrite.'; exit 1; }
  test ! -e "$CONFIG_DIR" || { printf '%s\n' 'Config folder exists: refusing overwrite.'; exit 1; }
  mkdir -p "$HOME/.config/systemd/user" "$CONFIG_DIR" "$COOP_PREFIX" "$COOP_DATA_DIR"
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    printf 'export STEAM_COMPAT_CLIENT_INSTALL_PATH=%q\n' "${STEAMROOT:-$HOME/.local/share/Steam}"
    printf 'export STEAM_COMPAT_DATA_PATH=%q\n' "$COOP_PREFIX"
    printf 'export STEAM_COMPAT_APP_ID=261550 SteamAppId=261550 SteamGameId=261550\n'
    printf 'unset PROTON_ENABLE_WAYLAND\n'
    printf 'cd %q\n' "$SERVER_DIR"
    printf 'export SHELL=/usr/bin/bash\n'
    printf -v LAUNCH '%q run %q --data-dir %q --no-watchdog' "$PROTON" "$SERVER_DIR/BannerlordCoopServer.exe" "Z:$COOP_DATA_DIR"
    printf 'exec script --quiet --return --flush --command %q /dev/null\n' "$LAUNCH"
  } > "$CONFIG_DIR/run.sh"
  chmod 700 "$CONFIG_DIR/run.sh"
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    printf 'export WINEPREFIX=%q\n' "$COOP_PREFIX/pfx"
    printf 'exec %q -k\n' "$WINE_SERVER"
  } > "$CONFIG_DIR/stop.sh"
  chmod 700 "$CONFIG_DIR/stop.sh"
  cat > "$UNIT" <<UNIT
[Unit]
Description=Isolated Bannerlord Coop guide server
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/bash "$CONFIG_DIR/run.sh"
ExecStop=/usr/bin/bash "$CONFIG_DIR/stop.sh"
KillMode=control-group
TimeoutStopSec=30
TimeoutStopFailureMode=kill
Restart=no

[Install]
WantedBy=default.target
UNIT
  systemd-analyze --user verify "$UNIT"
  systemctl --user daemon-reload
  printf 'Installed %s. Review its data configuration before starting it.\n' "$UNIT_NAME"
)
# Run separately after reviewing configuration (substitute your unit name):
# systemctl --user start coop-server.service
# systemctl --user status coop-server.service --no-pager
# journalctl --user -u coop-server.service --no-pager -n 40
# systemctl --user stop coop-server.service
# systemctl --user restart coop-server.service
# Before stopping a real server, save safely using its console.
# Prefix-scoped Wine cleanup is not a substitute for saving.
# Never share this dedicated prefix with another server.
# Stop only this new unit before deleting its own unit/config files.

```

### Non-systemd (OpenRC / runit / s6)

Use an equivalent long-running service script that launches the same Proton/Wine command, redirects logs, and restarts on failure. **No single official OpenRC unit** — adapt locally.

---

## 10. Client on Linux

1. Install matching Co-op module (zip or Workshop pin).
2. Enable required modules per `SubModule.xml` (Native / sandbox modules + Co-op).
3. Launch Bannerlord via Steam/Proton.
4. Join: Co-op browser / Steam players / invite, or direct IP:port if routed.

Version mismatch → join refused (server also exits **4** if its own Modules/Coop was modified).

---

## 11. Backups

Before upgrades or risky console commands:

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$HOME/coop-backups/$TS"
cp -a "$COOP_DATA" "$HOME/coop-backups/$TS/"
```

Server also keeps `<saveName>.backup1` / `.backup2`. Do not delete or overwrite saves to “fix” issues unless the owner explicitly asks.

---

## 12. Updating versions

1. Save cleanly and stop only the intended server.
2. Back up CoopData and any separate server-data folder before changing files.
3. Download matching client and server into a separate installation folder.
4. Read `release-info.txt`; match the exact Bannerlord build for every player.
5. Retain configs/saves, start the new server and verify actual SERVING; client joining is a separate check.

Do not mix different Co-op client and server releases (example: an older client with a newer server).

---

## 13. Useful console commands

| Goal | Example |
|------|---------|
| Unstuck | `coop.unstuck` (variants differ by build) |
| Save before maintenance | `save` (official FAQ; confirm console behavior on your build) |

Backup first. Command set grows by release.

---

## 14. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `SteamAPI_Init failed` | Steam not ready | Restart Steam; wait until logged in; relaunch |
| Exit code 4 | Older unverified diagnostic | Read the preceding log; verify archive checksum and exact versions |
| Join refused / module list | Client/server version skew; Workshop auto-update | Pin matching zip; disable Workshop auto-update |
| Can’t join via IP | NAT/CGNAT/firewall | Check configured UDP port and forwarding; Steam-to-Steam lobby is a separate, unverified-on-Proton alternative |
| UDP 4200 not listening | Crash, slow start, port busy | Read latest `coop-server-*.log`; `ss -lun` |
| `Non-Zero Device Reference Count` | May be Proton/Vulkan cleanup | If startup fails, inspect preceding errors rather than ignoring the log |
| Flatpak can’t see server files | Sandbox paths | `flatpak override` filesystem permissions |

---

## 15. FAQ

**Native Linux dedicated server?** This recipe uses distributed Win64 binaries. Native .NET work is tracked in issue #2843; do not assume source visibility grants build/distribution rights.

**Need .NET?** No for the official self-contained dedicated server build.

**Steam required?** For Steam lobby/players relay: yes. For direct UDP only: no (`steam: false`).

**Which Proton?** Use the release-recommended or a locally verified installed version; pin what works.

---

## 16. Agent notes

1. Ask before any `sudo`, before stopping a running server, and before deleting or overwriting saves.
2. Match Co-op client and dedicated server versions exactly.
3. Prefer Steam Join when lobby is enabled; otherwise direct UDP.
4. Redact passwords and personal paths from logs and chat.
5. On immutable OS prefer `$HOME` / distrobox / Flatpak.

## 17. Unverified / mark carefully

| Claim | Status |
|-------|--------|
| Official native Linux server package | Not validated here; this recipe uses the distributed Win64 package |
| GitHub Assets always includes DS `.7z` | **Often no** — client zip + manifest are common; DS usually via release body/manifest CDN. Resolver follows published links. |
| Snap Steam exact paths | Distro-specific — verify locally |
| umu-launcher flags | Verify per umu version |
| Headless VPS without any GPU | May work; **confirm on your host** |
| OpenRC official unit | None — roll your own |
| Every console command name | Confirm with your build’s help |

---

## Links

- https://github.com/Bannerlord-Coop-Team/BannerlordCoop/releases
- https://bannerlordcoop.com/changelog
- https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/main/installer/install-linux.sh

## FAQ — common setup questions

### Which versions must match?

The server and every player need identical Co-op releases and the exact Bannerlord build, not just the same major version. Check release notes and the server’s refusal logs.

### Why can’t other players connect?

For direct connect, allow the configured UDP port in the host firewall and forward that same UDP port on the router. CGNAT can prevent incoming connections even with forwarding; ask the ISP about a public address or use an appropriate private network. Steam Join is a separate path requiring Steam lobby mode and a logged-in Steam client; do not assume it fixes every NAT problem.

### What differs on Steam Deck, Bazzite and Flatpak Steam?

Use Desktop Mode on Deck. Bazzite may already include native Steam: inspect first, do not install a second copy. Flatpak Steam uses its own library and sandbox permissions. Immutable hosts should prefer existing tools, Flatpak or a tool container rather than changing the base OS unnecessarily.

### Which Proton version should I choose?

Start with the version recommended by the Co-op release or a known-working installed Proton/GE version. Locate its actual proton executable; names and paths vary. Stock distro Wine 8 failed headless SERVING here; WineHQ Wine 11.0 + Xvfb was validated. Wine 9/10 untested. umu remains unverified here. Do not change a working game installation just to test the server.

### Why does the server close or crash?

Read terminal output and dedicated-server logs first. Check exact game/Co-op builds, extraction and runtime paths. Exit code 25 points to starter_log.txt under ProgramData/Mount and Blade II Bannerlord/logs. Never delete saves as a shortcut.

### Can Workshop auto-updates break joining?

Yes. Workshop can update the client before the server, or lag because releases need TaleWorlds approval. Compare exact builds and restore a compatible pair. Restart Steam only when safe for active sessions; this guide does not change subscriptions.

### Does the server need a GPU or display?

A dedicated server does not need a running Bannerlord game instance. GPU/display-free Proton operation on every VPS is still unverified. Steam lobby mode needs a logged-in Steam client; direct-IP mode is separate.

### How do I update safely?

Save cleanly and stop only the intended server. Back up its entire CoopData directory and any separate server-data folder before changing files. Extract the update separately, retain configuration and saves, match client/game builds, then verify startup.

### How do I keep it running?

After a successful manual boot, use a user systemd service with the same working directory, environment and launch command. Inspect journalctl --user -u YOUR_UNIT. OpenRC and runit templates are distribution-specific and unverified. Never reuse an existing live unit for a test.

### Where are logs and saves?

Under Proton, inspect the selected prefix’s drive_c/users/steamuser/Documents/Mount and Blade II Bannerlord/CoopData/DedicatedServer. Logs are under logs/ and saves under Game Saves/. Confirm the paths printed at boot; --data-dir can change them. Back up before editing.

### Where is the dedicated-server download?

Use the release changelog and manifest. The Win64 .7z is distributed on the Co-op CDN and may be absent from GitHub Assets. SteamCMD is not a substitute for this archive.

### Does disabling the watchdog help Linux stutter?

Official Discord reports say it can help. Rename the client watchdog directory rather than deleting it, and keep a backup. Developer caveat: crash logs are then unavailable for support. --no-watchdog is server-only. Do not change a running game.

### Can I use the Workshop dedicated server?

Yes: the Workshop item includes DedicatedServer. Steam keeps Workshop on the latest approved release automatically, but TaleWorlds approval can lag GitHub/CDN. The host and every player must still match. Manual Modules/Coop and Workshop Co-op must not be enabled together.

### Which ports should direct-IP players allow?

Official Discord recommends UDP 4200–4201 through host, router and cloud firewall with steam:false. Steam player-hosted invites can bypass forwarding, but dedicated-server Steam listing under Proton/Wine remains unverified here.

### Why is the service running but there is no UDP listener?

A fresh official server may be waiting for its EULA decision before normal startup logging. Review the bundled EULA.md and LICENSE.txt and make the decision interactively. Do not automate consent, reuse a live server’s acceptance file or bypass the check. Only then install the service and verify an actual SERVING entry.

### Is Linux or Steam Deck supported?

The official FAQ states that Linux is supported but Steam Deck is not. Deck reports vary; see issue #2162. This is a Linux setup guide.

### What if I host and play on the same PC?

The official FAQ suggests an 8-core CPU and 16 GB RAM. Linux host-and-play can stall during character transfer (issue #2095). A separate dedicated server may help; this guide does not promise a fix.

### Where are difficulty and battle settings?

Check CoopData/mod-config.json; server connection settings are in CoopData/DedicatedServer/server-config.json. Stop the intended server before editing. Lower battleSize for battle performance; back up before regenerating a config with missing options.

### Can Epic or manually installed clients use Steam invites?

Steam lobbies are Steam-to-Steam. Epic and non-Steam distributions need Direct IP with the configured UDP port, or an appropriate private network. Everyone still needs identical game and Co-op builds.

### Do client and server versions match?

They must. The staging resolver downloads matching client and dedicated-server assets from one release. Compare Modules/Coop/SubModule.xml with the server release tag (RESOLVED_VERSION.txt). The script warns when they differ.

## Official Discord Linux compatibility notes

Source: supplied official Discord notes, reviewed 6 November 2026. Reports are not local test proof.

### Install from Workshop or manually — not both

Official Co-op Discord setup notes (6 November 2026): Workshop item 3770450698 contains DedicatedServer/BannerlordCoopServer.exe under steamapps/workshop/content/261550/3770450698/. For a manual install, extract the matching latest client so Modules/Coop/SubModule.xml exists. Enable only Co-op for the baseline test, disable other mods and War Sails, and choose No to Safe Mode. Do not combine a manual Modules/Coop copy with the Workshop module; back up and remove the redundant manual copy when switching. Workshop updates require TaleWorlds approval and may lag the release; check versions rather than assuming parity.

### Linux client and Steam

Launch the Linux client through Steam. For SteamAPI_Init failed, restart Steam when safe; first confirm no running server depends on it. Do not change an active game or server session during a test.

### Optional watchdog stutter workaround

Official Discord reports describe renaming the client bin/Win64_Shipping_Client/watchdog directory to a backup name to reduce world-map stutter on Bazzite, CachyOS and Arch. Developer caveat: disabling it removes crash logs needed for support. Only do this with explicit permission, while the game is closed, and retain the backup so it can be restored. --no-watchdog is a SERVER argument only, not a client launch option. Issue: https://github.com/Bannerlord-Coop-Team/BannerlordCoop/issues/2536.

### GE-Proton non-Steam server method

Add BannerlordCoopServer.exe as a non-Steam game, select GE-Proton and put --no-watchdog in the server launch options. Alternatively use the game’s Proton prefix. For safety testing, use a separate prefix and --data-dir, not an existing live server prefix or save directory. A Steam-listed lobby under Proton/Wine is still unverified; direct IP is the reproducible fallback.

### Ports, CGNAT and direct IP

Official Discord direct-IP instructions use steam:false in server-config.json and UDP 4200–4201 through the host firewall, router and cloud firewall. The configured main port defaults to 4200. Steam player-hosting Join Game/invites can avoid port forwarding and CGNAT; do not assume dedicated-server Steam hosting under Proton/Wine has the same verified behavior. Turn off conflicting VPN/DNS-routing tools only after considering other active sessions.

### Server mod configuration

Gameplay and difficulty settings live in CoopData/mod-config.json; server settings in CoopData/DedicatedServer/server-config.json. Workshop layouts can also use DedicatedServer/server-data/mod-config.json. Confirm active paths at boot and stop only the intended server before editing. Keys include battleSize (default 1000; about 400 suggested), autoPauseEnabled, goldFoodInfluenceChangeInSettlements, enablePlayerExecutions and enableHeroExecutions. Difficulty birth/death options include birthAndDeath, clanMemberDeathChance and battleDeath; keep the separate Birth and Aging module disabled.

### Load server mods consistently

First verify Coop-only operation. Copy a compatible mod folder into engine/Modules; its folder name must match the mod Id. In the server UI reload, enable, set load order and Save Mods, then restart only that intended server. Every client needs matching mods, versions and order. Official Discord reports War Sails, Birth and Aging Options and Fast Mode are unsupported on dedicated servers. Do not alter Steam subscriptions automatically.

### Logs and recovery

Dedicated logs: CoopData/DedicatedServer/logs/coop-server-{date}-{time}.log. Client: bin/Win64_Shipping_Client/Coop_client.log; in-game host: Coop_server.log. Case matters on Linux. Crashes can be under the prefix’s drive_c/ProgramData/Mount and Blade II Bannerlord/crashes or Documents/Mount and Blade II Bannerlord/Coop Crash Reports. Keep the crash report (the Send action can remove it), redact secrets and use the official support-ticket channel. Do not repeatedly rejoin a stalled session.

### VPS / Docker / Wine — validated Wine 11.0 headless path

Headless dedicated-server **SERVING** was validated here with **WineHQ Wine 11.0** (`docker.io/tianon/wine:11.0.0` / `winehq-stable` 11.0.0 on Debian trixie) plus **Xvfb**. **Debian stock Wine 8.0 failed** the same recipe (stack overflow before SERVING). Wine 9/10 were not tested — **11.0 is validated, not a proven minimum across every Wine release**. Do not use distro packages that install Wine 8 as an end-to-end recommendation.

Preserve the Workshop/GitHub layout: `DedicatedServer` alongside `bin/`, `GUI/`, `SubModule.xml`. Prefer **host networking** for UDP; keep `stdin_open`/`tty` for the console. Official Discord also notes Ubuntu + Wine + winbind + Xvfb for community VPS hosting. Allow UDP 4200–4201 (or your configured join port) in host/cloud firewalls. Compose lifecycle was exercised with **rootless Podman**; distinguish that from Docker Engine if your host differs.

### Community tools — unofficial

The bannerlordcoop-server-manager project and the Unofficial Bannerlord Co-op Pterodactyl egg are community tools, not official support. Review their source and compatibility before use. This guide does not install them.

### Linux support and hardware

The official FAQ says Linux is supported but Steam Deck is not; Deck reports vary (https://github.com/Bannerlord-Coop-Team/BannerlordCoop/issues/2162). Hosting and playing together is estimated at 8 CPU cores and 16 GB RAM, with a dedicated server. A running game instance is not required for dedicated hosting. Linux host-and-play transfer stalls are tracked in issue #2095.

### Exact game builds and safe updates

Compare full Bannerlord build identifiers as well as Co-op releases. Even minor build differences can stall joining. Check the server log for the refused build or mod. Save cleanly, stop only the intended server, then back up CoopData and any distribution server-data before replacing files. Never automate Workshop unsubscribe/resubscribe or restart Steam during someone’s active session.

### Server exit diagnostics

Windows exit -1073741819 indicates access violation; check blocked/missing DLLs and retained save backups. -532462766 indicates an unhandled .NET exception. Exit 1 is generic. Exit 25 points to ProgramData/Mount and Blade II Bannerlord/logs/starter_log.txt inside the prefix. Diagnose from the preceding log messages, not the number alone. These official FAQ diagnostics were not deliberately reproduced here.

### Native server and unsupported tooling

This guide uses distributed Win64 binaries. Native .NET server work is tracked at https://github.com/Bannerlord-Coop-Team/BannerlordCoop/issues/2843; repository visibility is not permission to self-build or redistribute. The TAOM client launcher is Windows-only and is reported not to work under Proton/Wine. Other mods are not guaranteed; establish a Co-op-only baseline first.

```dockerfile
# Validated outline (guide tests): WineHQ Wine 11.0 + Xvfb.
# Stock Debian Wine 8.0 failed SERVING (stack overflow) — do not use apt "wine" 8.x as E2E.
# Wine 9/10 not tested here; 11.0 is the validated version, not a proven floor for every release.
# Build/run from a complete DedicatedServer Workshop/GitHub layout (not a lone exe).
# Option A — pin the tested image (amd64):
FROM docker.io/tianon/wine:11.0.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth ca-certificates winbind && rm -rf /var/lib/apt/lists/*
# Option B — Debian trixie + WineHQ winehq-stable (= 11.0.0 when validated):
# follow https://wiki.winehq.org/Debian then install winehq-stable xvfb winbind
ENV WINEPREFIX=/data/pfx WINEARCH=win64 WINEDLLOVERRIDES=mscoree,mshtml=
WORKDIR /server
# Prefer: wineboot -u once on a fresh prefix, then:
CMD ["xvfb-run", "-a", "-s", "-screen 0 1024x768x24 -extension MIT-SHM", \
     "wine", "BannerlordCoopServer.exe", "--data-dir", "/data", "--no-watchdog"]
```

```yaml
# compose.yaml — rootless podman-compose / Docker Compose compatible outline.
# Validated engine in guide tests: rootless Podman + Wine 11.0 image (not Docker Engine).
# No privileged mode, no docker.sock mounts, no added capabilities.
services:
  coop:
    image: docker.io/tianon/wine:11.0.0
    # Or: build: .  using the Dockerfile above (adds xvfb/winbind).
    network_mode: host
    stdin_open: true
    tty: true
    environment:
      WINEPREFIX: /data/pfx
      WINEARCH: win64
      WINEDLLOVERRIDES: mscoree,mshtml=
      DISPLAY: ":99"
    volumes:
      - ./DedicatedServer:/server:ro
      - ./isolated-data:/data
    working_dir: /server
    command:
      - wine
      - BannerlordCoopServer.exe
      - --data-dir
      - /data
      - --no-watchdog
    # Provide Xvfb on the host (Xvfb :99 -extension MIT-SHM) or a sibling service
    # sharing the host network namespace. Do not publish only TCP; allow UDP join port.
    # Console: podman compose attach coop   (or docker compose attach coop)
    # Stop/restart only this project; never a live host service on UDP 4200.
```

## Choosing a guide path

Recommended: **Use an AI helper** (copy the self-contained prompt from the HTML guide — it includes this document). Next: **Install by command line**, then **Step-by-step**, then **Full checklist**, then **FAQ**. The interactive HTML guide has 15 stages; allow 45–90 minutes plus game downloads.

**Scope:** Prefer the official Discord/FAQ when they conflict with this Linux guide. Tested paths and documented-only paths are labeled in the HTML coverage notes.

### Steam Deck / SteamOS

Not officially supported. Use Desktop Mode and existing Steam. Do not unlock SteamOS or install a second Steam copy.

```bash
# Not officially supported; unverified here.
# Use Desktop Mode and existing Steam; do not unlock SteamOS.
command -v steam flatpak
command -v curl 7z 7zz ss
# Use a tool container for missing tools, then verify host paths.
```

### Alternative: copy installed Workshop distribution

Use this only if the item is already installed. Do not update subscriptions for a test. Never copy existing runtime data or saves. Keep the distribution layout together.

```bash
# Bash on the host. Copy installed Workshop distribution files only.
# Does not subscribe, update Steam or read/copy existing server saves.
(
  set -euo pipefail
  SOURCE="${STEAMROOT:-$HOME/.local/share/Steam}/steamapps/workshop/content/261550/3770450698"
  DEST="${COOP_WORKSHOP_STAGE:-$HOME/Games/coop-workshop-copy}"
  test -f "$SOURCE/DedicatedServer/BannerlordCoopServer.exe"
  test ! -e "$DEST" || { printf '%s\n' 'Destination exists: refusing overwrite.'; exit 1; }
  mkdir -p "$DEST/DedicatedServer"
  for NAME in bin GUI ModuleData ThirdPartyNotices SubModule.xml mod-config.default.json; do
    if [ -e "$SOURCE/$NAME" ]; then
      cp -a --reflink=auto "$SOURCE/$NAME" "$DEST/"
    fi
  done
  for ITEM in "$SOURCE/DedicatedServer/"*; do
    NAME="${ITEM##*/}"
    case "$NAME" in
      server-data|CoopData|logs|manual-backups|'Game Saves'|server-config.json) continue ;;
      *.sav|*.log|*.backup*) continue ;;
    esac
    cp -a --reflink=auto "$ITEM" "$DEST/DedicatedServer/"
  done
  cmp "$SOURCE/DedicatedServer/BannerlordCoopServer.exe" "$DEST/DedicatedServer/BannerlordCoopServer.exe"
  test -d "$DEST/DedicatedServer/engine"
  printf '%s\n' 'Distribution copy verified. Use a NEW prefix and data directory.'
  # Keep the entire copied layout; everyone must use this same release.
)

```

## First launch: EULA decision before service installation

The official server displays bundled EULA.md and LICENSE.txt and asks `Accept the EULA? [y/N]`. A person must review and explicitly agree before hosting. An agent must not accept automatically, copy a live server’s acceptance file or bypass the check. A service may look active while waiting here, without a UDP listener or normal logs. Make the decision interactively first. The service recipe deliberately refuses to proceed until an acceptance file exists; the server still validates the release identifier itself.

