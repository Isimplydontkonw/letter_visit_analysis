from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode
from urllib.request import urlopen

import pandas as pd

try:
    from coord_convert import transform
except ImportError:
    transform = None



PROJECT_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_INPUT_PATHS = (
    PROJECT_ROOT / "data/2025年噪声.xlsx",
    PROJECT_ROOT / ".data/2025年噪声.xlsx",
)

# 地址截止词：截取到首次出现的地址实体边界词为止，并保留该截止词。
# 单字边界词容易出现在行政区划或道路名里，因此用正则排除“鹿城区”“裘村镇”“府东路”等误切场景。
STOP_PATTERNS = (
    re.compile(r"门牌号|号楼|东门|西门|南门|北门|小区|社区|大厦|广场|中心|公司|工厂|厂房|学校|医院|市场|商场|酒店|公寓|写字楼|停车场|幢|栋|号|门"),
    re.compile(r"园(?!区|路|街|大道)"),
    re.compile(r"苑(?!区|路|街|大道)"),
    re.compile(r"府(?!东|西|南|北|路|街|大道)"),
    re.compile(r"城(?!区|市|镇|乡|路|街|大道)"),
    re.compile(r"村(?!镇|乡|街道|路|街|大道|委会)"),
    re.compile(r"厂(?!名)"),
)

# 地址起点词：从行政区划、街道道路、住宅或实体名称附近开始截取。
START_PATTERN = re.compile(
    r"(?:[\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|乡|街道)|"
    r"[\u4e00-\u9fa5A-Za-z0-9·\-]{2,}(?:路|街|巷|弄|大道)|"
    r"[\u4e00-\u9fa5A-Za-z0-9·\-]{2,}(?:社区|小区|村|园|苑|府|城|大厦|广场|中心|公司|工厂|厂))"
)

# 遇到这些描述性词语时，即使没有匹配到截止词，也应避免继续混入诉求描述。
FALLBACK_END_PATTERN = re.compile(r"[，,。；;：:\n\r]|附近|旁边|隔壁|对面|每天|产生|存在|进行|发出|影响|要求|希望|反映")


def resolve_default_path(candidates: Iterable[Path]) -> Path:
    """兼容 data 和 .data 两种目录写法，优先使用实际存在的默认输入文件。"""
    for path in candidates:
        if path.exists():
            return path
    return next(iter(candidates))


def normalize_text(value: object) -> str:
    """把 Excel 中可能的空值、换行和多余空白统一成便于正则处理的文本。"""
    if pd.isna(value):
        return ""
    return re.sub(r"\s+", "", str(value))


def trim_address_candidate(candidate: str) -> str:
    """清理地址片段首尾常见提示词和标点。"""
    candidate = candidate.strip("，,。；;：:（）()[]【】")
    candidate = re.sub(r"^[0-9:：\-.年月日]+", "", candidate)
    candidate = re.sub(r"^(来电反映|市民反映|群众反映|现来电反映|其表示|其是|反映|地址为|位于|在|至)", "", candidate)
    return candidate.strip("，,。；;：:（）()[]【】")


def find_first_stop(candidate: str) -> int | None:
    """返回候选片段中最早截止词的结束位置；多个词同位置时取更长词。"""
    best_start: int | None = None
    best_end: int | None = None
    for pattern in STOP_PATTERNS:
        match = pattern.search(candidate)
        if not match:
            continue
        start = match.start()
        end = match.end()
        if best_start is None or start < best_start or (start == best_start and end > (best_end or 0)):
            best_start = start
            best_end = end
    return best_end


def extract_address(text: object) -> tuple[str, str]:
    """从投诉文本中识别地址，优先截取到第一个地址截止词末尾。"""
    content = normalize_text(text)
    if not content:
        return "", "空文本"

    matches = list(START_PATTERN.finditer(content))
    if not matches:
        return "", "未找到地址起点"

    for match in matches:
        start = match.start()
        candidate = trim_address_candidate(content[start : start + 100])
        stop_end = find_first_stop(candidate)
        if stop_end is not None:
            address = trim_address_candidate(candidate[:stop_end])
            if address:
                return address, "命中截止词"

        fallback_match = FALLBACK_END_PATTERN.search(candidate)
        if fallback_match:
            address = trim_address_candidate(candidate[: fallback_match.start()])
            if address:
                return address, "描述词截断"

    # 所有候选都没有明显截止边界时，取第一个候选的较短片段，避免混入长段诉求。
    address = trim_address_candidate(content[matches[0].start() : matches[0].start() + 40])
    return address, "未命中截止词"


