# Public OSM extract for Centre

This directory contains only public OpenStreetMap data, processed independently
from the private RouteStop application and its catalogue. No application account,
private identifier, manual correction or credential is exported here.

The GitHub Actions workflow downloads the France extract from Geofabrik daily,
retains the custom Centre coverage (44.4–47.5 latitude, 1–4.2 longitude), and
publishes service-area objects, nearby services and motorway geometry. Centre is
the application's geographical sector, not just the administrative Centre region.

`source.dataAsOf` is the original PBF replication timestamp; `generatedAt` is only
the processing time. Extracts older than 72 hours, incomplete geometries and
substantially reduced area counts are rejected. Failed runs retain the last file.
An extract being current does not guarantee every contributor's description is current.

Resolving the dated download URL retries connection failures and other request
errors up to four times, with a 15-second interval and a bounded retry window.
Both the initial request and redirects require HTTPS. The dated Geofabrik URL
must still pass validation before the existing resumable download starts.
Each of the three download attempts permits up to 40 minutes and resumes the same
dated file. This accommodates a slow provider without restarting the 5 GB transfer.
A transfer below 16 KiB/s for two minutes is interrupted instead of waiting
indefinitely. The whole job is bounded to 180 minutes, including validation and
cleanup; freshness and coverage checks are unchanged.
If resolution or download fails, extraction and publication do not run; the last
validated snapshot remains unchanged. A later successful collection must also
be imported by Supabase before the application's observations are refreshed.
Changes to this workflow or its extraction script on `main` also trigger a run.
Data-only commits do not trigger another collection.

After Centre has been validated and saved independently, the same France download
also feeds the 15 other scheduled motorway sectors in `regions/`. Their exact
boundaries are versioned in `scripts/osm-regions.json`; the non-motorway Atlantic
sector and legacy parent sectors are not added. Each regional file has its own
source date, coverage counts and bounds. At least three service-area objects and
three motorway ways are required; future replacements cannot lose more than 20%
of the previous area's count. A failed sector keeps its previous file, does not
block saving other validated sectors, and still makes the job report a failure.
Temporary files are replaced only after validation, and all PBFs are removed at
the end. The additional processing does not add another France download.

Up to five incomplete OSM relations in a regional extract are quarantined rather
than assigned a guessed geometry. Their IDs are published as `incompleteRelations`;
all complete objects still pass the same coverage checks. More than five rejects
the region. The application records these warnings as a partial observation and
keeps previous data for any linked identity that cannot be verified. Centre keeps
its original strict rejection behavior. A partial source is never reported as a
fully verified region, and quarantined objects do not trigger endless retries.

Application imports only refresh services and tenants of existing, unambiguously
linked areas with matching location, direction and motorway geometry. Unknown
identities remain for manual review; these snapshots do not authorize adding new
areas or changing fuel associations. Dates of receipt and source dates must remain
distinct in the admin dashboard, including when some identities need review.
Regional service-area ways include their closed outline when available. New
nearby services are attached only when their point lies inside exactly one such
outline, not merely within a distance threshold. Missing or ambiguous outlines
do not add nearby services; existing information remains preserved. Centre's
pre-existing parsing behavior is unchanged.

The standard public Linux runner is free under GitHub's published pricing. No
larger runner, cache, artefact upload, external paid service or Mac is used. The
approximately 5 GB source download is temporary on GitHub, never stored in Git.
The generated JSON is limited to 4 MB. The workflow has no database access.

Attribution: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
distributed by [Geofabrik](https://download.geofabrik.de/europe/france.html).
The derived database is available under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Retain this attribution and licence when reusing the data. Contributor account
metadata and contact details are not included.
