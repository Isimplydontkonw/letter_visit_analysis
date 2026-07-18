from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Any

import pandas as pd

from classify_noise_petitions import classify_text, load_keyword_rules
from recognize_addresses import baidu_geocode, extract_address

try:
    from coord_convert import transform
except ImportError:
    transform = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_INPUT = PROJECT_ROOT / "data/2025年噪声.xlsx"
DEFAULT_KEYWORDS = PROJECT_ROOT / "data/噪声关键词.xlsx"
DEFAULT_OUTPUT = PROJECT_ROOT / "webgis/data/complaints.geojson"
DEFAULT_JS_OUTPUT = PROJECT_ROOT / "webgis/data/complaints.js"
DEFAULT_ENRICHED_OUTPUT = PROJECT_ROOT / "data/2025年噪声_webgis处理结果.xlsx"

PI = math.pi
AXIS = 6378245.0
OFFSET = 0.00669342162296594323
X_PI = PI * 3000.0 / 180.0


def is_valid_number(value: object) -> bool:
    try:
        return not pd.isna(value) and math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def transform_lat(x: float, y: float) -> float:
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * PI) + 40.0 * math.sin(y / 3.0 * PI)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * PI) + 320 * math.sin(y * PI / 30.0)) * 2.0 / 3.0
    return ret


def transform_lng(x: float, y: float) -> float:
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * PI) + 40.0 * math.sin(x / 3.0 * PI)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * PI) + 300.0 * math.sin(x / 30.0 * PI)) * 2.0 / 3.0
    return ret


def out_of_china(lng: float, lat: float) -> bool:
    return lng < 72.004 or lng > 137.8347 or lat < 0.8293 or lat > 55.8271


def formula_wgs84_to_gcj02(lng: float, lat: float) -> tuple[float, float]:
    """内置兜底转换：WGS84 -> GCJ-02，用于高德底图叠加。"""
    if out_of_china(lng, lat):
        return lng, lat
    dlat = transform_lat(lng - 105.0, lat - 35.0)
    dlng = transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * PI
    magic = math.sin(radlat)
    magic = 1 - OFFSET * magic * magic
    sqrt_magic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((AXIS * (1 - OFFSET)) / (magic * sqrt_magic) * PI)
    dlng = (dlng * 180.0) / (AXIS / sqrt_magic * math.cos(radlat) * PI)
    return lng + dlng, lat + dlat


def formula_bd09_to_gcj02(lng: float, lat: float) -> tuple[float, float]:
    """内置兜底转换：BD-09 -> GCJ-02。"""
    x = lng - 0.0065
    y = lat - 0.006
    z = math.sqrt(x * x + y * y) - 0.00002 * math.sin(y * X_PI)
    theta = math.atan2(y, x) - 0.000003 * math.cos(x * X_PI)
    return z * math.cos(theta), z * math.sin(theta)


def formula_gcj02_to_wgs84(lng: float, lat: float) -> tuple[float, float]:
    """内置兜底转换：GCJ-02 -> WGS84，采用常见反算近似。"""
    gcj_lng, gcj_lat = formula_wgs84_to_gcj02(lng, lat)
    return lng * 2 - gcj_lng, lat * 2 - gcj_lat


def call_transform(func: Any, lng: float, lat: float) -> tuple[float, float]:
    try:
        result = func(lng, lat)
    except TypeError:
        result = func([lng, lat])
    if isinstance(result, dict):
        return float(result.get("lng") or result.get("lon")), float(result["lat"])
    return float(result[0]), float(result[1])


def transform_with_coord_convert(lng: float, lat: float, names: tuple[str, ...]) -> tuple[float, float] | None:
    if transform is None:
        return None
    for name in names:
        func = getattr(transform, name, None)
        if func is not None:
            return call_transform(func, lng, lat)
    return None


