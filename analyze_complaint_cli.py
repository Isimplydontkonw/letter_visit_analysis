from __future__ import annotations

import json
import sys

from webgis_server import WebGisHandler, analyze_text


def main() -> None:
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8-sig") or "{}")
    text = str(payload.get("text", "")).strip()
    region = str(payload.get("region", "浙江省")).strip() or "浙江省"
    if not text:
        write_json({"ok": False, "error": "请输入投诉文本"})
        return

    result = analyze_text(text, region, WebGisHandler.keyword_rules)
    write_json({"ok": True, "result": result})


def write_json(payload: dict) -> None:
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
