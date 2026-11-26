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
ROUTESTOP = (
    "app-v2.js",
    "styles-v2.css",
    "area-review.css",
    "area-review-data.js",
    "area-review.js",
)
HEADERS = """/*
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-Robots-Tag: noindex, nofollow
"""
SUPABASE = "ubvvtmrnczqgoiavijfp.supabase.co"
STUDIO_CSP = f"default-src 'none'; script-src 'self'; style-src 'self'; connect-src https://{SUPABASE}; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
SECURITY_CSP = STUDIO_CSP.replace("img-src 'self';", "img-src 'self' data:;")
ROUTESTOP_CSP = f"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://{SUPABASE} wss://{SUPABASE}; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


def git(*args: str) -> bytes:
    return check_output(["git", "-C", str(REPO), *args])


def studio_routestop(page: str) -> str:
    additions = {
        '<html lang="fr">': '<html lang="fr" data-studio-route>',
        '  </head>': '    <link rel="stylesheet" href="./entry.css" />\n  </head>',
        '      <div class="top-actions">': (
            '      <div class="top-actions">\n'
            '        <a class="ghost studio-back" href="../">← Accueil du studio</a>\n'
            '        <a class="ghost studio-back hidden" id="studio-security-link" href="../securite/">Sécurité</a>'
        ),
        '    <main class="layout">': (
            '    <main class="layout">\n'
            '      <p id="studio-route-status" class="hint" role="status">Ouverture du tableau de bord…</p>'
        ),
        '<section id="setup-panel" class="panel">': '<section id="setup-panel" class="panel hidden" hidden>',
        '<section id="auth-panel" class="panel">': '<section id="auth-panel" class="panel hidden" hidden>',
        'src="./config.js"': 'src="../admin/config.js"',
        'src="./vendor/supabase-js-2.105.1.js"></script>': (
            'src="../admin/vendor/supabase-js-2.105.1.js"></script>\n'
            '    <script src="../session.js?v=20261126-apple-code"></script>'
        ),
        './app-v2.js?v=20261124-source-recovery': './app-v2.js?v=20261126-mfa',
    }
    for original, studio in additions.items():
        if page.count(original) != 1:
            raise ValueError(f"Unexpected RouteStop page markup: {original}")
        page = page.replace(original, studio, 1)
    return page


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
    files += [(Path("admin", name), Path("routestop", name)) for name in ROUTESTOP]

    destination.mkdir(parents=True)
    for source, name in files:
        output = destination / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(git("show", f"{revision}:{source}"))
    route_page = git("show", f"{revision}:admin/index.html").decode()
    (destination / "routestop/index.html").write_text(studio_routestop(route_page), encoding="utf-8")
    headers = HEADERS + "".join(
        f"\n{path}\n  Content-Security-Policy: {policy}\n"
        for paths, policy in (
            (("/", "/index.html", "/podlegacy", "/podlegacy/*"), STUDIO_CSP),
            (("/securite", "/securite/*"), SECURITY_CSP),
            (("/routestop", "/routestop/*"), ROUTESTOP_CSP),
        )
        for path in paths
    )
    (destination / "_headers").write_text(headers, encoding="utf-8")


if __name__ == "__main__":
    main()
