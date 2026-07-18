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
