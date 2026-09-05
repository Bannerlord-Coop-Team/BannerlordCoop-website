#!/usr/bin/env bash
# Official Bannerlord Coop nightly installer for Linux.
# Same gateway, Discord check, Windows client/server artifacts, and update
# policy as install.ps1. Linux only changes how Steam, 7-Zip, and files work.

set -u

GATEWAY='https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev'
CLIENT_ARCHIVE_URI="$GATEWAY/v1/artifacts/nightly/Coop.7z"
SERVER_ARCHIVE_URI="$GATEWAY/v1/artifacts/nightly/BannerlordCoop-DedicatedServer-Win64.7z"
MAX_CLIENT=26214400
MAX_SERVER=8589934592
MAX_BASE=8589934592
MAX_UPDATE=536870912
WANT_CLIENT=0
WANT_SERVER=0
TOKEN=''
MODULES_DIR=''
SERVER_DIR=''

pause_at_end() {
    [ "${BANNERLORDCOOP_INSTALLER_LAUNCHER:-}" = 1 ] && return 0
    [ -t 0 ] || return 0
    printf '\nPress Enter to close the installer.'
    read -r _ || true
    printf '\n'
}

die() {
    printf '\nInstallation failed: %s\n' "$1" >&2
    [ -n "${2:-}" ] && printf '%s\n' "$2" >&2
    printf 'If you need help, copy this message and ask in the Bannerlord Coop Discord.\n' >&2
    pause_at_end
    exit 1
}

ask() {
    [ -t 0 ] || die "This installer needs a terminal to confirm what it changes."
    printf '%s [Y/n]: ' "$1"
    read -r answer || return 1
    case "$answer" in
        [Nn]*) return 1 ;;
        *) return 0 ;;
    esac
}

