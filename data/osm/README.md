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
Each of the two download attempts permits up to 40 minutes and resumes the same
dated file. This accommodates a slow provider without restarting the 5 GB transfer.
A transfer below 16 KiB/s for two minutes is interrupted instead of waiting
indefinitely. The whole job is bounded to 95 minutes, including validation and
cleanup; freshness and coverage checks are unchanged.
If resolution or download fails, extraction and publication do not run; the last
validated snapshot remains unchanged. A later successful collection must also
be imported by Supabase before the application's observations are refreshed.
Changes to this workflow or its extraction script on `main` also trigger a run.
Data-only commits do not trigger another collection.

The standard public Linux runner is free under GitHub's published pricing. No
larger runner, cache, artefact upload, external paid service or Mac is used. The
approximately 5 GB source download is temporary on GitHub, never stored in Git.
The generated JSON is limited to 4 MB. The workflow has no database access.

Attribution: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
distributed by [Geofabrik](https://download.geofabrik.de/europe/france.html).
The derived database is available under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Retain this attribution and licence when reusing the data. Contributor account
metadata and contact details are not included.
