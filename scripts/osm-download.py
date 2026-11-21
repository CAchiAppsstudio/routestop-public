import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


LATEST_URL = "https://download.geofabrik.de/europe/france-latest.osm.pbf"
DATED_URL = re.compile(r"https://download\.geofabrik\.de/europe/(?:france/)?france-[0-9]{6}\.osm\.pbf")
RESOLVERS = (None, "https://cloudflare-dns.com/dns-query", "https://dns.google/dns-query")
TRANSPORT_ERRORS = {5, 6, 7, 18, 28, 35, 52, 55, 56}


def request(url, output, timeout, *, head=False, resume=False, preferred=None):
    resolvers = list(dict.fromkeys((preferred, *RESOLVERS)))
    for resolver in resolvers:
        command = [
            "curl", "--ipv4", "--fail", "--silent", "--show-error",
            "--proto", "=https", "--proto-redir", "=https",
            "--connect-timeout", "20", "--max-time", str(timeout),
            "--output", str(output), "--write-out", "%{json}",
        ]
        if resolver:
            command.extend(("--doh-url", resolver))
        if head:
            command.extend(("--head", "--location", "--max-redirs", "3"))
        if resume:
            command.extend(("--continue-at", "-", "--speed-limit", "16384", "--speed-time", "120"))
        command.append(url)
        result = subprocess.run(command, capture_output=True, text=True)
        try:
            info = json.loads(result.stdout)
        except ValueError:
            info = {}
        status = int(info.get("http_code", 0))
        route = resolver or "system DNS"
        print(f"OSM download: {route}, HTTP {status}, curl {result.returncode}, server {info.get('remote_ip', '?')}", flush=True)
        if result.returncode == 0 and status in (200, 206):
            return info, resolver
        if result.stderr:
            print(result.stderr.strip(), file=sys.stderr)
        retryable = result.returncode in TRANSPORT_ERRORS or status in (408, 500, 502, 503, 504)
        if not retryable:
            raise RuntimeError(f"OSM request refused or invalid (HTTP {status}, curl {result.returncode}); no bypass.")
    raise RuntimeError("OSM provider unreachable through the three DNS routes; existing snapshots preserved.")


def download(directory):
    directory.mkdir(parents=True, exist_ok=True)
    info, resolver = request(LATEST_URL, "/dev/null", 40, head=True)
    source_url = info.get("url_effective", "")
    if not DATED_URL.fullmatch(source_url):
        raise RuntimeError(f"Unexpected dated OSM source: {source_url}")
    print(f"Validated dated source: {source_url}", flush=True)
    checksum_path = directory / "france.osm.pbf.md5"
    request(source_url + ".md5", checksum_path, 40, preferred=resolver)
    checksum = checksum_path.read_text().strip()
    if not re.fullmatch(r"[0-9a-fA-F]{32}\s+\*?france-[0-9]{6}\.osm\.pbf", checksum):
        raise RuntimeError("Invalid OSM checksum format; existing snapshots preserved.")
    if checksum.split()[-1].lstrip("*") != source_url.rsplit("/", 1)[-1]:
        raise RuntimeError("OSM checksum refers to a different dated file.")
    target = directory / "france.osm.pbf"
    request(source_url, target, 2400, resume=True, preferred=resolver)
    digest = hashlib.md5()
    with target.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != checksum.split()[0].lower():
        raise RuntimeError("OSM file checksum mismatch; existing snapshots preserved.")
    print("OSM dated file fully downloaded and checksum verified.", flush=True)


if __name__ == "__main__":
    try:
        if sys.argv[1] == "--check":
            info, resolver = request(LATEST_URL, "/dev/null", 40, head=True)
            if not DATED_URL.fullmatch(info.get("url_effective", "")):
                raise RuntimeError("Unexpected dated OSM source.")
        else:
            download(Path(sys.argv[1]))
    except (OSError, RuntimeError, ValueError, IndexError) as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)