is_hex64() { [ ${#1} -eq 64 ] && [ -z "${1//[0-9a-f]/}" ]; }
is_hex40() { [ ${#1} -eq 40 ] && [ -z "${1//[0-9a-f]/}" ]; }
is_num() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

hsize() {
    [ -n "${1:-}" ] && [ "$1" -gt 0 ] 2>/dev/null || { printf 'unknown size'; return; }
    awk -v b="$1" 'BEGIN{
        if (b>=1073741824) printf "%.2f GiB", b/1073741824;
        else printf "%.1f MiB", b/1048576
    }'
}

json_get() {
    python3 -c "
import json,sys
data=json.load(sys.stdin)
for key in '''$1'''.split('.'):
    if data is None: break
    if isinstance(data, dict):
        data=data.get(key)
    else:
        data=None
        break
if data is None:
    sys.stdout.write('')
elif isinstance(data, bool):
    sys.stdout.write('true' if data else 'false')
else:
    sys.stdout.write(str(data))
"
}

json_list() {
    python3 -c "
import json,sys
data=json.load(sys.stdin)
for key in '''$1'''.split('.'):
    if data is None: break
    if isinstance(data, dict):
        data=data.get(key)
    else:
        data=None
        break
if not isinstance(data, list):
    raise SystemExit(0)
for item in data:
    if item is None:
        continue
    print(item)
"
}

short_sha() {
    local sha=$1
    [ ${#sha} -le 7 ] && { printf '%s' "$sha"; return; }
    printf '%s' "${sha:0:7}"
}

display_date() {
    python3 - "$1" "$2" <<'PY'
from datetime import datetime, timezone
import sys
release, built = sys.argv[1:3]
if not built:
    print(release)
    raise SystemExit
try:
    from zoneinfo import ZoneInfo
    stamp=datetime.strptime(built.split('.')[0].rstrip('Z'), '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
    print(stamp.astimezone(ZoneInfo('America/Chicago')).strftime('%Y-%m-%d'))
except Exception:
    print(release)
PY
}

check_client_url() {
    # Match Test-NightlyClientArtifactUri in install.ps1. The immutable URL
    # must identify both this release's commit and its exact archive bytes.
    [ "$CLIENT_URL" = "$CLIENT_ARCHIVE_URI" ] || \
        [ "$CLIENT_URL" = "$GATEWAY/v1/artifacts/nightly/clients/$HEAD_SHA/$CLIENT_SHA/Coop.7z" ] \
        || die "The nightly client release metadata is invalid."
}

token_poll_decision() {
    local status=$1 response=$2 error token token_type
    error=$(json_get error < "$response" 2>/dev/null) || error=''
    if [ "$status" = 200 ]; then
        token=$(json_get access_token < "$response" 2>/dev/null) || token=''
        token_type=$(json_get token_type < "$response" 2>/dev/null) || token_type=''
        if [ "$token_type" = Bearer ] && [[ $token =~ ^[A-Za-z0-9_-]{43}$ ]]; then
            TOKEN=$token
            return 0
        fi
    fi
    # Some proxies turn HTTP 428 into 200 while preserving the pending JSON.
    if [ "$status" = 428 ] || [ "$error" = authorization_pending ]; then
        return 0
    fi
    if [ "$status" = 403 ] || [ "$error" = access_denied ] || [ "$error" = supporter_role_required ]; then
        die "Discord access was denied. The Tester role, a current Patreon, Boosty, or Afdian supporter role, or an active sponsored-account seat is required."
    fi
    if [ "$status" = 409 ] || [ "$error" = already_used ]; then
        die "This Discord verification was already used. Close extra installer windows and run the installer again."
    fi
    if [ "$status" = 400 ] || [ "$status" = 401 ] || [ "$error" = expired_token ] || [ "$error" = invalid_request ]; then
        die "The Discord verification expired. Run the installer again to start a new check."
    fi
    [ "$status" != 200 ] || die "The nightly authorization token is invalid."
    die "Could not check Discord verification (HTTP $status). Run the installer again."
}

check_url() {
    local url=$1 kind=$2 host path
    host=${GATEWAY#https://}
    case "$url" in
        "https://$host/"*) ;;
        *) die "Unexpected server $kind artifact URL." "$url" ;;
    esac
    path=${url#https://$host}
    case "$path" in
        *'?'*|*'#'*) die "Unexpected server $kind artifact URL." "$url" ;;
    esac
    if [ "$kind" = base ]; then
        [[ $path =~ ^/v1/artifacts/windows/base/v1/[0-9a-f]{64}/[0-9a-f]{64}/server-base\.7z$ ]] \
            || die "Unexpected server base artifact URL." "$url"
    else
        [[ $path =~ ^/v1/artifacts/(nightly/windows/updates/[0-9a-f]{40}/[0-9a-f]{40}|release/[0-9]{17,20}/windows/update)/[0-9a-f]{64}/server-update\.7z$ ]] \
            || die "Unexpected server update artifact URL." "$url"
    fi
}

for required in curl python3 sha256sum mktemp stat awk df pgrep; do
    command -v "$required" >/dev/null 2>&1 || die "Required command not found: $required" \
        "These are all standard on any distro."
done

EXTRACTOR=''
command -v 7zz >/dev/null 2>&1 && EXTRACTOR=7zz
[ -z "$EXTRACTOR" ] && command -v 7z >/dev/null 2>&1 && EXTRACTOR=7z
[ -z "$EXTRACTOR" ] && command -v bsdtar >/dev/null 2>&1 && EXTRACTOR=bsdtar
[ -n "$EXTRACTOR" ] || die "Need 7zz, 7z, or bsdtar to extract the archives." \
    "Install 7-Zip, p7zip, or libarchive which provides bsdtar."

printf 'BannerlordCoop nightly installer\n'
printf 'This downloads and installs the latest completed Supporter and Tester nightly for you.\n'
printf 'The client and dedicated server are the Windows builds. On Linux they run through Wine or Proton.\n'
printf '\n'
printf 'What would you like to install?\n'
printf '  1. Coop client mod\n'
printf '  2. Windows dedicated server\n'
printf '  3. Both client and dedicated server\n'
while :; do
    printf 'Enter 1, 2, or 3: '
    read -r choice || die "Installation cancelled."
    case "$choice" in
        1) WANT_CLIENT=1; break ;;
        2) WANT_SERVER=1; break ;;
        3) WANT_CLIENT=1; WANT_SERVER=1; break ;;
        *) printf 'Please enter 1, 2, or 3.\n' ;;
    esac
done
printf '\n'

PROGRESS=0
Z_Q=()
if [ -t 2 ]; then
    PROGRESS=1
    if [ "$EXTRACTOR" != bsdtar ] && "$EXTRACTOR" 2>&1 | grep -q 'bs{o|e|p}'; then
        Z_Q=(-bso0 -bsp1)
    fi
fi
BAR_COLS=$( { [ -n "${COLUMNS:-}" ] && printf '%s' "$COLUMNS"; } || tput cols 2>/dev/null || echo 80 )

bar_line() {
    awk -v d="$1" -v t="$2" -v e="$3" -v lbl="$4" -v cols="$BAR_COLS" 'BEGIN{
        if (t <= 0) t = 1
        pct = d * 100 / t; if (pct > 100) pct = 100
        rate = (e > 0) ? d / e : 0
        eta  = (rate > 0) ? (t - d) / rate : 0; if (eta < 0) eta = 0
        hs = (d >= 1073741824) ? sprintf("%.2f GiB", d/1073741824) : sprintf("%.1f MiB", d/1048576)
        rs = (rate >= 1048576) ? sprintf("%.1f MiB/s", rate/1048576) : sprintf("%.0f KiB/s", rate/1024)
        es = sprintf("%02d:%02d", int(eta/60), int(eta)%60)
        left = sprintf("%-24.24s %10s %11s %6s ", lbl, hs, rs, es)
        w = cols - length(left) - 8; if (w < 10) w = 10
        n = int(w * pct / 100)
        s = "["
        for (i = 0; i < w; i++) s = s ((i < n) ? "#" : "-")
        printf "%s%s] %3d%%", left, s, pct
    }'
}

unz() {
    printf 'Extracting %s...\n' "$3"
    mkdir -p "$2"
    if [ "$EXTRACTOR" = bsdtar ]; then
        bsdtar -xf "$1" -C "$2"
    elif [ ${#Z_Q[@]} -gt 0 ]; then
        "$EXTRACTOR" x -y "${Z_Q[@]}" -o"$2" "$1"
    else
        "$EXTRACTOR" x -y -o"$2" "$1" >/dev/null
    fi
}

is_bannerlord_modules() {
    local path=$1 game
    [ "$(basename "$path")" = Modules ] || return 1
    game=$(dirname "$path")
    [ -d "$game/bin/Win64_Shipping_Client" ] && [ -f "$path/Native/SubModule.xml" ]
}

find_modules() {
    local root vdf lib game
    for root in "$HOME/.local/share/Steam" "$HOME/.steam/steam" "$HOME/.steam/root" \
                "$HOME/.var/app/com.valvesoftware.Steam/data/Steam"; do
        [ -d "$root/steamapps" ] || continue
        libs=("$root")
        vdf="$root/steamapps/libraryfolders.vdf"
        if [ -f "$vdf" ]; then
            while IFS= read -r lib; do
                lib=${lib//\\/\/}
                [ -d "$lib" ] && libs+=("$lib")
            done < <(sed -n 's/.*"path"[[:space:]]*"\(.*\)".*/\1/p' "$vdf")
        fi
        for lib in "${libs[@]}"; do
            game="$lib/steamapps/common/Mount & Blade II Bannerlord"
            if is_bannerlord_modules "$game/Modules"; then
                printf '%s' "$game/Modules"
                return 0
            fi
        done
    done
    return 1
}

select_client_path() {
    local found answer path
    found=$(find_modules || true)
    if [ -n "$found" ]; then
        printf 'Bannerlord was found here:\n  %s\n' "$found"
        if ask "Install the Coop client there?"; then
            MODULES_DIR=$found
            return 0
        fi
    fi
    while :; do
        printf 'Enter the full path to your Bannerlord Modules folder (or Q to cancel): '
        read -r answer || die "Installation cancelled."
        case "$answer" in
            [Qq]|[Qq][Uu][Ii][Tt]) die "Installation cancelled." ;;
        esac
        path=${answer%"/"}
        if [ "$(basename "$path")" != Modules ] && [ -d "$path/Modules" ]; then
            path="$path/Modules"
        fi
        if is_bannerlord_modules "$path"; then
            if ask "Install the Coop client into ${path}?"; then
                MODULES_DIR=$path
                return 0
            fi
        else
            printf 'That is not a Bannerlord Modules folder. It must contain Native/SubModule.xml.\n'
        fi
    done
}

select_server_path() {
    local recommended answer path items
    recommended="$HOME/Downloads/BannerlordCoop Dedicated Server"
    printf '\nThe dedicated server does not belong inside the Bannerlord game installation.\n'
    items=$(command ls -A "$recommended" 2>/dev/null || true)
    if { [ -z "$items" ] || [ -f "$recommended/BannerlordCoopServer.exe" ]; } \
        && ask "Install it in the recommended folder?
  $recommended"; then
        SERVER_DIR=$recommended
        return 0
    fi
    if [ -n "$items" ] && [ ! -f "$recommended/BannerlordCoopServer.exe" ]; then
        printf 'The recommended folder already contains unrelated files, so it will not be used.\n'
    fi
    while :; do
        printf 'Enter an empty folder or an existing BannerlordCoop dedicated-server folder (or Q to cancel): '
        read -r answer || die "Installation cancelled."
        case "$answer" in
            [Qq]|[Qq][Uu][Ii][Tt]) die "Installation cancelled." ;;
        esac
        path=${answer%"/"}
        if [ -f "$path" ]; then
            printf 'The selected path is a file, not a folder.\n'
            continue
        fi
        items=$(command ls -A "$path" 2>/dev/null || true)
        if [ -n "$items" ] && [ ! -f "$path/BannerlordCoopServer.exe" ]; then
            printf 'That folder is not empty and is not an existing BannerlordCoop server installation.\n'
            printf 'Choose an empty folder so unrelated files cannot be overwritten.\n'
            continue
        fi
        if ask "Install the dedicated server into ${path}?"; then
            SERVER_DIR=$path
            return 0
        fi
    done
}

printf '\nNightly access verification\n'
printf 'Nightly builds are for Testers, current Patreon, Boosty, or Afdian supporters, and up to 10 Discord accounts sponsored by each eligible member.\n'
printf 'A browser will open so Discord can verify access for this install or update.\n'

sess=$(curl -fsS --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 30 \
    -X POST "$GATEWAY/v1/device/sessions" \
    -H 'Content-Type: application/x-www-form-urlencoded' -d 'client=installer') \
    || die "Could not reach the nightly authorization service."
DEVICE_CODE=$(printf '%s' "$sess" | json_get device_code)
USER_CODE=$(printf '%s' "$sess" | json_get user_code)
VERIFY_URI=$(printf '%s' "$sess" | json_get verification_uri)
INTERVAL=$(printf '%s' "$sess" | json_get interval)
EXPIRES=$(printf '%s' "$sess" | json_get expires_in)
[[ $DEVICE_CODE =~ ^[A-Za-z0-9_-]{43}$ ]] \
    || die "The nightly authorization service returned an invalid response."
case "$USER_CODE" in
    [A-Z2-9][A-Z2-9][A-Z2-9][A-Z2-9]-[A-Z2-9][A-Z2-9][A-Z2-9][A-Z2-9]) ;;
    *) die "The nightly authorization service returned an invalid response." ;;
esac
case "$VERIFY_URI" in
    "$GATEWAY/activate?"*) ;;
    *) die "The nightly authorization service returned an invalid response." ;;
