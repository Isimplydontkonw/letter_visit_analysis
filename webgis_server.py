from __future__ import annotations

import json
import mimetypes
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from classify_noise_petitions import classify_text, load_keyword_rules
from prepare_webgis_data import bd09_to_wgs84_and_gcj02, is_valid_number
from recognize_addresses import baidu_geocode, extract_address


ROOT = Path(__file__).resolve().parent
WEBGIS_DIR = ROOT / "webgis"
KEYWORD_PATH = ROOT / "data" / "噪声关键词.xlsx"
DEFAULT_REGION = "浙江省"
BAIDU_AK = os.getenv("BAIDU_MAP_AK") or "ZqdaxnNveaYhhyiHR4TqcZY3b3ZxpecO"


class WebGisHandler(SimpleHTTPRequestHandler):
    keyword_rules = load_keyword_rules(KEYWORD_PATH)

    def log_message(self, format: str, *args: object) -> None:
        return

    def do_POST(self) -> None:
        if self.path == "/api/analyze":
            self.handle_analyze()
            return
        self.send_error(404, "Not found")

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self.send_json({"ok": True})
            return
        super().do_GET()

    def translate_path(self, path: str) -> str:
        path = unquote(path.split("?", 1)[0].split("#", 1)[0])
        if path == "/":
            return str(WEBGIS_DIR / "index.html")
        safe_parts = [part for part in path.split("/") if part and part not in {".", ".."}]
        return str(WEBGIS_DIR.joinpath(*safe_parts))

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

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

    def handle_analyze(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length)
            try:
                payload = json.loads(raw_body.decode("utf-8-sig") or "{}")
            except UnicodeDecodeError:
                payload = json.loads(raw_body.decode("gbk", errors="ignore") or "{}")
            text = str(payload.get("text", "")).strip()
            region = str(payload.get("region", DEFAULT_REGION)).strip() or DEFAULT_REGION
            if not text:
                self.send_json({"ok": False, "error": "请输入投诉文本"}, status=400)
                return

            result = analyze_text(text, region, self.keyword_rules)
            self.send_json({"ok": True, "result": result})
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=500)

    def send_json(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def analyze_text(text: str, region: str, keyword_rules: list[dict[str, object]]) -> dict[str, object]:
    classify_result = classify_text(text, keyword_rules)
    address, address_status = extract_address(text)
    query_address = build_query_address(region, address)

    try:
        geocode = baidu_geocode(query_address, BAIDU_AK)
    except Exception as exc:
        geocode = {"status": "ERROR", "message": str(exc)}
    response: dict[str, object] = {
        "事项编号": "临时识别",
        "诉求内容": text,
        "问题属地": region,
        "噪声分类": classify_result["噪声分类"],
        "噪声分类命中关键词": classify_result["噪声分类命中关键词"],
        "噪声分类命中数量": int(classify_result["噪声分类命中数量"]),
        "噪声分类全部命中": classify_result["噪声分类全部命中"],
        "识别地址": address,
        "地址识别状态": address_status,
        "百度地理编码地址": query_address,
        "百度地理编码状态": geocode.get("status"),
        "百度地理编码消息": geocode.get("message"),
        "isHighlight": True,
    }

    if geocode.get("status") == 0 and is_valid_number(geocode.get("lng")) and is_valid_number(geocode.get("lat")):
        bd_lng = float(geocode["lng"])
        bd_lat = float(geocode["lat"])
        converted = bd09_to_wgs84_and_gcj02(bd_lng, bd_lat)
        response.update(
            {
                "百度经度": bd_lng,
                "百度纬度": bd_lat,
                **converted,
            }
        )
    else:
        response.update(
            {
                "坐标转换状态": "跳过",
                "坐标转换消息": "百度地理编码未返回有效坐标",
            }
        )

    return response


def build_query_address(region: str, address: str) -> str:
    if not address:
        return region
    if region and region not in address:
        return f"{region}{address}"
    return address


def main() -> None:
    port = int(os.getenv("WEBGIS_PORT", "8020"))
    server = ThreadingHTTPServer(("127.0.0.1", port), WebGisHandler)
    print(f"WebGIS 服务已启动：http://127.0.0.1:{port}/")
    print("文本识别接口：POST /api/analyze")
    server.serve_forever()


if __name__ == "__main__":
    main()
