#!/usr/bin/env bash
set -eu

INSTALLER_PRIMARY='https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/install-linux.sh'
INSTALLER_MIRROR='https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/main/installer/install-linux.sh'

pause_on_failure() {
    printf '\n'
    if [ -t 0 ]; then
        printf 'Press Enter to close this window.'
        read -r _ || true
        printf '\n'
    fi
}

# Double-click / "Run" has no terminal. Reopen in one so prompts and errors stay visible.
if [ ! -t 1 ] && [ ! -t 0 ] && [ -z "${COOP_IN_TERM:-}" ] \
   && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    for term in konsole gnome-terminal xfce4-terminal xterm; do
        command -v "$term" >/dev/null 2>&1 || continue
        case "$term" in
            konsole)        exec env COOP_IN_TERM=1 "$term" -e "$0" "$@" ;;
            gnome-terminal) exec env COOP_IN_TERM=1 "$term" -- "$0" "$@" ;;
            *)              exec env COOP_IN_TERM=1 "$term" -e "$0" "$@" ;;
        esac
    done
fi

printf 'BannerlordCoop Nightly Installer\n'
printf 'Installs or updates the Coop client, Windows dedicated server, or both.\n'
printf '\n'

for required in curl bash; do
    command -v "$required" >/dev/null 2>&1 || {
        printf 'Required command not found: %s\n' "$required"
        pause_on_failure
        exit 1
    }
done

TEMP_INSTALLER="${TMPDIR:-/tmp}/BannerlordCoop-Nightly-Installer-$$.sh"
export BANNERLORDCOOP_INSTALLER_LAUNCHER=1

validate_installer() {
    [ -s "$TEMP_INSTALLER" ] || return 1
    local size first marker
    size=$(wc -c < "$TEMP_INSTALLER")
    [ "$size" -ge 4096 ] || return 1
    first=$(head -n 1 "$TEMP_INSTALLER")
    [ "$first" = '#!/usr/bin/env bash' ] || return 1
    marker=$(sed -n '2p' "$TEMP_INSTALLER")
    [ "$marker" = '# Official Bannerlord Coop nightly installer for Linux.' ] || return 1
}

download_installer() {
    local url=$1
    rm -f "$TEMP_INSTALLER"
    curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 \
        --retry 2 --retry-delay 1 \
        -o "$TEMP_INSTALLER" "$url" \
        && validate_installer
}

printf 'Downloading the latest installer...\n'
if ! download_installer "$INSTALLER_PRIMARY"; then
    printf 'The nightly gateway download failed. Trying the GitHub mirror...\n'
    if ! download_installer "$INSTALLER_MIRROR"; then
        rm -f "$TEMP_INSTALLER"
        printf '\nThe latest installer could not be downloaded from the nightly gateway or GitHub mirror.\n'
        printf 'Check your internet connection and try again.\n'
        pause_on_failure
        exit 1
    fi
fi

set +e
bash "$TEMP_INSTALLER"
INSTALLER_EXIT=$?
set -e
rm -f "$TEMP_INSTALLER"

printf '\n'
if [ "$INSTALLER_EXIT" -ne 0 ]; then
    printf 'The installer stopped with an error. The details are shown above.\n'
    pause_on_failure
    exit 1
fi
exit 0