esac
is_num "$INTERVAL" || INTERVAL=3
[ "$INTERVAL" -lt 3 ] && INTERVAL=3
is_num "$EXPIRES" || EXPIRES=600
[ "$EXPIRES" -gt 600 ] && EXPIRES=600
printf 'Verification code: %s\n' "$USER_CODE"
printf 'Opening Discord verification in your browser...\n'
if command -v xdg-open >/dev/null 2>&1; then
    (xdg-open "$VERIFY_URI" >/dev/null 2>&1 &)
fi
printf 'If no browser opens, go to:\n  %s\n' "$VERIFY_URI"

AUTH_WORK=$(mktemp -d "${TMPDIR:-/tmp}/bannerlordcoop-auth-XXXXXX") \
    || die "Cannot create an authorization work directory."
trap 'rm -rf "$AUTH_WORK"' EXIT
deadline=$(( $(date +%s) + EXPIRES ))
while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep "$INTERVAL"
    tf="$AUTH_WORK/token.json"
    st=$(curl -sS --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 30 -o "$tf" -w '%{http_code}' \
        -X POST "$GATEWAY/v1/device/token" \
        -H 'Content-Type: application/x-www-form-urlencoded' \
        --data-urlencode "device_code=$DEVICE_CODE") \
        || die "Could not reach the nightly authorization service."
    token_poll_decision "$st" "$tf"
    rm -f "$tf"
    [ -z "$TOKEN" ] || break