def build_geocode_address(address: str, region: object, use_region: bool) -> str:
    """把问题属地作为上下文拼到地址前，提高百度地理编码命中率。"""
    if not use_region or pd.isna(region):
        return address
    region_text = normalize_text(region)
    if not region_text or address.startswith(region_text) or region_text in address:
        return address
    return f"{region_text}{address}"


def baidu_geocode(address: str, ak: str, timeout: int = 10) -> dict[str, object]:
    """调用百度地图 Geocoding API，把地址转换为经纬度。"""
    if not address:
        return {"status": "SKIPPED", "message": "地址为空"}

    params = urlencode({"address": address, "output": "json", "ak": ak})
    url = f"https://api.map.baidu.com/geocoding/v3/?{params}"
    with urlopen(url, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if payload.get("status") != 0:
        return {
            "status": payload.get("status"),
            "message": payload.get("message", "百度地理编码失败"),
        }

    result = payload.get("result", {})
    location = result.get("location", {})
    return {
        "status": 0,
        "message": "OK",
        "lng": location.get("lng"),
        "lat": location.get("lat"),
        "confidence": result.get("confidence"),
        "comprehension": result.get("comprehension"),
        "level": result.get("level"),
    }


def call_coord_convert_function(func: Any, lng: float, lat: float) -> tuple[float, float]:
    """兼容 coord_convert 中常见的坐标转换函数入参形式。"""
    try:
        result = func(lng, lat)
    except TypeError:
        result = func([lng, lat])

    if isinstance(result, dict):
        return float(result.get("lng") or result.get("lon")), float(result["lat"])
    return float(result[0]), float(result[1])


def bd09_to_wgs84(lng: object, lat: object) -> dict[str, object]:
    """依据 coord_convert.transform 将百度 BD-09 坐标转换为 WGS84 坐标。"""
    if pd.isna(lng) or pd.isna(lat):
        return {"status": "SKIPPED", "message": "百度经纬度为空"}
    if transform is None:
        return {"status": "NO_PACKAGE", "message": "未安装 coord_convert 包"}

    bd_lng = float(lng)
    bd_lat = float(lat)

    # 优先使用直接的 BD-09 -> WGS84 函数；若包只提供分步函数，则先转 GCJ-02 再转 WGS84。
    direct_names = ("bd09_to_wgs84", "bd09towgs84", "bd_to_wgs84", "bd2wgs")
    for name in direct_names:
        func = getattr(transform, name, None)
        if func is None:
            continue
        wgs_lng, wgs_lat = call_coord_convert_function(func, bd_lng, bd_lat)
        return {"status": "OK", "message": name, "lng": wgs_lng, "lat": wgs_lat}

    bd_to_gcj = getattr(transform, "bd09_to_gcj02", None) or getattr(transform, "bd09togcj02", None)
    gcj_to_wgs = getattr(transform, "gcj02_to_wgs84", None) or getattr(transform, "gcj02towgs84", None)
    if bd_to_gcj is None or gcj_to_wgs is None:
        return {"status": "NO_FUNCTION", "message": "coord_convert.transform 中未找到 BD09 到 WGS84 转换函数"}

    gcj_lng, gcj_lat = call_coord_convert_function(bd_to_gcj, bd_lng, bd_lat)
    wgs_lng, wgs_lat = call_coord_convert_function(gcj_to_wgs, gcj_lng, gcj_lat)
    return {"status": "OK", "message": "bd09_to_gcj02 + gcj02_to_wgs84", "lng": wgs_lng, "lat": wgs_lat}


def enrich_file(
    input_path: Path,
    output_path: Path,
    ak: str | None,
    content_column: str,
    region_column: str,
    sleep_seconds: float,
    geocode_with_region: bool,
) -> None:
    """读取原始表，追加地址识别和百度经纬度结果列后导出。"""
    data_df = pd.read_excel(input_path)
    if content_column not in data_df.columns:
        raise ValueError(f"未找到文本列“{content_column}”，现有列：{list(data_df.columns)}")

    result_df = data_df.copy()
    extracted = result_df[content_column].apply(extract_address)
    result_df["识别地址"] = extracted.apply(lambda item: item[0])
    result_df["地址识别状态"] = extracted.apply(lambda item: item[1])

    if ak:
        geocode_rows: list[dict[str, object]] = []
        for _, row in result_df.iterrows():
            query_address = build_geocode_address(
                row["识别地址"],
                row[region_column] if region_column in result_df.columns else "",
                geocode_with_region,
            )
            try:
                geocode_result = baidu_geocode(query_address, ak)
            except Exception as exc:
                geocode_result = {"status": "ERROR", "message": str(exc)}
            geocode_result["query_address"] = query_address
            geocode_rows.append(geocode_result)
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

        geocode_df = pd.DataFrame(geocode_rows)
        result_df["百度地理编码地址"] = geocode_df.get("query_address", "")
        result_df["百度经度"] = geocode_df.get("lng", "")
        result_df["百度纬度"] = geocode_df.get("lat", "")
        result_df["百度置信度"] = geocode_df.get("confidence", "")
        result_df["百度理解度"] = geocode_df.get("comprehension", "")
        result_df["百度地址层级"] = geocode_df.get("level", "")
        result_df["百度地理编码状态"] = geocode_df.get("status", "")
        result_df["百度地理编码消息"] = geocode_df.get("message", "")

        wgs_rows = [
            bd09_to_wgs84(row.get("lng"), row.get("lat"))
            for row in geocode_rows
        ]
        wgs_df = pd.DataFrame(wgs_rows)
        result_df["WGS84经度"] = wgs_df.get("lng", "")
        result_df["WGS84纬度"] = wgs_df.get("lat", "")
        result_df["坐标转换状态"] = wgs_df.get("status", "")
        result_df["坐标转换消息"] = wgs_df.get("message", "")
    else:
        result_df["百度地理编码状态"] = "未调用"
        result_df["百度地理编码消息"] = "未提供百度地图 AK；可通过 --ak 或 BAIDU_MAP_AK 环境变量提供"
        result_df["坐标转换状态"] = "未调用"
        result_df["坐标转换消息"] = "未调用百度地理编码，无法转换坐标"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    result_df.to_excel(output_path, index=False)

    print(f"已完成地址识别：{len(result_df)} 条")
    print(f"输入文件：{input_path}")
    print(f"输出文件：{output_path}")
    print("地址识别状态统计：")
    print(result_df["地址识别状态"].value_counts(dropna=False).to_string())
    print("百度地理编码状态统计：")
    print(result_df["百度地理编码状态"].value_counts(dropna=False).to_string())
    print("坐标转换状态统计：")
    print(result_df["坐标转换状态"].value_counts(dropna=False).to_string())


def parse_args() -> argparse.Namespace:
    default_input_path = resolve_default_path(DEFAULT_INPUT_PATHS)
    default_output_path = default_input_path.with_name(f"{default_input_path.stem}_地址识别结果.xlsx")

    parser = argparse.ArgumentParser(description="从信访诉求内容中识别地址，并调用百度地图 API 获取经纬度")
    parser.add_argument("--input", type=Path, default=default_input_path, help="原始 Excel 路径")
    parser.add_argument("--output", type=Path, default=default_output_path, help="结果输出 Excel 路径")
    parser.add_argument("--content-column", default="诉求内容", help="用于地址识别的文本列名")
    parser.add_argument("--region-column", default="问题属地", help="用于辅助地理编码的属地列名")
    parser.add_argument("--ak", default=os.getenv("BAIDU_MAP_AK"), help="百度地图 AK，也可设置 BAIDU_MAP_AK 环境变量")
    parser.add_argument("--sleep", type=float, default=0.0, help="每次百度 API 请求后的等待秒数，用于控制调用频率")
    parser.add_argument(
        "--no-region-prefix",
        action="store_true",
        help="地理编码时不把问题属地拼到识别地址前",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    enrich_file(
        input_path=args.input,
        output_path=args.output,
        ak=args.ak,
        content_column=args.content_column,
        region_column=args.region_column,
        sleep_seconds=args.sleep,
        geocode_with_region=not args.no_region_prefix,
    )


if __name__ == "__main__":
    main()
