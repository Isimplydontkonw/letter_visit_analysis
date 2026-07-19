# 项目状态说明

更新时间：2026-07-19  
项目目录：`D:\2026年工作\信访分析WebGIS`

## 1. 已完成内容

- 已完成噪声信访 WebGIS 本地应用主体：OpenLayers 地图、高德矢量/影像底图切换、点位展示、类型筛选、统计和详情弹窗。
- 已完成噪声投诉文本分类：依据关键词规则对 `诉求内容` 分类，支持命中关键词、命中数量和全部命中明细输出。
- 已完成地址识别和百度地理编码：从投诉文本中抽取地址，调用百度地图 Geocoding API，支持 BD-09 转 WGS84/GCJ-02。
- 已完成百度 API 请求节流：地理编码串行执行，默认每次请求后等待 0.5 秒，降低触发并发上限风险。
- 已完成批量导入处理：网页可上传 `.xlsx`、`.xls`、`.csv`，读取列名，选择文本列和属地列，批量分类、地址识别、地理编码并导出 xlsx。
- 已完成 SQLite 本地入库：批量处理结果写入 `.runtime/webgis.db`，有效 GCJ-02 点位会立即追加显示到地图。
- 已完成数据库点位接口：`/api/complaints` 从 SQLite 返回有效点位 GeoJSON，网页启动时优先读取数据库点位，GeoJSON 文件作为兜底数据源。
- 已完成单条文本识别定位：网页输入投诉文本后可分类、抽取地址、地理编码，并将结果高亮显示在地图上。
- 已完成一键启动脚本：`启动WebGIS.bat` 会启动本地 Python API 服务并打开网页。
- 已完成便携版运行环境方案：`tools/setup_portable_python.ps1` 和 `tools/build_portable.ps1` 可生成 `dist/WebGISPortable.zip`，供无 Python 环境的同事使用。
- 已完成敏感数据保护：原始 Excel、生成 GeoJSON/JS、SQLite 数据库、本地 AK 配置、运行环境和分发包均已加入 Git 忽略规则。

## 2. 当前代码结构

```text
信访分析WebGIS/
├─ README.md                         # 项目说明和运行说明
├─ PROJECT_STATUS.md                 # 当前项目状态说明
├─ requirements.txt                  # Python 依赖
├─ 启动WebGIS.bat                    # 一键启动本地 WebGIS 服务
├─ python/
│  ├─ webgis_api_server.py           # 本地 HTTP API 服务、批量处理、SQLite 入库、下载接口
│  ├─ classify_noise_petitions.py    # 噪声信访关键词分类脚本
│  ├─ recognize_addresses.py         # 地址识别、百度地理编码、BD-09 转 WGS84
│  ├─ prepare_webgis_data.py         # 原始 Excel 预处理为 WebGIS 数据
│  └─ xlsx_to_webgis_geojson.py      # 整理后 Excel 转 GeoJSON/JS
├─ webgis/
│  ├─ index.html                     # WebGIS 页面入口
│  ├─ styles.css                     # 页面样式
│  ├─ config.local.example.js        # 百度 AK 本地配置示例，不填写真实 AK
│  ├─ data/
│  │  └─ noise_keywords.tsv          # 前端文本分类关键词规则
│  ├─ src/
│  │  ├─ boot.js                     # OpenLayers 加载与应用启动
│  │  ├─ main.js                     # 地图主流程、筛选、文本识别、批量处理上图
│  │  ├─ data.js                     # GeoJSON/SQLite 点位加载与坐标转换
│  │  ├─ layers.js                   # 高德底图和点位图层
│  │  ├─ styles.js                   # 点位样式
│  │  ├─ ui.js                       # 侧边栏、统计、结果渲染
│  │  ├─ batch_api.js                # 批量上传和处理 API 调用
│  │  └─ client_analyzer.js          # 浏览器端文本识别兜底逻辑
│  └─ vendor/ol/README.txt           # OpenLayers 本地资源说明
├─ tools/
│  ├─ setup_portable_python.ps1      # 下载/安装便携 Python 环境
│  └─ build_portable.ps1             # 生成便携版压缩包
├─ data/                             # 本地敏感数据目录，Git 忽略
├─ .runtime/                         # 批处理临时文件和 SQLite 数据库，Git 忽略
├─ runtime/                          # 便携 Python 运行环境，Git 忽略
└─ dist/                             # 便携分发包输出目录，Git 忽略
```

## 3. 数据格式

### 3.1 输入数据

- 支持上传 `.xlsx`、`.xls`、`.csv`。
- 批量处理时网页会读取列名，由用户选择：
  - 分类和地址识别文本列，通常为 `诉求内容`。
  - 辅助属地列，通常为 `问题属地`，可为空。