done
[ -n "$TOKEN" ] || die "Discord verification timed out. Run the installer again when you are ready to authorize it."
printf 'Nightly access verified.\n'

AUTH=(-H "Authorization: Bearer $TOKEN")
MANIFEST_URI="$GATEWAY/v1/manifests/release"
[ "$WANT_SERVER" = 0 ] && MANIFEST_URI="$GATEWAY/v1/manifests/client"
printf 'Checking the latest completed nightly release...\n'
mf="$AUTH_WORK/manifest.json"
st=$(curl -sS --max-time 60 "${AUTH[@]}" -o "$mf" -w '%{http_code}' "$MANIFEST_URI")
if [ "$st" != 200 ]; then
    rm -f "$mf"
    if [ "$st" = 404 ]; then
        if [ "$WANT_SERVER" = 0 ]; then
            die "No Patron client nightly has been published yet. Wait for the next completed nightly build, then run the installer again."
        fi
        die "No matched Patron client and dedicated-server nightly has been published yet. Wait for the next completed nightly build, then run the installer again."
    fi
    die "Could not read the release manifest (HTTP $st)."
fi

REL_DATE=$(json_get releaseDate < "$mf")
BUILT_AT=$(json_get builtAt < "$mf")
HEAD_SHA=$(json_get headSha < "$mf")
MAN_VER=$(json_get version < "$mf")
CLIENT_URL=$(json_get client.publicUrl < "$mf")
CLIENT_SHA=$(json_get client.sha256 < "$mf")
CLIENT_BYTES=$(json_get client.bytes < "$mf")
CLIENT_NAME=$(json_get client.fileName < "$mf")
FULL_URL=$(json_get server.publicUrl < "$mf")
FULL_SHA=$(json_get server.sha256 < "$mf")
FULL_BYTES=$(json_get server.bytes < "$mf")
FULL_NAME=$(json_get server.fileName < "$mf")
INC_VER=$(json_get server.incremental.version < "$mf")
INC_LAYOUT=$(json_get server.incremental.layout < "$mf")
INC_FP=$(json_get server.incremental.baseFingerprint < "$mf")
BASE_URL=$(json_get server.incremental.base.publicUrl < "$mf")
BASE_SHA=$(json_get server.incremental.base.sha256 < "$mf")
BASE_BYTES=$(json_get server.incremental.base.bytes < "$mf")
BASE_NAME=$(json_get server.incremental.base.fileName < "$mf")
UPD_URL=$(json_get server.incremental.update.publicUrl < "$mf")
UPD_SHA=$(json_get server.incremental.update.sha256 < "$mf")
UPD_BYTES=$(json_get server.incremental.update.bytes < "$mf")
UPD_NAME=$(json_get server.incremental.update.fileName < "$mf")
COMPAT_FPS=$(json_list server.incremental.compatibleBaseFingerprints < "$mf")
rm -f "$mf"

[ "$MAN_VER" = 1 ] || die "The nightly release manifest is invalid."
case "$REL_DATE" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    *) die "The nightly release manifest is invalid." ;;
esac
is_hex40 "$HEAD_SHA" || die "The nightly release manifest is invalid."
printf 'Latest nightly: %s (%s)\n' "$(display_date "$REL_DATE" "$BUILT_AT")" "$(short_sha "$HEAD_SHA")"