def bd09_to_wgs84_and_gcj02(lng: float, lat: float) -> dict[str, object]:
    """百度 BD-09 坐标转 WGS84 和 GCJ-02，优先依据 coord_convert.transform。"""
    direct_wgs = transform_with_coord_convert(
        lng,
        lat,
        ("bd09_to_wgs84", "bd09towgs84", "bd_to_wgs84", "bd2wgs"),
    )
    direct_gcj = transform_with_coord_convert(
        lng,
        lat,
        ("bd09_to_gcj02", "bd09togcj02", "bd_to_gcj02", "bd2gcj"),
    )

    if direct_wgs and direct_gcj:
        return {
            "WGS84经度": direct_wgs[0],
            "WGS84纬度": direct_wgs[1],
            "GCJ02经度": direct_gcj[0],
            "GCJ02纬度": direct_gcj[1],
            "坐标转换状态": "coord_convert",
            "坐标转换消息": "BD-09 已转换为 WGS84 和 GCJ-02",
        }

    gcj_lng, gcj_lat = direct_gcj if direct_gcj else formula_bd09_to_gcj02(lng, lat)
    wgs_lng, wgs_lat = direct_wgs if direct_wgs else formula_gcj02_to_wgs84(gcj_lng, gcj_lat)
    status = "coord_convert+formula" if transform is not None else "formula_fallback"
    return {
        "WGS84经度": wgs_lng,
        "WGS84纬度": wgs_lat,
        "GCJ02经度": gcj_lng,
        "GCJ02纬度": gcj_lat,
        "坐标转换状态": status,
        "坐标转换消息": "coord_convert 不完整或未安装，已用内置公式补足",
    }


def wgs84_to_gcj02(lng: float, lat: float) -> dict[str, object]:
    """WGS84 坐标转高德使用的 GCJ-02，优先依据 coord_convert.transform。"""
    converted = transform_with_coord_convert(
        lng,
        lat,
        ("wgs84_to_gcj02", "wgs84togcj02", "wgs_to_gcj02", "wgs2gcj"),
    )
    if converted:
        gcj_lng, gcj_lat = converted
        return {
            "GCJ02经度": gcj_lng,
            "GCJ02纬度": gcj_lat,
            "坐标转换状态": "coord_convert",
            "坐标转换消息": "WGS84 已转换为 GCJ-02",
        }

    gcj_lng, gcj_lat = formula_wgs84_to_gcj02(lng, lat)
    return {
        "GCJ02经度": gcj_lng,
        "GCJ02纬度": gcj_lat,
        "坐标转换状态": "formula_fallback",
        "坐标转换消息": "未安装 coord_convert 或未找到转换函数，已用内置公式转换",
    }


def get_existing_value(row: pd.Series, column: str) -> object:
    return row[column] if column in row.index else None


def geocode_or_use_existing(row: pd.Series, ak: str | None) -> dict[str, object]:
    """优先使用已有坐标；没有坐标且提供 AK 时再调用百度地理编码。"""
    raw_lng = get_existing_value(row, "经度")
    raw_lat = get_existing_value(row, "纬度")
    if is_valid_number(raw_lng) and is_valid_number(raw_lat):
        wgs_lng = float(raw_lng)
        wgs_lat = float(raw_lat)
        converted = wgs84_to_gcj02(wgs_lng, wgs_lat)
        return {
            "百度地理编码地址": "",
            "百度经度": "",
            "百度纬度": "",
            "百度地理编码状态": "未调用",
            "百度地理编码消息": "使用原始表经纬度",
            "WGS84经度": wgs_lng,
            "WGS84纬度": wgs_lat,
            **converted,
            "坐标来源": "原始经纬度",
        }

    if not ak:
        return {
            "百度地理编码状态": "未调用",
            "百度地理编码消息": "无原始坐标且未提供百度 AK",
            "坐标转换状态": "跳过",
            "坐标转换消息": "无可用坐标",
            "坐标来源": "无",
        }

    query_address = f"{row.get('问题属地', '')}{row.get('识别地址', '')}"
    geocode = baidu_geocode(query_address, ak)
    if geocode.get("status") != 0 or not is_valid_number(geocode.get("lng")) or not is_valid_number(geocode.get("lat")):
        return {
            "百度地理编码地址": query_address,
            "百度地理编码状态": geocode.get("status"),
            "百度地理编码消息": geocode.get("message"),
            "坐标转换状态": "跳过",
            "坐标转换消息": "百度地理编码未返回有效坐标",
            "坐标来源": "百度地理编码失败",
        }

    bd_lng = float(geocode["lng"])
    bd_lat = float(geocode["lat"])
    converted = bd09_to_wgs84_and_gcj02(bd_lng, bd_lat)
    return {
        "百度地理编码地址": query_address,
        "百度经度": bd_lng,
        "百度纬度": bd_lat,
        "百度置信度": geocode.get("confidence"),
        "百度理解度": geocode.get("comprehension"),
        "百度地址层级": geocode.get("level"),
        "百度地理编码状态": geocode.get("status"),
        "百度地理编码消息": geocode.get("message"),
        **converted,
        "坐标来源": "百度地理编码",
    }


