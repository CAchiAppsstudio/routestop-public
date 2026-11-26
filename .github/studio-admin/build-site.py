"""Build the standalone CachiAppsStudio Admin site from the current commit."""
from argparse import ArgumentParser
from pathlib import Path
from subprocess import check_output

REPO = Path(__file__).resolve().parents[2]
PORTAL = Path("studio-admin")
SHARED = (
    "admin/config.js",
    "admin/vendor/supabase-js-2.105.1.js",
    "assets/icon.png",
    "assets/cachi-appsstudio-logo-928a21d052bb.png",
)
HEADERS = """/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src https://ubvvtmrnczqgoiavijfp.supabase.co; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-Robots-Tag: noindex, nofollow
"""


def git(*args: str) -> bytes:
    return check_output(["git", "-C", str(REPO), *args])


def main() -> None:
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path, help="new directory for the site")
    destination = parser.parse_args().destination.resolve()
    revision = git("rev-parse", "HEAD").decode().strip()
    sources = git("ls-tree", "-r", "--name-only", "-z", revision, "--", str(PORTAL))
    portal_files = [Path(name) for name in sources.decode().split("\0") if name]
    if PORTAL / "index.html" not in portal_files or PORTAL / "podlegacy/index.html" not in portal_files:
        parser.error("the current commit does not contain the Studio portal")
    files = [(source, source.relative_to(PORTAL)) for source in portal_files]
    files += [(Path(source), Path(source)) for source in SHARED]

    destination.mkdir(parents=True)
    for source, name in files:
        output = destination / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(git("show", f"{revision}:{source}"))
    (destination / "_headers").write_text(HEADERS, encoding="utf-8")


if __name__ == "__main__":
    main()