check_client_url
is_hex64 "$CLIENT_SHA" || die "The nightly client release metadata is invalid."
is_num "$CLIENT_BYTES" && [ "$CLIENT_BYTES" -gt 0 ] && [ "$CLIENT_BYTES" -le "$MAX_CLIENT" ] \
    || die "The nightly client release metadata is invalid."
[[ $CLIENT_NAME =~ ^[A-Za-z0-9][A-Za-z0-9\ ._-]{0,199}\.7z$ ]] \
    || die "The nightly client release metadata is invalid."

if [ "$WANT_SERVER" = 1 ]; then
    [ "$FULL_URL" = "$SERVER_ARCHIVE_URI" ] || die "The nightly server release metadata is invalid."
    is_hex64 "$FULL_SHA" || die "The nightly server release metadata is invalid."
    is_num "$FULL_BYTES" && [ "$FULL_BYTES" -gt 0 ] && [ "$FULL_BYTES" -le "$MAX_SERVER" ] \
        || die "The nightly server release metadata is invalid."
    [[ $FULL_NAME =~ ^[A-Za-z0-9][A-Za-z0-9\ ._-]{0,199}\.7z$ ]] \
        || die "The nightly server release metadata is invalid."
    if [ -n "$INC_LAYOUT" ] || [ -n "$INC_FP" ]; then
        [ "$INC_LAYOUT" = base-overlay-v1 ] || die "The incremental Windows server release metadata is invalid."
        [ "$INC_VER" = 1 ] || die "The incremental Windows server release metadata is invalid."
        is_hex64 "$INC_FP" || die "The incremental Windows server release metadata is invalid."
        compat_count=0
        seen=''
        while IFS= read -r fp; do
            [ -n "$fp" ] || continue
            is_hex64 "$fp" || die "The incremental Windows server compatibility metadata is invalid."
            case "$seen" in
                *"|$fp|"*) die "The incremental Windows server compatibility metadata is invalid." ;;
            esac
            seen="$seen|$fp|"
            compat_count=$((compat_count + 1))
        done <<EOF
$COMPAT_FPS
EOF
        [ "$compat_count" -le 16 ] || die "The incremental Windows server compatibility metadata is invalid."
        check_url "$BASE_URL" base
        check_url "$UPD_URL" update
        is_hex64 "$BASE_SHA" && is_hex64 "$UPD_SHA" \
            || die "The incremental Windows server release metadata is invalid."
        is_num "$BASE_BYTES" && [ "$BASE_BYTES" -gt 0 ] && [ "$BASE_BYTES" -le "$MAX_BASE" ] \
            || die "The incremental Windows server base metadata is invalid."
        is_num "$UPD_BYTES" && [ "$UPD_BYTES" -gt 0 ] && [ "$UPD_BYTES" -le "$MAX_UPDATE" ] \
            || die "The incremental Windows server update metadata is invalid."
        [[ $BASE_NAME =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$ ]] \
            || die "The incremental Windows server base metadata is invalid."
        [[ $UPD_NAME =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$ ]] \
            || die "The incremental Windows server update metadata is invalid."
    fi
fi

[ "$WANT_CLIENT" = 1 ] && select_client_path
[ "$WANT_SERVER" = 1 ] && select_server_path

printf '\nReady to install:\n'
[ "$WANT_CLIENT" = 1 ] && printf '  Client: %s/Coop\n' "$MODULES_DIR"
[ "$WANT_SERVER" = 1 ] && printf '  Dedicated server: %s\n' "$SERVER_DIR"
ask "Continue with the installation?" || die "Installation cancelled."

if [ "$WANT_SERVER" = 1 ] && pgrep -f 'BannerlordCoopServer\.exe' >/dev/null 2>&1; then
    die "The dedicated server is running. Stop it before installing an update."
fi

WORK_BASE=''
[ "$WANT_SERVER" = 1 ] && WORK_BASE=$(dirname "$SERVER_DIR")
[ -z "$WORK_BASE" ] && [ "$WANT_CLIENT" = 1 ] && WORK_BASE=$MODULES_DIR
[ -n "$WORK_BASE" ] && mkdir -p "$WORK_BASE" 2>/dev/null
WORK=''
[ -n "$WORK_BASE" ] && WORK=$(mktemp -d "$WORK_BASE/.bannerlordcoop-installer-XXXXXX" 2>/dev/null || true)
[ -n "$WORK" ] || WORK=$(mktemp -d "${TMPDIR:-/tmp}/bannerlordcoop-installer-XXXXXX") \
    || die "Cannot create a work directory."
trap 'rm -rf "$AUTH_WORK" "$WORK"' EXIT

