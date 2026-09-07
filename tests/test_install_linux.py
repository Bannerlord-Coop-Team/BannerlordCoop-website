"""Run the real interactive installer with local HTTP fixtures and real 7-Zip.

No gateway credentials, network requests, Wine, or game installation are used.
Only curl, browser/process discovery, and poll delays are replaced on PATH.
"""

import hashlib
import json
import os
from pathlib import Path
import pty
import shutil
import subprocess
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = Path(os.environ.get("COOP_TEST_INSTALLER", ROOT / "installer/install-linux.sh"))
GATEWAY = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev"
HEAD = "a" * 40
TOKEN = {"access_token": "T" * 43, "token_type": "Bearer"}
COOP_DLL = "Coop/bin/Win64_Shipping_Client/Coop.Core.dll"
SERVER_DLL = "engine/Modules/DedicatedServer.Windows/bin/Win64_Shipping_Server/DedicatedServer.Windows.dll"
BASE_FILES = {
    "engine/bin/Win64_Shipping_Server/TaleWorlds.Starter.DotNetCore.dll": "engine",
    "engine/Modules/Native/SubModule.xml": "native",
}
UPDATE_FILES = {
    "BannerlordCoopServer.exe": "server",
    "engine/Modules/Coop/SubModule.xml": "coop",
    "engine/Modules/Coop/bin/Win64_Shipping_Server/Coop.Core.dll": "coop-dll",
    "engine/Modules/DedicatedServer.Windows/SubModule.xml": "server-module",
    SERVER_DLL: "server-dll",
    "engine/Modules/DedicatedServer.Windows/bin/Win64_Shipping_Server/DedicatedServer.Core.dll": "core",
    "engine/bin/Win64_Shipping_Server/DedicatedServer.Core.dll": "core",
    "release-info.txt": "release",
    "server-data/mod-config.json": "default-config",
    "server-data/Game Saves/default_new_game.sav": "default-save",
}

CURL = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ["COOP_FIXTURES"])
config = json.loads((root / "http.json").read_text())
args = sys.argv[1:]
url = args[-1]
# Session POSTs put form arguments after the URL.
url = next((arg for arg in args if arg.startswith("https://")), url)
with (root / "requests.jsonl").open("a") as handle:
    handle.write(json.dumps(url) + "\n")
status, body = 200, None
if url.endswith("/v1/device/sessions"):
    body = config["session"]
elif url.endswith("/v1/device/token"):
    counter = root / "polls"
    count = int(counter.read_text()) if counter.exists() else 0
    status, body = config["polls"][min(count, len(config["polls"]) - 1)]
    counter.write_text(str(count + 1))
else:
    assert "Authorization: Bearer " + "T" * 43 in args, "Missing fixture authorization"
    if "/v1/manifests/" in url:
        body = config["manifest"]
    elif url in config["artifacts"]:
        body = (root / config["artifacts"][url]).read_bytes()
    else:
        status, body = 404, {"error": "unexpected_fixture_url"}
if not isinstance(body, bytes):
    body = json.dumps(body).encode()
if "-o" in args:
    pathlib.Path(args[args.index("-o") + 1]).write_bytes(body)
else:
    sys.stdout.buffer.write(body)
if "-w" in args:
    sys.stdout.write(str(status))
if status >= 400 and any(arg.startswith("-") and "f" in arg and not arg.startswith("--") for arg in args):
    sys.exit(22)
'''

COPY = r'''#!/usr/bin/env python3
import os, pathlib, sys
source = sys.argv[-2]
if "/update-stage/" in source and source.endswith(os.environ.get("COOP_FAIL_COPY", "NO_MATCH")):
    # Fail after touching the current target, not only before the copy starts.
    target = pathlib.Path(sys.argv[-1])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("partial-copy")
    sys.exit(1)