def safe_json_value(value: object) -> object:
    if pd.isna(value):
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def build_geojson(df: pd.DataFrame) -> dict[str, object]:
    features = []
    for _, row in df.iterrows():
        lng = row.get("GCJ02经度")
        lat = row.get("GCJ02纬度")
        if not is_valid_number(lng) or not is_valid_number(lat):
            continue

        properties = {
            "事项编号": safe_json_value(row.get("事项编号")),
            "噪声分类": safe_json_value(row.get("噪声分类")),
            "识别地址": safe_json_value(row.get("识别地址")),
            "问题属地": safe_json_value(row.get("问题属地")),
            "登记时间": safe_json_value(row.get("登记时间")),
            "诉求内容": safe_json_value(row.get("诉求内容")),
            "GCJ02经度": float(lng),
            "GCJ02纬度": float(lat),
            "WGS84经度": safe_json_value(row.get("WGS84经度")),
            "WGS84纬度": safe_json_value(row.get("WGS84纬度")),
            "坐标来源": safe_json_value(row.get("坐标来源")),
            "坐标转换状态": safe_json_value(row.get("坐标转换状态")),
            "坐标转换消息": safe_json_value(row.get("坐标转换消息")),
        }
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(lng), float(lat)]},
                "properties": properties,
            }
        )
    return {"type": "FeatureCollection", "features": features}


def prepare_data(
    input_path: Path,
    keyword_path: Path,
    output_path: Path,
    js_output_path: Path,
    enriched_output: Path,
    ak: str | None,
) -> None:
    rules = load_keyword_rules(keyword_path)
    df = pd.read_excel(input_path)

    classify_result = df["诉求内容"].apply(lambda value: classify_text(value, rules))
    for col in classify_result.columns:
        df[col] = classify_result[col]

    extracted = df["诉求内容"].apply(extract_address)
    df["识别地址"] = extracted.apply(lambda item: item[0])
    df["地址识别状态"] = extracted.apply(lambda item: item[1])

    coordinate_rows = [geocode_or_use_existing(row, ak) for _, row in df.iterrows()]
    coordinate_df = pd.DataFrame(coordinate_rows)
    for col in coordinate_df.columns:
        df[col] = coordinate_df[col]

    geojson = build_geojson(df)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    geojson_text = json.dumps(geojson, ensure_ascii=False, indent=2)
    output_path.write_text(geojson_text, encoding="utf-8")

    # JS 版本作为兜底数据源：即使用户直接打开 index.html，浏览器拦截 fetch 也能显示点位。
    js_output_path.parent.mkdir(parents=True, exist_ok=True)
    js_output_path.write_text(f"window.COMPLAINTS_GEOJSON = {geojson_text};\n", encoding="utf-8")

    enriched_output.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(enriched_output, index=False)

    print(f"已处理记录：{len(df)} 条")
    print(f"有效地图点位：{len(geojson['features'])} 条")
    print(f"跳过无效坐标：{len(df) - len(geojson['features'])} 条")
    print(f"GeoJSON：{output_path}")
    print(f"内置数据：{js_output_path}")
    print(f"处理明细：{enriched_output}")
    print("噪声分类统计：")
    print(df["噪声分类"].value_counts(dropna=False).to_string())
    print("坐标转换状态统计：")
    print(df["坐标转换状态"].value_counts(dropna=False).to_string())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成 WebGIS 使用的信访投诉 GeoJSON 数据")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="原始信访 Excel 文件")
    parser.add_argument("--keywords", type=Path, default=DEFAULT_KEYWORDS, help="噪声关键词 Excel 文件")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="GeoJSON 输出路径")
    parser.add_argument("--js-output", type=Path, default=DEFAULT_JS_OUTPUT, help="前端兜底 JS 数据输出路径")
    parser.add_argument("--enriched-output", type=Path, default=DEFAULT_ENRICHED_OUTPUT, help="处理明细 Excel 输出路径")
    parser.add_argument("--ak", default=os.getenv("BAIDU_MAP_AK"), help="百度地图 AK；有原始坐标时不会调用")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    prepare_data(args.input, args.keywords, args.output, args.js_output, args.enriched_output, args.ak)


if __name__ == "__main__":
    main()