need_space() {
    local want=$1 path=$2 what=$3 parent avail
    [ "$want" -gt 0 ] || return 0
    while [ ! -d "$path" ]; do
        parent=$(dirname "$path")
        [ "$parent" = "$path" ] && break
        path=$parent
    done
    avail=$(df -PB1 "$path" 2>/dev/null | awk 'NR==2{print $4}')
    is_num "${avail:-}" || return 0
    [ "$avail" -ge "$want" ] || die "There is not enough space on the disk." \
        "Free up about $(hsize $(( want - avail ))) in $path before installing $what."
}
[ "$WANT_CLIENT" = 1 ] && need_space $(( CLIENT_BYTES * 3 )) "$MODULES_DIR" "the client mod"
[ "$WANT_SERVER" = 1 ] && {
    if [ -n "$INC_LAYOUT" ]; then need_space $(( (BASE_BYTES + UPD_BYTES) * 5 / 2 )) "$(dirname "$SERVER_DIR")" "the dedicated server"
    else need_space $(( FULL_BYTES * 5 / 2 )) "$(dirname "$SERVER_DIR")" "the dedicated server"
    fi
}

get() {
    local url=$1 dest=$2 expected=$3 hash=$4 label=$5
    is_hex64 "$hash" || die "Refusing to download $label: no valid sha256 to check it against."
    is_num "$expected" && [ "$expected" -gt 0 ] || die "Refusing to download $label: no valid size."
    if [ "$PROGRESS" = 1 ]; then
        curl -fsS --proto '=https' --tlsv1.2 --max-time 14400 \
            --max-filesize "$expected" "${AUTH[@]}" -o "$dest" "$url" &
        local cp=$! t0 elapsed
        t0=$(date +%s)
        while kill -0 "$cp" 2>/dev/null; do
            elapsed=$(( $(date +%s) - t0 ))
            printf '\r%s' "$(bar_line "$(stat -c%s "$dest" 2>/dev/null || echo 0)" "$expected" "$elapsed" "$label")" >&2
            sleep 0.2
        done
        wait "$cp" || { printf '\n' >&2; die "Download failed: $label"; }
        elapsed=$(( $(date +%s) - t0 ))
        printf '\r%s\n' "$(bar_line "$expected" "$expected" "$elapsed" "$label")" >&2
    else
        printf 'Downloading %s (%s). This may take a while...\n' "$label" "$(hsize "$expected")"
        curl -fsS --proto '=https' --tlsv1.2 --max-time 14400 \
            --max-filesize "$expected" "${AUTH[@]}" -o "$dest" "$url" || die "Download failed: $label"
    fi
    printf 'Verifying %s...\n' "$label"
    local got sum
    got=$(stat -c%s "$dest")
    [ "$got" = "$expected" ] || die "$label download was incomplete."
    sum=$(sha256sum "$dest" | cut -d' ' -f1)
    [ "$sum" = "$hash" ] || die "$label did not match the published SHA-256 hash. The nightly may still be updating; try again shortly."
    printf 'Downloaded %s.\n' "$label"
}

assert_stage() {
    local root=$1 required
    for required in \
        "BannerlordCoopServer.exe" \
        "engine/bin/Win64_Shipping_Server/TaleWorlds.Starter.DotNetCore.dll" \
        "engine/Modules/Native/SubModule.xml" \
        "engine/Modules/Coop/SubModule.xml" \
        "engine/Modules/Coop/bin/Win64_Shipping_Server/Coop.Core.dll" \
        "engine/Modules/DedicatedServer.Windows/SubModule.xml" \
        "engine/Modules/DedicatedServer.Windows/bin/Win64_Shipping_Server/DedicatedServer.Windows.dll"
    do
        [ -e "$root/$required" ] || { printf 'The server release is missing %s.\n' "$required" >&2; return 1; }
    done
}