os.execv("/bin/cp", ["cp", *sys.argv[1:]])
'''


class LinuxInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="coop-linux-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.home = self.root / "home"
        self.modules = self.home / ".local/share/Steam/steamapps/common/Mount & Blade II Bannerlord/Modules"
        (self.modules / "Native").mkdir(parents=True)
        (self.modules / "Native/SubModule.xml").write_text("native")
        (self.modules.parent / "bin/Win64_Shipping_Client").mkdir(parents=True)
        self.server = self.home / "Downloads/BannerlordCoop Dedicated Server"
        self.write_executable("curl", CURL)
        self.write_executable("xdg-open", "#!/bin/sh\nexit 0\n")
        self.write_executable("pgrep", "#!/bin/sh\nexit 1\n")
        self.write_executable("sleep", "#!/bin/sh\nexit 0\n")
        self.write_executable("cp", COPY)
        self.env = {
            **os.environ,
            "HOME": str(self.home),
            "TMPDIR": str(self.root),
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "COOP_FIXTURES": str(self.root),
            "BANNERLORDCOOP_INSTALLER_LAUNCHER": "1",
        }
        self.config = {
            "session": {
                "device_code": "D" * 43,
                "user_code": "ABCD-2345",
                "verification_uri": GATEWAY + "/activate?code=ABCD-2345",
                "interval": 3,
                "expires_in": 600,
            },
            "polls": [[200, TOKEN]],
            "artifacts": {},
            "manifest": {"version": 1, "releaseDate": "2026-09-04", "headSha": HEAD},
        }
        self.client = self.archive("client", {"Coop/SubModule.xml": "module", COOP_DLL: "new-client"})
        self.set_client_url(GATEWAY + f"/v1/artifacts/nightly/clients/{HEAD}/{self.client['sha256']}/Coop.7z")
        self.config["manifest"]["client"] = self.client

    def write_executable(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def archive(self, name, files):
        path = self.root / (name + ".7z")
        # 7-Zip detects the format by bytes; ZIP fixtures avoid a packing dependency.
        with zipfile.ZipFile(path, "w") as archive:
            for filename, contents in files.items():
                archive.writestr(filename, contents)
        data = path.read_bytes()
        return {"fileName": path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    def set_client_url(self, url):
        self.client["publicUrl"] = url
        self.config["artifacts"][url] = "client.7z"

    def configure_server(self, incremental=True, revision="first"):
        update_files = {key: value + revision for key, value in UPDATE_FILES.items()}
        server = self.archive("server", {**BASE_FILES, **update_files})
        server["publicUrl"] = GATEWAY + "/v1/artifacts/nightly/BannerlordCoop-DedicatedServer-Win64.7z"
        self.config["artifacts"][server["publicUrl"]] = "server.7z"
        if incremental:
            base = self.archive("server-base", BASE_FILES)
            update = self.archive("server-update", update_files)
            base["publicUrl"] = GATEWAY + f"/v1/artifacts/windows/base/v1/{'b' * 64}/{base['sha256']}/server-base.7z"
            update["publicUrl"] = GATEWAY + f"/v1/artifacts/nightly/windows/updates/{HEAD}/{'c' * 40}/{update['sha256']}/server-update.7z"
            for part in [base, update]:
                self.config["artifacts"][part["publicUrl"]] = part["fileName"]
            server["incremental"] = {
                "version": 1, "layout": "base-overlay-v1", "baseFingerprint": "b" * 64,
                "base": base, "update": update, "compatibleBaseFingerprints": [],
            }
        self.config["manifest"]["server"] = server
        return server

    def run_installer(self, choice=1, success=True):
        (self.root / "http.json").write_text(json.dumps(self.config))
        (self.root / "requests.jsonl").write_text("")
        (self.root / "polls").unlink(missing_ok=True)
        primary, terminal = pty.openpty()
        try:
            process = subprocess.Popen(
                ["bash", str(INSTALLER)], stdin=terminal, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, env=self.env, text=True,
            )
            # Input is a terminal so real prompts/confirmations execute; output is
            # a pipe to disable progress animation and make failures readable.
            os.write(primary, (str(choice) + "\n" + "y\n" * 5).encode())
            try:
                output, _ = process.communicate(timeout=25)
            except subprocess.TimeoutExpired:
                process.kill()
                output, _ = process.communicate()
                self.fail("Installer timed out:\n" + output)
        finally:
            os.close(primary)
            os.close(terminal)
        if success:
            self.assertEqual(process.returncode, 0, output)
            self.assertIn("Installation complete!", output)
        else:
            self.assertNotEqual(process.returncode, 0, output)
            self.assertNotIn("Installation complete!", output)
        self.assertEqual(list(self.root.glob("bannerlordcoop-auth-*")), [], output)
        self.requests = [json.loads(line) for line in (self.root / "requests.jsonl").read_text().splitlines()]
        return output

    def legacy_client(self):
        self.set_client_url(GATEWAY + "/v1/artifacts/nightly/Coop.7z")

    def test_content_addressed_client_downloads_exact_manifest_url(self):
        self.run_installer()
        self.assertEqual((self.modules / COOP_DLL).read_text(), "new-client")
        self.assertIn(self.client["publicUrl"], self.requests)
        self.assertNotIn(GATEWAY + "/v1/artifacts/nightly/Coop.7z", self.requests)
        self.assertIn(GATEWAY + "/v1/manifests/client", self.requests)

    def test_legacy_client_still_installs(self):
        self.legacy_client()
        self.run_installer()
        self.assertEqual((self.modules / COOP_DLL).read_text(), "new-client")

    def test_wrong_client_identity_or_origin_is_rejected_before_download(self):
        valid = self.client["publicUrl"]
        for invalid in [
            valid.replace(HEAD, "d" * 40),
            valid.replace(self.client["sha256"], "d" * 64),
            valid.replace(GATEWAY, "https://example.com"),
            valid + "?download=1", valid + "#archive",
            valid.replace("https:", "http:"),
            valid.replace("/Coop.7z", "/../Coop.7z"),
        ]:
            with self.subTest(url=invalid):
                self.client["publicUrl"] = invalid
                output = self.run_installer(success=False)
                self.assertIn("client release metadata is invalid", output)
                self.assertFalse(any("/artifacts/" in url for url in self.requests))

    def test_pending_http_200_and_428_continue_until_authorized(self):
        self.legacy_client()
        self.config["polls"] = [[200, {"error": "authorization_pending"}], [428, {"error": "authorization_pending"}], [200, TOKEN]]
        self.run_installer()
        self.assertEqual((self.root / "polls").read_text(), "3")

    def test_auth_errors_stop_with_windows_messages(self):
        cases = [
            (200, {"error": "already_used"}, "already used"),
            (409, {}, "already used"),
            (200, {"error": "supporter_role_required"}, "access was denied"),
            (403, {}, "access was denied"),
            (200, {"error": "expired_token"}, "verification expired"),
            (401, {}, "verification expired"),
            (200, {"access_token": "AA" + "!" * 41, "token_type": "Bearer"}, "token is invalid"),
            (500, {}, "Could not check Discord verification"),
        ]
        for status, body, message in cases:
            with self.subTest(status=status, body=body):
                self.config["polls"] = [[status, body]]
                output = self.run_installer(success=False)
                self.assertIn(message, output)
                self.assertFalse(any("/manifests/" in url for url in self.requests))

    def test_invalid_device_code_is_rejected(self):
        self.config["session"]["device_code"] = "AAA" + "!" * 40
        self.assertIn("invalid response", self.run_installer(success=False))
        self.assertFalse(any("/token" in url for url in self.requests))

    def test_invalid_archive_names_and_incremental_version_are_rejected(self):
        for name in ["Coop/other.7z", "Coop\n.7z", "C" * 201 + ".7z"]:
            with self.subTest(name=name):
                self.client["fileName"] = name
                self.assertIn("client release metadata is invalid", self.run_installer(success=False))
        self.client["fileName"] = "Coop.7z"
        server = self.configure_server()
        del server["incremental"]["version"]
        self.assertIn("incremental Windows server release metadata is invalid", self.run_installer(choice=2, success=False))

    def test_build_timestamp_is_data_not_python_code(self):
        sentinel = self.root / "unexpected-code-execution"
        self.config["manifest"]["builtAt"] = "''';open(" + repr(str(sentinel)) + ",'w').write('bad');#"
        self.run_installer()
        self.assertFalse(sentinel.exists())

    def test_size_and_hash_failures_preserve_existing_client(self):
        target = self.modules / COOP_DLL
        target.parent.mkdir(parents=True)
        target.write_text("old-client")
        for data in [b"x", b"x" * self.client["bytes"]]:
            with self.subTest(size=len(data)):
                (self.root / "client.7z").write_bytes(data)
                self.run_installer(success=False)
                self.assertEqual(target.read_text(), "old-client")

    def test_full_server_and_client_install_together(self):
        self.configure_server(incremental=False)
        self.run_installer(choice=3)
        self.assertEqual((self.modules / COOP_DLL).read_text(), "new-client")
        self.assertEqual((self.server / SERVER_DLL).read_text(), "server-dllfirst")
        self.assertIn(GATEWAY + "/v1/manifests/release", self.requests)

    def test_incremental_update_keeps_engine_saves_config_and_base_identity(self):
        self.configure_server()
        self.run_installer(choice=2)
        state_path = self.server / ".bannerlordcoop-install.json"
        installed = json.loads(state_path.read_text())
        (self.server / "server-data/mod-config.json").write_text("my-config")
        save = self.server / "server-data/Game Saves/my-save.sav"
        save.write_text("my-save")
        release = self.configure_server(revision="second")
        release["incremental"]["baseFingerprint"] = "c" * 64
        release["incremental"]["compatibleBaseFingerprints"] = [installed["baseFingerprint"]]
        self.run_installer(choice=2)
        updated = json.loads(state_path.read_text())
        self.assertEqual(updated["baseSha256"], installed["baseSha256"])
        self.assertEqual(updated["baseFingerprint"], "c" * 64)
        self.assertEqual((self.server / SERVER_DLL).read_text(), "server-dllsecond")
        self.assertEqual((self.server / "server-data/mod-config.json").read_text(), "my-config")
        self.assertEqual(save.read_text(), "my-save")
        self.assertFalse(any("/windows/base/" in url for url in self.requests))
        self.assertIn("already up to date", self.run_installer(choice=2))
        self.assertFalse(any("/artifacts/" in url for url in self.requests))

    def prepare_update(self):
        self.legacy_client()
        self.configure_server()
        self.run_installer(choice=2)
        self.configure_server(revision="second")
        return {str(p.relative_to(self.server)): p.read_bytes() for p in self.server.rglob("*") if p.is_file()}

    def assert_original_files(self, original):
        for path, contents in original.items():
            self.assertEqual((self.server / path).read_bytes(), contents, path)

    def test_partial_copy_failure_rolls_back_current_target_and_previous_targets(self):
        original = self.prepare_update()
        self.env["COOP_FAIL_COPY"] = SERVER_DLL
        self.assertIn("rolled back", self.run_installer(choice=2, success=False))
        self.assert_original_files(original)

    def test_marker_failure_rolls_back_updated_files(self):
        original = self.prepare_update()
        (self.server / ".bannerlordcoop-install.json.new").mkdir()
        self.assertIn("rolled back", self.run_installer(choice=2, success=False))
        self.assert_original_files(original)

    def test_modern_7zz_extractor(self):
        extractor = shutil.which("7zz") or shutil.which("7z")
        (self.bin / "7zz").symlink_to(extractor)
        self.write_executable("7z", "#!/bin/sh\nexit 1\n")
        self.legacy_client()
        self.run_installer()


if __name__ == "__main__":
    unittest.main(verbosity=2)
