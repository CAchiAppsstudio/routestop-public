import argparse
import datetime
import json
import math
from pathlib import Path


BOUNDS = {"south": 44.4, "west": 1, "north": 47.5, "east": 4.2}
TAG_KEYS = {
    "highway", "amenity", "shop", "name", "official_name", "brand", "fuel:brand",
    "operator", "ref", "direction", "destination", "ref:FR:prix-carburants",
    "toilets", "restaurant", "fast_food", "shower", "hotel", "access", "type",
}
AMENITIES = {"fuel", "fast_food", "restaurant", "cafe", "food_court", "bar", "ice_cream", "charging_station"}


def relevant(tags):
    return tags.get("highway") in {"services", "motorway"} or tags.get("amenity") in AMENITIES or bool(tags.get("shop"))


def bounds_of(points):
    return (min(point[0] for point in points), min(point[1] for point in points),
            max(point[0] for point in points), max(point[1] for point in points))


def center(bounds):
    return {"lat": round((bounds[0] + bounds[2]) / 2, 7), "lon": round((bounds[1] + bounds[3]) / 2, 7)}


def inside(point):
    return BOUNDS["south"] <= point["lat"] <= BOUNDS["north"] and BOUNDS["west"] <= point["lon"] <= BOUNDS["east"]


def nearby(point, area, radius=1.1):
    latitude = (point["lat"] - area["lat"]) * 111.32
    longitude = (point["lon"] - area["lon"]) * 111.32 * math.cos(math.radians(area["lat"]))
    return math.hypot(latitude, longitude) <= radius


def prepare(elements, data_as_of, previous=None, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    timestamp = datetime.datetime.fromisoformat(data_as_of.replace("Z", "+00:00"))
    age = (now - timestamp).total_seconds()
    if not 0 <= age < 72 * 3600:
        raise ValueError("Source timestamp missing, future or older than 72 hours")
    areas = [element for element in elements if element["tags"].get("highway") == "services" and inside(element["center"])]
    if not 20 <= len(areas) <= 500:
        raise ValueError(f"Unexpected area count: {len(areas)}")
    selected = list(areas)
    for element in elements:
        if element["tags"].get("highway") == "services":
            continue
        if element["tags"].get("highway") == "motorway":
            geometry = element.get("geometry", [])
            if any(nearby(point, area["center"], 2) for point in geometry for area in areas):
                selected.append(element)
        elif any(nearby(element["center"], area["center"]) for area in areas):
            selected.append(element)
    motorway_count = sum(element["tags"].get("highway") == "motorway" for element in selected)
    if motorway_count < 20:
        raise ValueError("Motorway geometry missing or incomplete")
    if previous:
        previous_time = datetime.datetime.fromisoformat(previous["source"]["dataAsOf"].replace("Z", "+00:00"))
        if timestamp < previous_time or len(areas) < previous["counts"]["areas"] * 0.8:
            raise ValueError("Refusing older or substantially incomplete replacement")
    return {
        "version": 1, "region": "center_2", "bounds": BOUNDS,
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "source": {"provider": "geofabrik", "url": "https://download.geofabrik.de/europe/france-latest.osm.pbf",
                   "dataAsOf": timestamp.isoformat().replace("+00:00", "Z"),
                   "licence": "ODbL-1.0", "attribution": "© OpenStreetMap contributors / Geofabrik"},
        "counts": {"areas": len(areas), "motorways": motorway_count, "elements": len(selected)},
        "elements": sorted(selected, key=lambda element: (element["type"], element["id"])),
    }


def read_elements(filename):
    import osmium

    class Collector(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.boxes = {}
            self.relations = []
            self.elements = []

        def add(self, kind, identifier, tags, box, geometry=None):
            element = {"type": kind, "id": identifier, "center": center(box),
                       "tags": {key: value for key, value in tags.items() if key in TAG_KEYS}}
            if geometry is not None:
                element["geometry"] = geometry
            self.elements.append(element)

        def node(self, node):
            if not node.location.valid():
                raise ValueError(f"Missing location for node {node.id}")
            box = (node.lat, node.lon, node.lat, node.lon)
            self.boxes[("n", node.id)] = box
            tags = dict(node.tags)
            if relevant(tags):
                self.add("node", node.id, tags, box)

        def way(self, way):
            points = [(node.lat, node.lon) for node in way.nodes]
            if not points:
                raise ValueError(f"Empty way {way.id}")
            box = bounds_of(points)
            self.boxes[("w", way.id)] = box
            tags = dict(way.tags)
            if relevant(tags):
                geometry = [{"lat": latitude, "lon": longitude} for latitude, longitude in points] if tags.get("highway") == "motorway" else None
                self.add("way", way.id, tags, box, geometry)

        def relation(self, relation):
            self.relations.append((relation.id, dict(relation.tags), [(member.type, member.ref) for member in relation.members]))

        def finish(self):
            pending = self.relations
            for _attempt in range(10):
                unresolved = []
                for identifier, tags, members in pending:
                    boxes = [self.boxes.get(member) for member in members]
                    if not boxes or any(box is None for box in boxes):
                        unresolved.append((identifier, tags, members))
                        continue
                    box = bounds_of([(box[0], box[1]) for box in boxes] + [(box[2], box[3]) for box in boxes])
                    self.boxes[("r", identifier)] = box
                    if relevant(tags):
                        self.add("relation", identifier, tags, box)
                if len(unresolved) == len(pending):
                    break
                pending = unresolved
            missing = [identifier for identifier, tags, _members in pending if relevant(tags)]
            if missing:
                raise ValueError(f"Incomplete relevant relations: {missing[:20]}")
            return self.elements

    collector = Collector()
    collector.apply_file(filename, locations=True, idx="flex_mem")
    return collector.finish()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--data-as-of", required=True)
    arguments = parser.parse_args()
    destination = Path(arguments.output)
    previous = json.loads(destination.read_text()) if destination.exists() else None
    snapshot = prepare(read_elements(arguments.input), arguments.data_as_of, previous)
    encoded = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n"
    if len(encoded.encode()) > 4_000_000:
        raise ValueError("Extract exceeds 4 MB safety limit")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(encoded)
    print(json.dumps({"source": snapshot["source"], "counts": snapshot["counts"], "bytes": len(encoded.encode())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
