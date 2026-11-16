import argparse
import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path


def collect(input_path, output_directory, data_as_of):
    scripts = Path(__file__).resolve().parent
    specification = importlib.util.spec_from_file_location("centre_extract", scripts / "osm-centre-extract.py")
    extractor = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(extractor)
    regions = json.loads((scripts / "osm-regions.json").read_text())
    output_directory.mkdir(parents=True, exist_ok=True)
    failures = []
    with tempfile.TemporaryDirectory(prefix="osm-regions-", dir=input_path.parent) as temporary:
        filtered = Path(temporary) / "france-services.osm.pbf"
        subprocess.run(["osmium", "tags-filter", str(input_path), "nwr/highway=services", "w/highway=motorway",
                        "nwr/amenity=fuel,fast_food,restaurant,cafe,food_court,bar,ice_cream,charging_station",
                        "nwr/shop", "-o", str(filtered)], check=True)
        for region, bounds in regions.items():
            regional = Path(temporary) / f"{region}.osm.pbf"
            pending = output_directory / f"{region}.pending"
            try:
                box = f'{bounds["west"] - 0.03},{bounds["south"] - 0.03},{bounds["east"] + 0.03},{bounds["north"] + 0.03}'
                subprocess.run(["osmium", "extract", f"--bbox={box}", "--strategy=smart",
                                str(filtered), "-o", str(regional)], check=True)
                destination = output_directory / f"{region}.json"
                previous = json.loads(destination.read_text()) if destination.exists() else None
                incomplete_relations = []
                snapshot = extractor.prepare(extractor.read_elements(regional, incomplete_relations), data_as_of, previous,
                                             region=region, bounds=bounds, minimum_areas=3, minimum_motorways=3)
                if incomplete_relations:
                    snapshot["incompleteRelations"] = incomplete_relations
                encoded = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n"
                if len(encoded.encode()) > 4_000_000:
                    raise ValueError("Extract exceeds 4 MB safety limit")
                pending.write_text(encoded)
                pending.replace(destination)
                print(json.dumps({"region": region, "source": snapshot["source"]["dataAsOf"],
                                  "counts": snapshot["counts"], "bytes": len(encoded.encode()),
                                  "incompleteRelations": incomplete_relations}), flush=True)
            except Exception as error:
                failures.append(region)
                print(json.dumps({"region": region, "error": str(error), "previousRetained": True}), flush=True)
            finally:
                regional.unlink(missing_ok=True)
                pending.unlink(missing_ok=True)
    if failures:
        raise SystemExit(f"Regional extracts require review: {', '.join(failures)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--data-as-of", required=True)
    arguments = parser.parse_args()
    collect(arguments.input, arguments.output, arguments.data_as_of)


if __name__ == "__main__":
    main()
