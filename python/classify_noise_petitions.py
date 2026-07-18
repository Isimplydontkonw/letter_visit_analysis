from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Iterable

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_KEYWORD_PATHS = (
    PROJECT_ROOT / "data/噪声关键词.xlsx",
    PROJECT_ROOT / ".data/噪声关键词.xlsx",
)
DEFAULT_DATA_PATHS = (
    PROJECT_ROOT / "data/2025年噪声.xlsx",
    PROJECT_ROOT / ".data/2025年噪声.xlsx",
)

# 手动路径配置区：
# 需要直接在 main 中指定文件时，把下面两个变量改成你的绝对路径或相对路径。
# 例如：
# MANUAL_INPUT_PATH = Path(r"D:\\2026年工作\\信访分析WebGIS\\data\\新的噪声投诉切片.xlsx")
# MANUAL_OUTPUT_PATH = Path(r"D:\\2026年工作\\信访分析WebGIS\\data\\新的噪声投诉切片_分类结果.xlsx")
# 保持为 None 时，脚本会使用命令行参数 --input / --output 或默认路径。
MANUAL_INPUT_PATH = None
MANUAL_OUTPUT_PATH = None

# 关键词表中同一个单元格可能混用逗号、顿号、分号和换行，这里统一作为分隔符。
SPLIT_PATTERN = re.compile(r"[,\uFF0C\u3001;；\n\r\t]+")


def resolve_default_path(candidates: Iterable[Path]) -> Path:
    """在 data 和 .data 两种常见目录写法中选择实际存在的默认路径。"""
    for path in candidates:
        if path.exists():
            return path
    return next(iter(candidates))


def find_column(columns: Iterable[str], required_text: str) -> str:
    """按包含关系查找列名，兼容“类型噪声类型”这类带前后缀的表头。"""
    matched = [col for col in columns if required_text in str(col)]
    if not matched:
        raise ValueError(f"未找到包含“{required_text}”的列，现有列：{list(columns)}")
    return matched[0]


def split_keywords(value: object) -> list[str]:
    """拆分并清洗关键词，同一类别内重复出现的关键词只保留一次。"""
    if pd.isna(value):
        return []
    keywords: list[str] = []
    seen: set[str] = set()
    for item in SPLIT_PATTERN.split(str(value)):
        keyword = item.strip().strip("。.!！？?、，,；;：:")
        keyword = re.sub(r"\s+", "", keyword)
        if keyword and keyword not in seen:
            seen.add(keyword)
            keywords.append(keyword)
    return keywords


def load_keyword_rules(keyword_path: Path) -> list[dict[str, object]]:
    """读取关键词规则，保留原表顺序用于后续并列分类时稳定决策。"""
    keyword_df = pd.read_excel(keyword_path)
    type_col = find_column(keyword_df.columns, "类型")
    keyword_col = find_column(keyword_df.columns, "关键词")

    rules: list[dict[str, object]] = []
    for order, row in keyword_df.iterrows():
        noise_type = str(row[type_col]).strip()
        keywords = split_keywords(row[keyword_col])
        if noise_type and noise_type != "nan" and keywords:
            rules.append(
                {
                    "order": order,
                    "type": noise_type,
                    "keywords": keywords,
                }
            )
    if not rules:
        raise ValueError(f"关键词文件未读取到有效规则：{keyword_path}")
    return rules


def classify_text(text: object, rules: list[dict[str, object]]) -> pd.Series:
    """对单条诉求内容分类：按各类型命中的不重复关键词数量打分。"""
    content = "" if pd.isna(text) else str(text)
    details: list[tuple[int, str, list[str]]] = []

    # 逐类统计命中的关键词；keywords 已在读取规则时去重，因此重复文本不会重复计数。
    for rule in rules:
        keywords = [kw for kw in rule["keywords"] if kw in content]
        if keywords:
            details.append((int(rule["order"]), str(rule["type"]), keywords))

    if not details:
        return pd.Series(
            {
                "噪声分类": "未匹配",
                "噪声分类命中关键词": "",
                "噪声分类命中数量": 0,
                "噪声分类并列类型": "",
                "噪声分类全部命中": "",
            }
        )

    # 选择命中关键词数量最多的类型；如果多个类型并列，按关键词表中的先后顺序取第一个。
    max_count = max(len(keywords) for _, _, keywords in details)
    winners = [
        (order, noise_type, keywords)
        for order, noise_type, keywords in details
        if len(keywords) == max_count
    ]
    winners.sort(key=lambda item: item[0])
    selected_order, selected_type, selected_keywords = winners[0]
    tied_types = [noise_type for _, noise_type, _ in winners]

    # 保留全部命中明细，方便后续抽查为什么某条信访被分到某一类。
    all_hits = "; ".join(
        f"{noise_type}({len(keywords)}):{','.join(keywords)}"
        for _, noise_type, keywords in sorted(details, key=lambda item: item[0])
    )
    tied_text = "" if len(tied_types) == 1 else ",".join(tied_types)

    return pd.Series(
        {
            "噪声分类": selected_type,
            "噪声分类命中关键词": ",".join(selected_keywords),
            "噪声分类命中数量": len(selected_keywords),
            "噪声分类并列类型": tied_text,
            "噪声分类全部命中": all_hits,
        }
    )


def classify_file(data_path: Path, keyword_path: Path, output_path: Path) -> None:
    """读取原始信访数据，追加分类结果列，并输出新的 Excel 文件。"""
    rules = load_keyword_rules(keyword_path)
    data_df = pd.read_excel(data_path)
    if "诉求内容" not in data_df.columns:
        raise ValueError(f"原始数据中未找到“诉求内容”列，现有列：{list(data_df.columns)}")

    result_df = data_df.copy()
    result_cols = result_df["诉求内容"].apply(lambda value: classify_text(value, rules))
    for col in result_cols.columns:
        result_df[col] = result_cols[col]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    result_df.to_excel(output_path, index=False)

    summary = result_df["噪声分类"].value_counts(dropna=False)
    print(f"已完成分类：{len(result_df)} 条")
    print(f"关键词文件：{keyword_path}")
    print(f"原始数据：{data_path}")
    print(f"输出文件：{output_path}")
    print("分类统计：")
    print(summary.to_string())


def parse_args() -> argparse.Namespace:
    default_keyword_path = resolve_default_path(DEFAULT_KEYWORD_PATHS)
    default_data_path = resolve_default_path(DEFAULT_DATA_PATHS)
    default_output_path = default_data_path.with_name(
        f"{default_data_path.stem}_噪声分类结果.xlsx"
    )

    parser = argparse.ArgumentParser(description="依据关键词对噪声信访诉求内容进行分类")
    parser.add_argument("--keywords", type=Path, default=default_keyword_path, help="噪声关键词 Excel 路径")
    parser.add_argument("--input", type=Path, default=default_data_path, help="原始噪声信访 Excel 路径")
    parser.add_argument("--output", type=Path, default=default_output_path, help="分类结果输出 Excel 路径")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = MANUAL_INPUT_PATH or args.input
    output_path = MANUAL_OUTPUT_PATH or args.output
    classify_file(input_path, args.keywords, output_path)


if __name__ == "__main__":
    main()
