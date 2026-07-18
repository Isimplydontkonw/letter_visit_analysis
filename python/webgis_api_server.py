from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import uuid
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

import pandas as pd

from classify_noise_petitions import load_keyword_rules, classify_text
from prepare_webgis_data import bd09_to_wgs84_and_gcj02, is_valid_number
from recognize_addresses import (
    baidu_geocode,
    bd09_to_wgs84,
    build_geocode_address,
    extract_address,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEBGIS_DIR = PROJECT_ROOT / "webgis"
KEYWORD_PATH = PROJECT_ROOT / "data" / "噪声关键词.xlsx"
RUNTIME_DIR = PROJECT_ROOT / ".runtime" / "batch"
UPLOADS: dict[str, dict[str, object]] = {}



def parse_multipart_file(headers, body: bytes) -> tuple[str, bytes]:
    """解析浏览器上传的单文件 multipart/form-data 请求。"""
    content_type = headers.get("Content-Type", "")
    match = re.search(r"boundary=(.+)$", content_type)
    if not match:
        raise ValueError("上传请求缺少 multipart boundary")

    boundary = match.group(1).strip().strip('"').encode("utf-8")
    marker = b"--" + boundary
    for part in body.split(marker):
        part = part.strip(b"\r\n")
        if not part or part == b"--" or b"\r\n\r\n" not in part:
            continue

        raw_headers, file_bytes = part.split(b"\r\n\r\n", 1)
        header_text = raw_headers.decode("utf-8", errors="ignore")
        if 'name="file"' not in header_text:
            continue
        filename_match = re.search(r'filename="([^"]*)"', header_text)
        filename = filename_match.group(1) if filename_match else ""
        if file_bytes.endswith(b"\r\n"):
            file_bytes = file_bytes[:-2]
        return filename, file_bytes

    raise ValueError("未找到上传文件字段 file")

def read_table(path: Path) -> pd.DataFrame:
    """读取用户上传的 Excel 或 CSV 文件，保留原始列名。"""
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    if suffix == ".csv":
        for encoding in ("utf-8-sig", "gbk", "utf-8"):
            try:
                return pd.read_csv(path, encoding=encoding)
            except UnicodeDecodeError:
                continue
        return pd.read_csv(path)
    raise ValueError("仅支持 .xlsx、.xls、.csv 文件")


def write_table(df: pd.DataFrame, path: Path) -> None:
    """按输出扩展名写出结果文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".csv":
        df.to_csv(path, index=False, encoding="utf-8-sig")
    else:
        df.to_excel(path, index=False)


def find_baidu_ak() -> str | None:
    """优先读取环境变量，其次尝试读取本地 config.local.js。"""
    env_ak = os.getenv("BAIDU_MAP_AK")
    if env_ak:
        return env_ak.strip()

    config_path = WEBGIS_DIR / "config.local.js"
    if not config_path.exists():
        return None
    match = re.search(r"BAIDU_MAP_AK\s*:\s*['\"]([^'\"]+)['\"]", config_path.read_text(encoding="utf-8", errors="ignore"))
    return match.group(1).strip() if match else None


def classify_dataframe(df: pd.DataFrame, content_column: str) -> pd.DataFrame:
    """复用 classify_noise_petitions.py 的规则函数，对指定文本列批量分类。"""
    if content_column not in df.columns:
        raise ValueError(f"未找到分类文本列：{content_column}")
    if not KEYWORD_PATH.exists():
        raise ValueError(f"未找到关键词文件：{KEYWORD_PATH}")

    rules = load_keyword_rules(KEYWORD_PATH)
    result_df = df.copy()
    result_cols = result_df[content_column].apply(lambda value: classify_text(value, rules))
    for column in result_cols.columns:
        result_df[column] = result_cols[column]
    return result_df


def recognize_dataframe(df: pd.DataFrame, content_column: str, region_column: str, sleep_seconds: float = 0.0) -> pd.DataFrame:
    """复用 recognize_addresses.py 的地址抽取、百度地理编码与坐标转换函数。"""
    if content_column not in df.columns:
        raise ValueError(f"未找到地址识别文本列：{content_column}")

    result_df = df.copy()
    extracted = result_df[content_column].apply(extract_address)
    result_df["识别地址"] = extracted.apply(lambda item: item[0])
    result_df["地址识别状态"] = extracted.apply(lambda item: item[1])

    ak = find_baidu_ak()
    if not ak:
        result_df["百度地理编码状态"] = "未调用"
        result_df["百度地理编码消息"] = "未配置百度地图 AK；请设置 BAIDU_MAP_AK 或 webgis/config.local.js"
        result_df["坐标转换状态"] = "未调用"
        result_df["坐标转换消息"] = "未调用百度地理编码，无法转换坐标"
        return result_df

    geocode_rows: list[dict[str, object]] = []
    for _, row in result_df.iterrows():
        region = row[region_column] if region_column and region_column in result_df.columns else ""
        query_address = build_geocode_address(row["识别地址"], region, True)
        try:
            geocode_result = baidu_geocode(query_address, ak)
        except Exception as exc:
            geocode_result = {"status": "ERROR", "message": str(exc)}
        geocode_result["query_address"] = query_address
        geocode_rows.append(geocode_result)
        if sleep_seconds > 0:
            import time

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

    wgs_rows = [bd09_to_wgs84(row.get("lng"), row.get("lat")) for row in geocode_rows]
    wgs_df = pd.DataFrame(wgs_rows)
    result_df["WGS84经度"] = wgs_df.get("lng", "")
    result_df["WGS84纬度"] = wgs_df.get("lat", "")
    result_df["坐标转换状态"] = wgs_df.get("status", "")
    result_df["坐标转换消息"] = wgs_df.get("message", "")
    return result_df



def analyze_single_text(text: str, region: str) -> dict[str, object]:
    """复用批处理逻辑，对网页单条文本执行分类、地址识别和地理编码。"""
    df = pd.DataFrame([{"事项编号": "临时识别", "诉求内容": text, "问题属地": region}])
    classified = classify_dataframe(df, "诉求内容")
    enriched = recognize_dataframe(classified, "诉求内容", "问题属地")
    result = enriched.iloc[0].to_dict()
    if is_valid_number(result.get("百度经度")) and is_valid_number(result.get("百度纬度")):
        converted = bd09_to_wgs84_and_gcj02(float(result["百度经度"]), float(result["百度纬度"]))
        result.update(converted)
    result["isHighlight"] = True
    return {key: ("" if pd.isna(value) else value) for key, value in result.items()}

def summarize_result(df: pd.DataFrame) -> dict[str, object]:
    """返回前端展示用的简要统计。"""
    summary: dict[str, object] = {"rows": int(len(df))}
    if "噪声分类" in df.columns:
        summary["classification"] = df["噪声分类"].value_counts(dropna=False).to_dict()
    if "地址识别状态" in df.columns:
        summary["address"] = df["地址识别状态"].value_counts(dropna=False).to_dict()
    if "百度地理编码状态" in df.columns:
        summary["geocode"] = df["百度地理编码状态"].value_counts(dropna=False).to_dict()
    return summary


class WebGisApiHandler(SimpleHTTPRequestHandler):
    server_version = "WebGISBatchServer/1.0"

    def log_message(self, format: str, *args: object) -> None:
        return

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json({"ok": True})
            return
        if parsed.path == "/api/download":
            self.handle_download(parsed.query)
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/analyze":
                self.handle_analyze()
                return
            if parsed.path == "/api/batch/preview":
                self.handle_batch_preview()
                return
            if parsed.path == "/api/batch/process":
                self.handle_batch_process()
                return
            self.send_json({"ok": False, "error": "接口不存在"}, status=404)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=500)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def translate_path(self, path: str) -> str:
        path = unquote(urlparse(path).path)
        if path == "/":
            return str(WEBGIS_DIR / "index.html")
        safe_parts = [part for part in path.split("/") if part and part not in {".", ".."}]
        return str(WEBGIS_DIR.joinpath(*safe_parts))

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def guess_type(self, path: str) -> str:
        if path.endswith(".geojson"):
            return "application/geo+json; charset=utf-8"
        if path.endswith(".js"):
            return "text/javascript; charset=utf-8"
        if path.endswith(".css"):
            return "text/css; charset=utf-8"
        if path.endswith(".html"):
            return "text/html; charset=utf-8"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"

    def read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

    def handle_analyze(self) -> None:
        payload = self.read_json()
        text = str(payload.get("text", "")).strip()
        region = str(payload.get("region", "浙江省")).strip() or "浙江省"
        if not text:
            self.send_json({"ok": False, "error": "请输入投诉文本"}, status=400)
            return
        self.send_json({"ok": True, "result": analyze_single_text(text, region)})
    def handle_batch_preview(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        filename, file_bytes = parse_multipart_file(self.headers, self.rfile.read(length))
        if not filename:
            self.send_json({"ok": False, "error": "请上传 Excel 或 CSV 文件"}, status=400)
            return

        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        upload_id = uuid.uuid4().hex
        suffix = Path(filename).suffix.lower()
        if suffix not in {".xlsx", ".xls", ".csv"}:
            self.send_json({"ok": False, "error": "仅支持 .xlsx、.xls、.csv 文件"}, status=400)
            return

        input_path = RUNTIME_DIR / f"{upload_id}{suffix}"
        with input_path.open("wb") as output:
            output.write(file_bytes)

        df = read_table(input_path)
        UPLOADS[upload_id] = {"path": input_path, "filename": filename}
        self.send_json(
            {
                "ok": True,
                "uploadId": upload_id,
                "filename": filename,
                "columns": [str(column) for column in df.columns],
                "rows": int(len(df)),
            }
        )

    def handle_batch_process(self) -> None:
        payload = self.read_json()
        upload_id = str(payload.get("uploadId", ""))
        content_column = str(payload.get("contentColumn", "")).strip()
        region_column = str(payload.get("regionColumn", "")).strip()
        if upload_id not in UPLOADS:
            self.send_json({"ok": False, "error": "上传文件已失效，请重新选择文件"}, status=400)
            return
        if not content_column:
            self.send_json({"ok": False, "error": "请选择分类和地址识别文本列"}, status=400)
            return

        input_path = Path(UPLOADS[upload_id]["path"])
        df = read_table(input_path)
        classified = classify_dataframe(df, content_column)
        enriched = recognize_dataframe(classified, content_column, region_column)

        output_id = uuid.uuid4().hex
        output_path = RUNTIME_DIR / f"{output_id}_噪声信访批处理结果.xlsx"
        write_table(enriched, output_path)
        UPLOADS[output_id] = {"path": output_path, "filename": output_path.name}

        self.send_json(
            {
                "ok": True,
                "downloadUrl": f"/api/download?id={output_id}",
                "filename": output_path.name,
                "summary": summarize_result(enriched),
            }
        )

    def handle_download(self, query: str) -> None:
        output_id = parse_qs(query).get("id", [""])[0]
        if output_id not in UPLOADS:
            self.send_error(404, "File not found")
            return
        path = Path(UPLOADS[output_id]["path"])
        if not path.exists():
            self.send_error(404, "File not found")
            return

        data = path.read_bytes()
        filename = str(UPLOADS[output_id].get("filename") or path.name)
        encoded_filename = quote(filename.encode("utf-8"))
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{encoded_filename}")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload: dict[str, object], status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def find_available_port(start: int, end: int) -> int:
    import socket

    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"未找到可用端口：{start}-{end}")


def main() -> None:
    parser = argparse.ArgumentParser(description="启动 WebGIS 本地 API 服务")
    parser.add_argument("--port", type=int, default=8020, help="服务端口")
    parser.add_argument("--no-open", action="store_true", help="启动后不自动打开浏览器")
    args = parser.parse_args()

    port = args.port
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), WebGisApiHandler)
    except OSError:
        port = find_available_port(8021, 8099)
        server = ThreadingHTTPServer(("127.0.0.1", port), WebGisApiHandler)

    url = f"http://127.0.0.1:{port}/"
    print(f"WebGIS 本地服务已启动：{url}")
    print("批量处理接口：POST /api/batch/preview, POST /api/batch/process")
    if not args.no_open:
        webbrowser.open(url)
    server.serve_forever()


if __name__ == "__main__":
    main()
