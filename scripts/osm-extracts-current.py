import datetime
import json
import os
from pathlib import Path


def extracts_current(root, now=None, source_date=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    threshold = (now - datetime.timedelta(days=1)).date()
    try:
        regions = json.loads((root / "scripts/osm-regions.json").read_text())
        paths = [root / "data/osm/centre.json"]
        paths.extend(root / f"data/osm/regions/{region}.json" for region in regions)
        for path in paths:
            snapshot = json.loads(path.read_text())
            source = snapshot["source"]
            timestamp = datetime.datetime.fromisoformat(source["dataAsOf"].replace("Z", "+00:00"))
            if (source["provider"] != "geofabrik" or timestamp.tzinfo is None
                    or not threshold <= timestamp.astimezone(datetime.timezone.utc).date() <= now.date()
                    or (source_date and timestamp.astimezone(datetime.timezone.utc).date().isoformat() != source_date)
                    or timestamp > now or snapshot["counts"]["areas"] < 1):
                return False
        return len(paths) == 16
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


if __name__ == "__main__":
    current = extracts_current(Path(__file__).resolve().parent.parent, source_date=os.environ.get("OSM_SOURCE_DATE"))
    print("All 16 source dates are current; no repeated download." if current else "A regional source needs refreshing.")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"current={str(current).lower()}\n")