- 原始数据中常见字段包括：
  - `事项编号`
  - `诉求内容`
  - `问题属地`
  - `登记时间`
  - `经度` / `纬度`，如已有 WGS84 坐标时可用于转换和展示。

### 3.2 批量处理输出 xlsx 字段

处理后会保留原始列，并追加或更新以下字段：

- 分类字段：`噪声分类`、`噪声分类命中关键词`、`噪声分类命中数量`、`噪声分类并列类型`、`噪声分类全部命中`
- 地址字段：`识别地址`、`地址识别状态`
- 百度地理编码字段：`百度地理编码地址`、`百度经度`、`百度纬度`、`百度置信度`、`百度理解度`、`百度地址层级`、`百度地理编码状态`、`百度地理编码消息`
- 坐标字段：`WGS84经度`、`WGS84纬度`、`GCJ02经度`、`GCJ02纬度`、`坐标转换状态`、`坐标转换消息`

### 3.3 SQLite 数据库

默认数据库路径：`.runtime/webgis.db`。  
当前表：`complaints`。

主要字段：

- 主键：`id`
- 批次字段：`batch_id`、`source_filename`、`created_at`
- 原始字段：`matter_id`、`content`、`region`、`register_time`
- 处理字段：`noise_type`、`hit_keywords`、`address`、`address_status`
- 地理编码字段：`geocode_address`、`geocode_status`、`geocode_message`
- 坐标字段：`wgs84_lng`、`wgs84_lat`、`gcj02_lng`、`gcj02_lat`、`convert_status`
- 扩展字段：`raw_json`，保存上传表中未标准化的其他字段

### 3.4 GeoJSON / 地图点位

- 旧数据源：`webgis/data/complaints.geojson` 和 `webgis/data/complaints.js`，目前作为兜底数据源。
- 新数据源：`/api/complaints`，从 SQLite 读取有效 GCJ-02 点位并返回 GeoJSON。
- 前端地图显示坐标使用 GCJ-02，以匹配高德底图。
- 数据库存储同时保留 WGS84 和 GCJ-02。
- 无有效 GCJ-02 坐标的记录会写入 xlsx 和 SQLite，但不会显示在地图上。

## 4. 下一步任务

- 增加数据库管理界面：查看已导入批次、按批次筛选、删除测试批次或误导入批次。
- 增加去重策略：根据 `事项编号` 或 `诉求内容 + 识别地址 + 登记时间` 判断重复导入，避免同一文件多次导入造成重复点位。
- 增加批量处理进度条：当前大文件处理时用户只能等待，后续可显示已处理条数、剩余条数、地理编码状态。
- 增加错误明细下载：将百度地理编码失败、地址识别失败、坐标转换失败的记录单独导出，便于人工修正。
- 增加数据库备份/恢复功能：支持把 `.runtime/webgis.db` 导出备份，或从备份恢复。
- 增加字段映射配置保存：记住上次选择的文本列、属地列，减少重复操作。
- 增加地图数据刷新按钮：支持从 SQLite 重新加载全部点位，而不必重启服务。
- 优化地址识别规则：对“附近、路口、工地、小区名缺失”等场景增加更细的解析和人工校正入口。
- 可选升级 PostgreSQL/PostGIS：如果后续多人共享、局域网访问或接 GeoServer，再迁移 SQLite 表结构。

## 5. 已知问题

- 百度地图 API 有并发和配额限制，虽然已串行请求并设置 0.5 秒间隔，但大批量导入仍可能触发日配额、并发量或 AK 权限限制。
- 批量导入当前没有去重机制，同一文件重复处理会作为新批次再次写入数据库并显示重复点位。
- `.runtime/webgis.db` 是本机本地数据库，不适合多人同时协作编辑；多人共享需要迁移到数据库服务。
- 当前没有批次删除界面，如需删除误导入数据，需要手动操作 SQLite 或后续增加管理接口。
- 当前批量处理是同步请求，大文件处理时间较长时网页会等待较久，浏览器可能显示请求仍在进行。
- 地址识别是规则型方法，面对文本不规范、地址描述过短或地名歧义时，可能识别不到地址或地理编码偏移。
- 如果 `webgis/config.local.js` 未配置百度 AK，地理编码不会调用，输出会保留“未调用”状态。
- 如果直接双击 `webgis/index.html`，批量处理、SQLite 入库和 `/api/complaints` 不可用；必须通过 `启动WebGIS.bat` 启动本地服务。
- 便携版需要提前构建 `runtime/` 和 `dist/`，且这些目录不会进入 Git。
- Git 在 Codex 沙箱用户下可能提示 `safe.directory`，这是用户/沙箱账户不同导致的安全提示，不影响普通用户本机 Git 使用。
