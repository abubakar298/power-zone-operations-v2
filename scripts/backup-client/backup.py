"""Local encrypted backup client. Credentials live in macOS Keychain, never this file."""
import argparse
import datetime as dt
import getpass
import fcntl
import http.cookiejar
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import urllib.request
from zoneinfo import ZoneInfo

ORIGIN = "https://power-zone-operations-v2.onrender.com"
SERVICE = "pk.powerzone.operations.backup.v1"
ACCOUNT = "scheduled-backup"
STATE = Path(__file__).resolve().parent / "last-success.json"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Backup endpoint redirected; review the configured address before retrying.")

def keychain_read():
    result = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", SERVICE,
                             "-a", ACCOUNT, "-w"], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Backup Keychain entry unavailable. Run setup or unlock your login Keychain.")
    return json.loads(result.stdout)

def keychain_write(value):
    # Interactive input keeps secrets out of process arguments and terminal output.
    command = "add-generic-password -U -s {} -a {} -w {}\n".format(
        shlex.quote(SERVICE), shlex.quote(ACCOUNT), shlex.quote(json.dumps(value)))
    result = subprocess.run(["/usr/bin/security", "-i"], input=command,
                            capture_output=True, text=True)
    if result.returncode or keychain_read() != value:
        raise RuntimeError("Could not save backup credentials to Keychain.")

def request(path, body, token=None, csrf=None, opener=None):
    headers = {"Content-Type": "application/json", "Origin": ORIGIN}
    if token:
        headers["Authorization"] = "Bearer " + token
    if csrf:
        headers["X-CSRF-Token"] = csrf
    req = urllib.request.Request(ORIGIN + "/api/backups" + path,
                                 json.dumps(body).encode(), headers, method="POST")
    return (opener or urllib.request.build_opener(NoRedirect())).open(req, timeout=180)

def setup():
    print("Enroll this Mac for encrypted backups. Enter secrets only here; none are printed or stored in the script.")
    email = input("Administrator email: ").strip()
    password = getpass.getpass("Current administrator password: ")
    phrase = getpass.getpass("Backup encryption passphrase (16–128 characters): ")
    if not 16 <= len(phrase) <= 128 or phrase == password:
        raise RuntimeError("Use a 16–128 character backup passphrase different from your password.")
    if phrase != getpass.getpass("Confirm backup passphrase: "):
        raise RuntimeError("Passphrases do not match.")
    print("This grants this Mac download-only access to all encrypted business backups for one year.")
    if input("Type ENROLL to authorize: ") != "ENROLL":
        raise RuntimeError("Enrollment cancelled.")
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    req = urllib.request.Request(ORIGIN + "/api/auth/login", json.dumps({"email": email,"password":password}).encode(),
                                 {"Content-Type":"application/json","Origin":ORIGIN},method="POST")
    with opener.open(req,timeout=30) as response:
        login = json.load(response)
    try:
        with request("/devices", {"password": password, "label": "Abu Bakar Mac"}, csrf=login["csrfToken"], opener=opener) as response:
            device = json.load(response)
        try:
            keychain_write({"token":device["token"],"passphrase":phrase,"id":device["id"]})
        except Exception:
            with request("/devices/"+device["id"]+"/revoke",{},csrf=login["csrfToken"],opener=opener):
                pass
            raise
    finally:
        req = urllib.request.Request(ORIGIN + "/api/auth/logout",b"{}",{
            "Content-Type":"application/json","Origin":ORIGIN,"X-CSRF-Token":login["csrfToken"]},method="POST")
        with opener.open(req,timeout=30):
            pass
    print("Enrolled. Keep a separate safe copy of the passphrase for recovery. Credential expires in one year.")
    run(force=True)

def due(now, previous):
    return now.hour >= 2 and previous != now.date().isoformat()

def run(force=False):
    now = dt.datetime.now(ZoneInfo("Asia/Karachi"))
    previous = json.loads(STATE.read_text()).get("date") if STATE.exists() else None
    if not force and not due(now, previous):
        print("No backup due.")
        return
    credentials = keychain_read()
    folder = Path.home() / "Downloads" / "Power-Zone-Backups"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = folder / ("Power-Zone-Backup-" + now.strftime("%Y-%m-%d-%H%M%S") + ".pzb")
    temporary = None
    try:
        with request("/device/download",{"passphrase":credentials["passphrase"]}, token=credentials["token"]) as response:
            if response.headers.get_content_type() != "application/octet-stream":
                raise RuntimeError("Server did not return a backup file.")
            fd, temporary = tempfile.mkstemp(prefix=".backup-",suffix=".partial",dir=folder)
            with os.fdopen(fd,"wb") as output:
                first = response.read(8)
                if first != b"PZBACK01":
                    raise RuntimeError("Invalid backup signature; nothing saved.")
                output.write(first)
                total = len(first)
                while chunk := response.read(65536):
                    total += len(chunk)
                    if total > 513 * 1024 * 1024:
                        raise RuntimeError("Backup exceeds size limit.")
                    output.write(chunk)
                if total < 52 or (response.headers.get("Content-Length") and total != int(response.headers["Content-Length"])):
                    raise RuntimeError("Incomplete download; nothing saved.")
                output.flush()
                os.fsync(output.fileno())
        os.replace(temporary, destination)
        temporary = None
        state_tmp = STATE.with_suffix(".tmp")
        state_tmp.write_text(json.dumps({"date":now.date().isoformat(),"file":str(destination)}))
        state_tmp.replace(STATE)
        print("Encrypted backup saved: " + str(destination))
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--setup",action="store_true")
    parser.add_argument("--force",action="store_true")
    args=parser.parse_args()
    try:
        with STATE.with_suffix(".lock").open("w") as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            setup() if args.setup else run(args.force)
    except Exception as error:
        # Never print request bodies, authorization headers, passphrases or server responses.
        print("Backup failed: " + (str(error) if isinstance(error,RuntimeError) else type(error).__name__))
        raise SystemExit(1)
