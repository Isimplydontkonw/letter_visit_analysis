# 噪声信访投诉空间布局 WebGIS

本项目用于将噪声信访投诉数据预处理为 GeoJSON，并在 OpenLayers + 高德底图中展示投诉点位、类型筛选和文本识别定位结果。

## 目录说明

- `webgis/`：静态 WebGIS 页面。
- `webgis/src/`：前端地图、图层、样式和文本识别逻辑。
- `webgis/data/noise_keywords.tsv`：前端文本分类使用的关键词规则。
- `python/classify_noise_petitions.py`：批量噪声类型分类脚本。
- `python/recognize_addresses.py`：地址识别和百度地理编码脚本。
- `python/prepare_webgis_data.py`、`python/xlsx_to_webgis_geojson.py`：Excel 转 WebGIS 数据脚本。

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

也可以手动启动服务：

```powershell
python python/webgis_api_server.py
```

网页批量处理流程：

1. 上传 `.xlsx`、`.xls` 或 `.csv` 文件。
2. 点击“读取列名”。
3. 选择“分类与地址识别文本列”和“辅助属地列”。
4. 点击“批量处理并导出”，下载追加分类、地址识别、百度地理编码和 WGS84 坐标字段后的结果表。

批处理临时文件保存在 `.runtime/`，该目录已被 Git 忽略。

百度地理编码请求会串行执行，默认每次 API 请求后等待 0.5 秒，避免触发并发量上限。

## 敏感数据

以下文件不会提交到 Git：

- `data/*.xlsx`
- `webgis/data/complaints.geojson`
- `webgis/data/complaints.js`
- `webgis/config.local.js`
- `*.exe`

提交前建议执行：

```powershell
git status --short
git ls-files data webgis/data
```

确认没有原始投诉数据或生成后的点位数据进入版本库。
