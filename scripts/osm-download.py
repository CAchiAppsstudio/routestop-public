import hashlib
import datetime
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


LATEST_URLS = (
    "https://download.geofabrik.de/europe/france/france-latest.osm.pbf",
    "https://download.geofabrik.de/europe/france-latest.osm.pbf",
)
DATED_URL = re.compile(r"https://download\.geofabrik\.de/europe/(?:france/)?france-[0-9]{6}\.osm\.pbf")
RESOLVERS = (None, "https://cloudflare-dns.com/dns-query", "https://dns.google/dns-query")
TRANSPORT_ERRORS = {5, 6, 7, 18, 28, 35, 52, 55, 56}
SOURCE_PATH = re.compile(r"/europe/(?:france/)?france-(?:latest|[0-9]{6})\.osm\.pbf(?:\.md5)?")


def secure_source_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme not in ("https", "http") or parsed.netloc != "download.geofabrik.de"
            or not SOURCE_PATH.fullmatch(parsed.path) or parsed.query or parsed.fragment):
        raise RuntimeError("OSM redirect outside the approved official source; existing snapshots preserved.")
    return urlunsplit(("https", parsed.netloc, parsed.path, "", ""))


def dated_source_date(url):
    if not DATED_URL.fullmatch(url):
        raise RuntimeError(f"Unexpected dated OSM source: {url}")
    return datetime.datetime.strptime(url.rsplit("/", 1)[-1][7:13], "%y%m%d").date()


class RequestError(RuntimeError):
    def __init__(self, status, code):
        self.status = status
        super().__init__(f"OSM request refused or invalid (HTTP {status}, curl {code}); no bypass.")


def request(url, output, timeout, *, head=False, resume=False, preferred=None):
    url = secure_source_url(url)
    resolvers = list(dict.fromkeys((preferred, *RESOLVERS)))
    for resolver in resolvers:
        target = url
        visited = set()
        for redirect in range(4):
            if target in visited:
                raise RuntimeError("OSM redirect loop; existing snapshots preserved.")
            visited.add(target)
            command = [
                "curl", "--ipv4", "--fail", "--silent", "--show-error",
                "--proto", "=https", "--proto-redir", "=https",
                "--connect-timeout", "20", "--max-time", str(timeout),
                "--output", str(output), "--write-out", "%{json}",
            ]
            if resolver:
                command.extend(("--doh-url", resolver))
            if head:
                command.append("--head")
            if resume:
                command.extend(("--continue-at", "-", "--speed-limit", "16384", "--speed-time", "120"))
            command.append(target)
            result = subprocess.run(command, capture_output=True, text=True)
            try:
                info = json.loads(result.stdout)
            except ValueError:
                info = {}
            status = int(info.get("http_code", 0))
            route = resolver or "system DNS"
            print(f"OSM download: {route}, HTTP {status}, curl {result.returncode}, server {info.get('remote_ip', '?')}", flush=True)
            if result.returncode == 0 and status in (200, 206):
                info["url_effective"] = target
                return info, resolver
            if result.returncode == 0 and status in (301, 302, 303, 307, 308):
                destination = info.get("redirect_url", "")
                target = secure_source_url(destination)
                if destination != target:
                    print("Official redirect advertised HTTP; requesting the same approved resource over HTTPS only.", flush=True)
                continue
            if result.stderr:
                print(result.stderr.strip(), file=sys.stderr)
            retryable = result.returncode in TRANSPORT_ERRORS or status in (408, 500, 502, 503, 504)
            if not retryable:
                raise RequestError(status, result.returncode)
            if resolver != resolvers[-1]:
                time.sleep(5)
            break
        else:
            raise RuntimeError("Too many OSM redirects; existing snapshots preserved.")
    raise RuntimeError("OSM provider unreachable through the three DNS routes; existing snapshots preserved.")


def resolve_source():
    for url in LATEST_URLS:
        try:
            info, resolver = request(url, "/dev/null", 40, head=True)
        except RequestError as error:
            if error.status not in (404, 410):
                raise
            print(f"Official OSM alias unavailable: {url}", flush=True)
            continue
        source_url = info.get("url_effective", "")
        dated_source_date(source_url)
        return source_url, resolver
    raise RuntimeError("Both official OSM aliases are unavailable; existing snapshots preserved.")


def download(directory):
    directory.mkdir(parents=True, exist_ok=True)
    source_url, resolver = resolve_source()
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
            source_url, resolver = resolve_source()
            print(f"Validated dated source: {source_url}", flush=True)
            if os.environ.get("GITHUB_OUTPUT"):
                with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                    output.write(f"source_date={dated_source_date(source_url).isoformat()}\n")
            if os.environ.get("GITHUB_STEP_SUMMARY"):
                with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
                    summary.write(f"## Source OSM\nAccès HTTPS vérifié : {source_url}\n\nLa date du fichier n’est pas une preuve d’import dans RouteStop.\n")
        else:
            download(Path(sys.argv[1]))
    except (OSError, RuntimeError, ValueError, IndexError) as error:
        print(f"::error::{error}", file=sys.stderr)
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
                summary.write("## Collecte OSM interrompue\nLe téléchargement ou sa validation a échoué. Les anciens fichiers restent disponibles, sans modifier leur date. Consulter l’étape en échec ; une aire à vérifier est un autre problème.\n")
        sys.exit(1)