write_state() {
    python3 - "$1/.bannerlordcoop-install.json" "$INC_FP" "$2" "$UPD_SHA" <<'PY'
import datetime, json, os, sys
path, fingerprint, base, update = sys.argv[1:5]
temporary = path + ".new"
with open(temporary, "w", encoding="utf-8") as handle:
    json.dump({
        "version": 1,
        "baseFingerprint": fingerprint,
        "baseSha256": base,
        "updateSha256": update,
        "installedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }, handle)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.replace(temporary, path)
PY
}

read_state() {
    local path=$1
    [ -f "$path" ] || return 1
    python3 - "$path" <<'PY'
import json,re,sys
try:
    data=json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    raise SystemExit(1)
hex64=re.compile(r"^[0-9a-f]{64}$")
if data.get("version") != 1 or not hex64.match(str(data.get("baseFingerprint",""))) \
        or not hex64.match(str(data.get("baseSha256",""))) \
        or not hex64.match(str(data.get("updateSha256",""))):
    raise SystemExit(1)
print(data["baseFingerprint"])
print(data["baseSha256"])
print(data["updateSha256"])
PY
}

publish_dir() {
    local src=$1 dst=$2 keep=${3:-}
    mkdir -p "$(dirname "$dst")" || die "Could not create $(dirname "$dst")."
    local old=""
    if [ -d "$dst" ]; then
        old="$dst.replacing.$$"
        rm -rf "$old"
        mv "$dst" "$old" || die "Could not move the old install aside." "$dst"
    fi
    if ! mv "$src" "$dst"; then
        [ -n "$old" ] && mv "$old" "$dst"
        die "Could not publish to $dst."
    fi
    if [ -n "$old" ]; then
        if [ "$keep" = keep ]; then
            rm -rf "$dst.previous"
            mv "$old" "$dst.previous" || rm -rf "$old"
        else
            rm -rf "$old"
        fi
    fi
}

fingerprint_matches() {
    local installed=$1
    [ "$installed" = "$INC_FP" ] && return 0
    while IFS= read -r fp; do
        [ "$installed" = "$fp" ] && return 0
    done <<EOF
$COMPAT_FPS
EOF
    return 1
}

install_client() {
    printf '\nInstalling the Coop client mod...\n'
    get "$CLIENT_URL" "$WORK/Coop.7z" "$CLIENT_BYTES" "$CLIENT_SHA" "Coop client"
    unz "$WORK/Coop.7z" "$WORK/client-stage" "Coop client" || die "Could not extract the client archive."
    local staged="$WORK/client-stage/Coop"
    [ -f "$staged/SubModule.xml" ] && [ -f "$staged/bin/Win64_Shipping_Client/Coop.Core.dll" ] \
        || die "The client archive does not contain a valid Coop module."
    printf 'Removing the old Coop client from %s/Coop...\n' "$MODULES_DIR"
    publish_dir "$staged" "$MODULES_DIR/Coop"
    printf 'Client installed: %s/Coop\n' "$MODULES_DIR"
}

overlay_owned() {
    local stage=$1 installed_base=$2
    local required=(
        "BannerlordCoopServer.exe"
        "engine/Modules/Coop"
        "engine/Modules/DedicatedServer.Windows/SubModule.xml"
        "engine/Modules/DedicatedServer.Windows/bin/Win64_Shipping_Server/DedicatedServer.Windows.dll"
        "engine/Modules/DedicatedServer.Windows/bin/Win64_Shipping_Server/DedicatedServer.Core.dll"
        "engine/bin/Win64_Shipping_Server/DedicatedServer.Core.dll"
        "release-info.txt"
    )
    local optional=(
        "engine/bin/Win64_Shipping_Server/TaleWorlds.Starter.DotNetCore.deps.json"
        "engine/bin/Win64_Shipping_Server/System.Diagnostics.DiagnosticSource.dll"
        "engine/bin/Win64_Shipping_Server/System.Threading.Channels.dll"
        "engine/bin/Win64_Shipping_Server/System.Collections.Immutable.dll"
        "engine/bin/Win64_Shipping_Server/System.Text.Json.dll"
        "engine/bin/Win64_Shipping_Server/System.Reflection.Metadata.dll"
        "engine/bin/Win64_Shipping_Server/System.Text.Encoding.CodePages.dll"
        "engine/bin/Win64_Shipping_Server/System.IO.Pipelines.dll"
        "engine/bin/Win64_Shipping_Server/System.Text.Encodings.Web.dll"
        "engine/bin/Win64_Shipping_Server/Microsoft.Bcl.AsyncInterfaces.dll"
        "engine/bin/Win64_Shipping_Server/default_new_game.sav"
        "server-data/Game Saves/default_new_game.sav"
        "server-data/mod-config.json"
    )
    local relative
    for relative in "${required[@]}"; do
        [ -e "$stage/$relative" ] || die "The server update is missing $relative."
    done
    local owned=("${required[@]}")
    for relative in "${optional[@]}"; do
        [ -e "$stage/$relative" ] && owned+=("$relative")
    done
    mkdir -p "$WORK/rollback" || die "Could not create a rollback copy."
    for relative in "${owned[@]}"; do
        [ -e "$SERVER_DIR/$relative" ] || continue
        mkdir -p "$WORK/rollback/$(dirname "$relative")"
        cp -a "$SERVER_DIR/$relative" "$WORK/rollback/$relative" \
            || die "Could not back up $relative before updating."
    done
    local applied=()
    for relative in "${owned[@]}"; do
        if [ "$relative" = "server-data/mod-config.json" ] && [ -f "$SERVER_DIR/$relative" ]; then
            continue
        fi
        # Include the current target before any destructive operation, just as
        # Windows does: a failed copy may already have removed or changed it.
        applied+=("$relative")
        if ! { rm -rf "${SERVER_DIR:?}/$relative" && \
            mkdir -p "$SERVER_DIR/$(dirname "$relative")" && \
            cp -a "$stage/$relative" "$SERVER_DIR/$relative"; }; then
            for done in "${applied[@]}"; do
                rm -rf "${SERVER_DIR:?}/$done"
                [ -e "$WORK/rollback/$done" ] && {
                    mkdir -p "$SERVER_DIR/$(dirname "$done")"
                    cp -a "$WORK/rollback/$done" "$SERVER_DIR/$done" || true
                }
            done
            die "The server update failed and was rolled back."
        fi
    done
    if ! assert_stage "$SERVER_DIR" || ! write_state "$SERVER_DIR" "$installed_base"; then
        for done in "${applied[@]}"; do
            rm -rf "${SERVER_DIR:?}/$done"
            [ -e "$WORK/rollback/$done" ] && {
                mkdir -p "$SERVER_DIR/$(dirname "$done")"
                cp -a "$WORK/rollback/$done" "$SERVER_DIR/$done" || true
            }
        done
        die "The server update failed and was rolled back."
    fi
}

install_server() {
    printf '\nInstalling the Windows dedicated server...\n'
    if [ -z "$INC_LAYOUT" ]; then
        get "$SERVER_ARCHIVE_URI" "$WORK/server.7z" "$FULL_BYTES" "$FULL_SHA" "dedicated server"
        unz "$WORK/server.7z" "$WORK/stage" "dedicated server" || die "Could not extract the server archive."
        [ -f "$WORK/stage/BannerlordCoopServer.exe" ] && [ -d "$WORK/stage/engine" ] \
            || die "The server archive does not contain a valid dedicated server."
        if [ -d "$SERVER_DIR/server-data" ]; then
            mkdir -p "$WORK/stage/server-data"
            cp -a "$SERVER_DIR/server-data/." "$WORK/stage/server-data/" \
                || die "Could not preserve server-data (your saves and config)."
        fi
        publish_dir "$WORK/stage" "$SERVER_DIR" keep
        printf 'Dedicated server installed: %s\n' "$SERVER_DIR"
        return 0
    fi

    local state_fp='' state_base='' state_upd='' same_base=0
    if state=$(read_state "$SERVER_DIR/.bannerlordcoop-install.json"); then
        state_fp=$(printf '%s' "$state" | sed -n '1p')
        state_base=$(printf '%s' "$state" | sed -n '2p')
        state_upd=$(printf '%s' "$state" | sed -n '3p')
        fingerprint_matches "$state_fp" && same_base=1
    fi

    if [ "$same_base" = 1 ] && [ "$state_upd" = "$UPD_SHA" ]; then
        printf 'The dedicated server is already up to date.\n'
        return 0
    fi

    get "$UPD_URL" "$WORK/server-update.7z" "$UPD_BYTES" "$UPD_SHA" "dedicated server update"
    unz "$WORK/server-update.7z" "$WORK/update-stage" "dedicated server update" \
        || die "Could not extract the update."

    if [ "$same_base" = 1 ]; then
        overlay_owned "$WORK/update-stage" "$state_base"
        printf 'Dedicated server updated without downloading the unchanged engine and assets.\n'
        return 0
    fi

    get "$BASE_URL" "$WORK/server-base.7z" "$BASE_BYTES" "$BASE_SHA" "dedicated server base"
    unz "$WORK/server-base.7z" "$WORK/complete-stage" "dedicated server base" \
        || die "Could not extract the base."
    unz "$WORK/server-update.7z" "$WORK/complete-stage" "dedicated server update" \
        || die "Could not overlay the update."
    assert_stage "$WORK/complete-stage" || die "The downloaded server release is incomplete."
    if [ -d "$SERVER_DIR/server-data" ]; then
        mkdir -p "$WORK/complete-stage/server-data"
        cp -a "$SERVER_DIR/server-data/." "$WORK/complete-stage/server-data/" \
            || die "Could not preserve server-data (your saves and config)."
    fi
    write_state "$WORK/complete-stage" "$BASE_SHA" \
        || die "The install marker could not be written."
    publish_dir "$WORK/complete-stage" "$SERVER_DIR" keep
    printf 'Dedicated server installed with an incremental-update base.\n'
    [ -d "$SERVER_DIR.previous" ] && printf 'The previous installation is retained for rollback at %s.previous\n' "$SERVER_DIR"
}

[ "$WANT_CLIENT" = 1 ] && install_client
[ "$WANT_SERVER" = 1 ] && install_server

printf '\n'
printf '  ____                              _               _    ____                  \n'
printf ' | __ )  __ _ _ __  _ __   ___ _ __| | ___  _ __ __| |  / ___|___   ___  _ __ \n'
printf " |  _ \\ / _\` | '_ \\| '_ \\ / _ \\ '__| |/ _ \\| '__/ _\` | | |   / _ \\ / _ \\| '_ \\\\\n"
printf ' | |_) | (_| | | | | | | |  __/ |  | | (_) | | | (_| | | |__| (_) | (_) | |_) |\n'
printf ' |____/ \\__,_|_| |_|_| |_|\\___|_|  |_|\\___/|_|  \\__,_|  \\____\\___/ \\___/| .__/\n'
printf '                                                                        |_|   \n'
printf '             |\\/\\/\\/|                                       |\\/\\/\\/|\n'
printf '             |######|                                       |######|\n'
printf '             |######|                                       |######|\n'
printf '             |######|                                       |######|\n'
printf '             |######|                                       |######|\n'
printf '              \\####/                                         \\####/\n'
printf '               \\##/                                           \\##/\n'
printf '                \\/                                             \\/\n'
printf '                ||                                             ||\n'
printf '                ||                                             ||\n'
printf '                ||                                             ||\n'
printf '\nInstallation complete!\n'
printf '\nInstallation locations:\n'
[ "$WANT_CLIENT" = 1 ] && printf '  Client: %s/Coop\n' "$MODULES_DIR"
[ "$WANT_SERVER" = 1 ] && printf '  Dedicated server: %s\n' "$SERVER_DIR"
printf '\nPress Enter to close the installer.\n'
[ "${BANNERLORDCOOP_INSTALLER_LAUNCHER:-}" = 1 ] || [ ! -t 0 ] || read -r _ || true
exit 0
