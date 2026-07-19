from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PYTHON_DIR = PROJECT_ROOT / "python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from prepare_webgis_data import wgs84_to_gcj02  # noqa: E402


DB_PATH = PROJECT_ROOT / ".runtime" / "webgis.db"
GEOJSON_PATH = PROJECT_ROOT / "webgis" / "data" / "complaints.geojson"


def prop(properties: dict[str, object], key: str) -> object:
    value = properties.get(key)
    return "" if value is None else value


def as_float(value: object) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def ensure_database(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS complaints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id TEXT NOT NULL,
            source_filename TEXT,
            created_at TEXT NOT NULL,
            matter_id TEXT,
            content TEXT,
            region TEXT,
            register_time TEXT,
            noise_type TEXT,
            hit_keywords TEXT,
            address TEXT,
            address_status TEXT,
            geocode_address TEXT,
            geocode_status TEXT,
            geocode_message TEXT,
            wgs84_lng REAL,
            wgs84_lat REAL,
            gcj02_lng REAL,
            gcj02_lat REAL,
            convert_status TEXT,
            raw_json TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_complaints_batch_id ON complaints(batch_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_complaints_noise_type ON complaints(noise_type)")


def migrate(geojson_path: Path, db_path: Path) -> dict[str, int]:
    geojson = json.loads(geojson_path.read_text(encoding="utf-8"))
    features = geojson.get("features") or []

    db_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now().isoformat(timespec="seconds")
    batch_id = f"migrated_geojson_{datetime.now().strftime('%Y%m%d%H%M%S')}"

    inserted = 0
    skipped_duplicates = 0
    skipped_invalid = 0

    with sqlite3.connect(db_path) as conn:
        ensure_database(conn)
        existing_ids = {
            row[0]
            for row in conn.execute(
                "SELECT matter_id FROM complaints WHERE matter_id IS NOT NULL AND matter_id <> ''"
            )
        }

        for feature in features:
            properties = feature.get("properties") or {}
            matter_id = str(prop(properties, "\u4e8b\u9879\u7f16\u53f7"))
            if matter_id and matter_id in existing_ids:
                skipped_duplicates += 1
                continue

            geometry = feature.get("geometry") or {}
            coordinates = geometry.get("coordinates") or []
            wgs84_lng = as_float(prop(properties, "WGS84\u7ecf\u5ea6"))
            wgs84_lat = as_float(prop(properties, "WGS84\u7eac\u5ea6"))
            if wgs84_lng is None and len(coordinates) >= 2:
                wgs84_lng = as_float(coordinates[0])
            if wgs84_lat is None and len(coordinates) >= 2:
                wgs84_lat = as_float(coordinates[1])
            if wgs84_lng is None or wgs84_lat is None:
                skipped_invalid += 1
                continue

            converted = wgs84_to_gcj02(wgs84_lng, wgs84_lat)
            gcj02_lng = as_float(converted.get("GCJ02\u7ecf\u5ea6"))
            gcj02_lat = as_float(converted.get("GCJ02\u7eac\u5ea6"))
            convert_status = str(converted.get("\u5750\u6807\u8f6c\u6362\u72b6\u6001") or "")

            raw_json = json.dumps(
                {
                    key: value
                    for key, value in properties.items()
                    if key
                    not in {
                        "\u4e8b\u9879\u7f16\u53f7",
                        "\u8bc9\u6c42\u5185\u5bb9",
                        "\u95ee\u9898\u5c5e\u5730",
                        "\u767b\u8bb0\u65f6\u95f4",
                        "\u566a\u58f0\u5206\u7c7b",
                        "\u566a\u58f0\u5206\u7c7b\u547d\u4e2d\u5173\u952e\u8bcd",
                        "\u8bc6\u522b\u5730\u5740",
                        "WGS84\u7ecf\u5ea6",
                        "WGS84\u7eac\u5ea6",
                        "\u7ecf\u5ea6",
                        "\u7eac\u5ea6",
                    }
                },
                ensure_ascii=False,
            )

            conn.execute(
                """
                INSERT INTO complaints (
                    batch_id, source_filename, created_at, matter_id, content, region, register_time,
                    noise_type, hit_keywords, address, address_status, geocode_address,
                    geocode_status, geocode_message, wgs84_lng, wgs84_lat, gcj02_lng,
                    gcj02_lat, convert_status, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    batch_id,
                    geojson_path.name,
                    now,
                    matter_id,
                    str(prop(properties, "\u8bc9\u6c42\u5185\u5bb9")),
                    str(prop(properties, "\u95ee\u9898\u5c5e\u5730")),
                    str(prop(properties, "\u767b\u8bb0\u65f6\u95f4")),
                    str(prop(properties, "\u566a\u58f0\u5206\u7c7b")),
                    str(prop(properties, "\u566a\u58f0\u5206\u7c7b\u547d\u4e2d\u5173\u952e\u8bcd")),
                    str(prop(properties, "\u8bc6\u522b\u5730\u5740")),
                    "\u6765\u81eaGeoJSON",
                    str(prop(properties, "\u5b8c\u6574\u5730\u5740")),
                    "\u672a\u8c03\u7528",
                    "\u4eceGeoJSON\u5b58\u91cf\u6570\u636e\u8fc1\u79fb",
                    wgs84_lng,
                    wgs84_lat,
                    gcj02_lng,
                    gcj02_lat,
                    convert_status,
                    raw_json,
                ),
            )
            existing_ids.add(matter_id)
            inserted += 1

    return {
        "features": len(features),
        "inserted": inserted,
        "skipped_duplicates": skipped_duplicates,
        "skipped_invalid": skipped_invalid,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate WebGIS GeoJSON features into SQLite.")
    parser.add_argument("--geojson", type=Path, default=GEOJSON_PATH)
    parser.add_argument("--db", type=Path, default=DB_PATH)
    args = parser.parse_args()

    result = migrate(args.geojson, args.db)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
