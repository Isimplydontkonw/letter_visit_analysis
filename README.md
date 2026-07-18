# 噪声信访投诉空间布局 WebGIS

本项目用于将噪声信访投诉数据预处理为 GeoJSON/SQLite，并在 OpenLayers + 高德底图中展示投诉点位、类型筛选、批量导入和文本识别定位结果。

## 目录说明

- `webgis/`：静态 WebGIS 页面。
- `webgis/src/`：前端地图、图层、样式和文本识别逻辑。
- `webgis/data/noise_keywords.tsv`：前端文本分类使用的关键词规则。
- `python/classify_noise_petitions.py`：批量噪声类型分类脚本。
- `python/recognize_addresses.py`：地址识别和百度地理编码脚本。
- `python/prepare_webgis_data.py`、`python/xlsx_to_webgis_geojson.py`：Excel 转 WebGIS 数据脚本。
- `tools/setup_portable_python.ps1`：下载并安装项目自带的便携 Python 环境。
- `tools/build_portable.ps1`：生成可分发给同事的便携版压缩包。

## 本地配置

如需使用网页中的“文本分类与地址查询”，复制：

```powershell
Copy-Item webgis\config.local.example.js webgis\config.local.js
```

然后在 `webgis/config.local.js` 中填写自己的百度地图 AK。`config.local.js` 已被 `.gitignore` 忽略，不会提交到 Git。

## 启动本地 WebGIS 服务

批量上传 Excel/CSV 并调用 Python 脚本时，需要先启动本地 API 服务：

```powershell
.\启动WebGIS.bat
```

双击或运行 `启动WebGIS.bat` 后，脚本会自动启动本地服务并打开网页；不要再使用旧的 `启动WebGIS.exe`。

网页批量处理流程：

1. 上传 `.xlsx`、`.xls` 或 `.csv` 文件。
2. 点击“读取列名”。
3. 选择“分类与地址识别文本列”和“辅助属地列”。
4. 点击“批量处理并导出”，下载追加分类、地址识别、百度地理编码和 WGS84 坐标字段后的结果表。

批处理临时文件保存在 `.runtime/`，该目录已被 Git 忽略。批量处理完成后，结果会同时写入 `.runtime/webgis.db`，有效 GCJ-02 点位会立即追加显示到地图中。

百度地理编码请求会串行执行，默认每次 API 请求后等待 0.5 秒，避免触发并发量上限。重启服务后，网页会优先通过 `/api/complaints` 读取 SQLite 中的历史入库点位；GeoJSON 文件仍作为兜底数据源。

## 便携版运行环境

同事电脑没有 Python 时，推荐在你的电脑生成便携运行环境和分发包：

```powershell
powershell -ExecutionPolicy Bypass -File tools\setup_portable_python.ps1
powershell -ExecutionPolicy Bypass -File tools\build_portable.ps1
```

生成结果位于 `dist/WebGISPortable.zip`。同事解压后直接双击 `启动WebGIS.bat`，脚本会优先使用包内的 `runtime/python/python.exe`，不需要另行安装 Python。

`runtime/` 和 `dist/` 均不提交到 Git。如果需要把本机百度 AK 一起打包给可信同事，可运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools\build_portable.ps1 -IncludeLocalConfig
```

如果网络无法自动下载 Python 或 `get-pip.py`，脚本会提示手动下载路径。把文件放到提示的 `runtime/downloads/` 路径后，再重新运行 `tools\setup_portable_python.ps1` 即可。

## 敏感数据

以下文件不会提交到 Git：

- `data/*.xlsx`
- `webgis/data/complaints.geojson`
- `webgis/data/complaints.js`
- `webgis/config.local.js`
- `.runtime/`
- `runtime/`
- `dist/`
- `*.exe`

提交前建议执行：

```powershell
git status --short
git ls-files data webgis/data
```

确认没有原始投诉数据、生成后的点位数据、数据库或本地密钥进入版本库。
