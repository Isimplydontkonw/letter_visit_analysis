from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_INPUT = PROJECT_ROOT / "data/2025年噪声_噪声分类结果_2.xlsx"
DEFAULT_GEOJSON_OUTPUT = PROJECT_ROOT / "webgis/data/complaints.geojson"
DEFAULT_JS_OUTPUT = PROJECT_ROOT / "webgis/data/complaints.js"


def is_valid_coordinate(lng: object, lat: object) -> bool:
    try:
        lng_float = float(lng)
        lat_float = float(lat)
    except (TypeError, ValueError):
        return False
    return 70 <= lng_float <= 140 and 0 <= lat_float <= 60


def clean_value(value: object) -> object:
    if pd.isna(value):
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def row_to_feature(row: pd.Series) -> dict[str, object] | None:
    lng = row.get("经度")
    lat = row.get("纬度")
    if not is_valid_coordinate(lng, lat):
        return None

    # GeoJSON geometry 按用户要求保留 WGS84 经纬度；前端加载到高德底图时再做 GCJ-02 显示校准。
    wgs_lng = float(lng)
    wgs_lat = float(lat)
    address = clean_value(row.get("识别地址") or row.get("完整地址") or row.get("问题属地"))

    properties = {
        "事项编号": clean_value(row.get("事项编号")),
        "噪声分类": clean_value(row.get("噪声分类") or "未匹配"),
        "识别地址": address,
        "完整地址": clean_value(row.get("完整地址")),
        "问题属地": clean_value(row.get("问题属地")),
        "登记时间": clean_value(row.get("登记时间")),
        "诉求内容": clean_value(row.get("诉求内容")),
        "WGS84经度": wgs_lng,
        "WGS84纬度": wgs_lat,
        "经度": wgs_lng,
        "纬度": wgs_lat,
        "坐标系": "WGS84",
        "噪声分类命中关键词": clean_value(row.get("噪声分类命中关键词")),
        "噪声分类命中数量": clean_value(row.get("噪声分类命中数量")),
        "噪声分类并列类型": clean_value(row.get("噪声分类并列类型")),
        "噪声分类全部命中": clean_value(row.get("噪声分类全部命中")),
    }

    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [wgs_lng, wgs_lat],
        },
        "properties": properties,
    }


def convert_xlsx_to_geojson(input_path: Path, geojson_output: Path, js_output: Path) -> None:
    df = pd.read_excel(input_path)
    required_columns = {"经度", "纬度"}
    missing_columns = required_columns - set(df.columns)
    if missing_columns:
        raise ValueError(f"缺少必要列：{', '.join(sorted(missing_columns))}")

    features = []
    skipped = 0
    for _, row in df.iterrows():
        feature = row_to_feature(row)
        if feature is None:
            skipped += 1
            continue
        features.append(feature)

    geojson = {
        "type": "FeatureCollection",
        "name": input_path.stem,
        "crs": {
            "type": "name",
            "properties": {"name": "EPSG:4326"},
        },
        "features": features,
    }
    geojson_text = json.dumps(geojson, ensure_ascii=False, indent=2)

    geojson_output.parent.mkdir(parents=True, exist_ok=True)
    geojson_output.write_text(geojson_text, encoding="utf-8")

    js_output.parent.mkdir(parents=True, exist_ok=True)
    js_output.write_text(f"window.COMPLAINTS_GEOJSON = {geojson_text};\n", encoding="utf-8")

    print(f"输入文件：{input_path}")
    print(f"GeoJSON 输出：{geojson_output}")
    print(f"前端内置数据输出：{js_output}")
    print(f"有效点位：{len(features)}")
    print(f"跳过无效坐标：{skipped}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="将整理后的噪声投诉 Excel 切片转换为 WebGIS GeoJSON")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="输入 Excel 文件")
    parser.add_argument("--geojson-output", type=Path, default=DEFAULT_GEOJSON_OUTPUT, help="GeoJSON 输出路径")
    parser.add_argument("--js-output", type=Path, default=DEFAULT_JS_OUTPUT, help="前端 JS 数据输出路径")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    convert_xlsx_to_geojson(args.input, args.geojson_output, args.js_output)


if __name__ == "__main__":
    main()
