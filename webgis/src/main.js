import { INITIAL_CENTER, INITIAL_ZOOM, MAX_ZOOM, MIN_ZOOM } from "./config.js?v=20260719-refactor3";
import { analyzeComplaintText } from "./client_analyzer.js?v=20260719-refactor3";
import { previewBatchFile, processBatchFile } from "./batch_api.js?v=20260719-refactor3";
import { deleteImportBatch, getFeatureType, loadComplaintFeatures, loadImportBatches, loadLocationComplaints } from "./data.js?v=20260719-refactor3";
import { createComplaintLayer, createGaodeBasemapLayers, setGaodeBasemapMode } from "./layers.js?v=20260719-refactor3";
import { createComplaintStyle } from "./styles.js?v=20260719-refactor3";
import {
  createTypeOrder,
  getElements,
  renderAnalysisResult,
  renderBatchColumns,
  renderBatchList,
  renderBatchResult,
  renderDetails,
  renderFilters,
  renderStats,
} from "./ui.js?v=20260719-refactor3";

// WebGIS 主控制器：创建地图、维护前端状态、绑定页面交互。
export async function startWebGis({ setStatus }) {
  const elements = getElements();
  const vectorSource = new ol.source.Vector();

  // 这些状态只存在于浏览器内存中；真实导入数据以 SQLite 为准。
  let allFeatures = [];
  let activeTypes = new Set();
  let selectedFeature = null;
  let typeOrder = [];
  let currentBasemap = "vector";
  let highlightedFeature = null;
  let currentBatchUploadId = null;

  const complaintLayer = createComplaintLayer(vectorSource, (feature) => (
    createComplaintStyle(feature, selectedFeature, typeOrder)
  ));
  const basemapLayers = createGaodeBasemapLayers();

  // OpenLayers 地图使用 EPSG:3857，业务坐标在 data.js 中由经纬度读入时转换。
  const map = new ol.Map({
    target: "map",
    layers: [
      ...basemapLayers.vector,
      ...basemapLayers.satellite,
      complaintLayer,
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat(INITIAL_CENTER),
      zoom: INITIAL_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    }),
    controls: createDefaultControls(),
  });

  const popupOverlay = new ol.Overlay({
    element: elements.popup,
    positioning: "bottom-center",
    stopEvent: true,
    offset: [0, -14],
  });
  map.addOverlay(popupOverlay);

  // 根据筛选勾选状态返回当前应该显示的点位。
  function getVisibleFeatures() {
    return allFeatures.filter((feature) => activeTypes.has(getFeatureType(feature)));
  }

  // 将视图缩放到当前矢量源范围；没有点位时保持现状。
  function fitToVisibleFeatures() {
    const visibleFeatures = vectorSource.getFeatures();
    if (!visibleFeatures.length) {
      return;
    }
    map.getView().fit(vectorSource.getExtent(), {
      padding: [80, 80, 80, 80],
      duration: 300,
      maxZoom: 15,
    });
  }

  // 重新绘制点位图层和侧栏统计，是筛选、刷新、导入后的公共收口。
  function refreshVisibleFeatures({ shouldFit = false } = {}) {
    const visibleFeatures = getVisibleFeatures();
    vectorSource.clear();
    vectorSource.addFeatures(visibleFeatures);
    elements.totalCount.textContent = allFeatures.length;
    elements.visibleCount.textContent = visibleFeatures.length;
    renderStats(elements, visibleFeatures, typeOrder);

    if (selectedFeature && !visibleFeatures.includes(selectedFeature)) {
      selectedFeature = null;
      renderDetails(elements, null);
      popupOverlay.setPosition(undefined);
    }

    complaintLayer.changed();
    if (shouldFit) {
      fitToVisibleFeatures();
    }
  }

  // 恢复全部噪声类型勾选。
  function resetFilters() {
    activeTypes = new Set(typeOrder);
    renderFilters(elements, allFeatures, activeTypes, typeOrder, () => refreshVisibleFeatures());
    refreshVisibleFeatures({ shouldFit: true });
  }

  // 从后端重新读取完整点位，避免批量导入后前端状态和数据库不一致。
  async function reloadComplaintData({ shouldFit = false } = {}) {
    allFeatures = await loadComplaintFeatures();
    typeOrder = createTypeOrder(allFeatures);
    activeTypes = new Set(typeOrder);
    selectedFeature = null;
    renderFilters(elements, allFeatures, activeTypes, typeOrder, () => refreshVisibleFeatures());
    renderDetails(elements, null);
    popupOverlay.setPosition(undefined);
    refreshVisibleFeatures({ shouldFit });
  }

  // 数据管理面板的批次列表；服务不可用时不影响地图主体初始化。
  async function refreshBatchList() {
    if (!elements.batchList || !elements.undoLastBatchButton) {
      return [];
    }
    try {
      const batches = await loadImportBatches();
      renderBatchList(elements, batches, deleteBatchById);
      elements.undoLastBatchButton.disabled = !batches.length;
      return batches;
    } catch (error) {
      elements.batchList.innerHTML = `<div class="batch-empty">${error.message || "批次列表加载失败"}</div>`;
      elements.undoLastBatchButton.disabled = true;
      return [];
    }
  }

  // 撤销一个导入批次，本质是删除 SQLite 中该 batch_id 的记录。
  async function deleteBatchById(batchId) {
    if (!batchId) {
      return;
    }
    if (!window.confirm("确定撤销这个导入批次吗？该批次写入数据库的记录会从地图中移除。")) {
      return;
    }
    setStatus("正在撤销导入批次...");
    try {
      const result = await deleteImportBatch(batchId);
      await reloadComplaintData({ shouldFit: true });
      await refreshBatchList();
      setStatus(`已撤销导入批次，删除 ${result.deletedCount ?? 0} 条记录。`);
    } catch (error) {
      setStatus(`撤销失败：${error.message}`, true);
    }
  }

  // “撤销最新导入”默认取批次列表第一条，后端按创建时间倒序返回。
  async function deleteLatestBatch() {
    const batches = await refreshBatchList();
    if (!batches.length) {
      setStatus("当前没有可撤销的导入批次。", true);
      return;
    }
    await deleteBatchById(batches[0].batchId);
  }

  // 点选地图点位后，先显示聚合点概要，再按地点键拉取原始投诉明细。
  async function selectFeature(feature) {
    selectedFeature = feature || null;
    if (!selectedFeature) {
      renderDetails(elements, null);
      popupOverlay.setPosition(undefined);
      complaintLayer.changed();
      return;
    }

    const locationKey = selectedFeature.get("地点键");
    renderDetails(elements, selectedFeature, { loading: Boolean(locationKey) });
    popupOverlay.setPosition(selectedFeature ? selectedFeature.getGeometry().getCoordinates() : undefined);
    complaintLayer.changed();
    if (!locationKey) {
      return;
    }

    try {
      const detailPayload = await loadLocationComplaints(locationKey);
      if (selectedFeature === feature) {
        renderDetails(elements, selectedFeature, detailPayload);
      }
    } catch (error) {
      if (selectedFeature === feature) {
        renderDetails(elements, selectedFeature, { error: error.message || "投诉明细加载失败" });
      }
    }
  }

  // 单条文本识别得到临时结果时，在地图上插入一个黄色高亮点。
  function addHighlightedResult(result) {
    if (!Number.isFinite(Number(result["GCJ02经度"])) || !Number.isFinite(Number(result["GCJ02纬度"]))) {
      setStatus("已完成分类和地址识别，但没有获得有效经纬度，无法在地图上高亮定位。", true);
      return;
    }

    if (highlightedFeature) {
      allFeatures = allFeatures.filter((feature) => feature !== highlightedFeature);
      vectorSource.removeFeature(highlightedFeature);
    }

    highlightedFeature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat([Number(result["GCJ02经度"]), Number(result["GCJ02纬度"])])),
      ...result,
      isHighlight: true,
    });

    const resultType = getFeatureType(highlightedFeature);
    allFeatures = [highlightedFeature, ...allFeatures];
    if (!typeOrder.includes(resultType)) {
      typeOrder = [resultType, ...typeOrder];
    }
    activeTypes.add(resultType);
    renderFilters(elements, allFeatures, activeTypes, typeOrder, () => refreshVisibleFeatures());
    refreshVisibleFeatures();
    selectFeature(highlightedFeature);
    map.getView().animate({
      center: highlightedFeature.getGeometry().getCoordinates(),
      zoom: Math.max(map.getView().getZoom() || INITIAL_ZOOM, 15),
      duration: 350,
    });
    setStatus("已将识别结果高亮显示在地图中。");
  }


  async function analyzeInputText(event) {
    event.preventDefault();
    const text = elements.complaintText.value.trim();
    const region = elements.regionInput.value.trim() || "浙江省";
    if (!text) {
      renderAnalysisResult(elements, "请输入投诉文本。", true);
      return;
    }

    elements.analyzeButton.disabled = true;
    elements.analyzeButton.textContent = "识别中...";
    renderAnalysisResult(elements, "正在调用本地 Python 脚本识别...", false);
    setStatus("正在调用 python/classify_noise_petitions.py 和 python/recognize_addresses.py...");

    try {
      const result = await analyzeComplaintText(text, region);
      renderAnalysisResult(elements, result);
      addHighlightedResult(result);
    } catch (error) {
      renderAnalysisResult(elements, error.message || "识别失败", true);
      setStatus(`文本识别失败：${error.message}`, true);
    } finally {
      elements.analyzeButton.disabled = false;
      elements.analyzeButton.textContent = "识别并定位";
    }
  }

  // 第一步上传文件只读取列名，真正批处理要等用户选择文本列/属地列。
  async function previewBatchInputFile() {
    const file = elements.batchFileInput.files?.[0];
    if (!file) {
      renderBatchResult(elements, "请先选择 Excel 或 CSV 文件。", true);
      return;
    }

    elements.batchPreviewButton.disabled = true;
    elements.batchPreviewButton.textContent = "读取中...";
    elements.batchProcessButton.disabled = true;
    renderBatchResult(elements, "正在读取文件列名...", false);
    setStatus("正在上传文件并读取列名...");

    try {
      const preview = await previewBatchFile(file);
      currentBatchUploadId = preview.uploadId;
      renderBatchColumns(elements, preview.columns || []);
      renderBatchResult(elements, `已读取 ${preview.filename}，共 ${preview.rows} 行。请选择文本列和属地列。`, false);
      setStatus(`已读取批处理文件列名：${preview.columns.length} 列。`);
    } catch (error) {
      currentBatchUploadId = null;
      renderBatchResult(elements, error.message || "读取列名失败", true);
      setStatus(`批处理列名读取失败：${error.message}`, true);
    } finally {
      elements.batchPreviewButton.disabled = false;
      elements.batchPreviewButton.textContent = "读取列名";
    }
  }

  // 批处理完成后重新读取数据库点位，确保地图展示的是已入库结果。
  async function processBatchInputFile(event) {
    event.preventDefault();
    if (!currentBatchUploadId) {
      renderBatchResult(elements, "请先读取文件列名。", true);
      return;
    }

    const contentColumn = elements.batchContentColumn.value;
    const regionColumn = elements.batchRegionColumn.value;
    if (!contentColumn) {
      renderBatchResult(elements, "请选择分类和地址识别文本列。", true);
      return;
    }

    elements.batchProcessButton.disabled = true;
    elements.batchProcessButton.textContent = "处理中...";
    renderBatchResult(elements, "正在调用 python/classify_noise_petitions.py 和 python/recognize_addresses.py 批量处理...", false);
    setStatus("正在批量分类、地址识别和地理编码...");

    try {
      const result = await processBatchFile({ uploadId: currentBatchUploadId, contentColumn, regionColumn });
      renderBatchResult(elements, result);
      await reloadComplaintData({ shouldFit: true });
      await refreshBatchList();
      setStatus(`批量处理完成：${result.filename}；已入库 ${result.insertedCount ?? 0} 条，当前上图 ${allFeatures.length} 个投诉地点。`);
    } catch (error) {
      renderBatchResult(elements, error.message || "批量处理失败", true);
      setStatus(`批量处理失败：${error.message}`, true);
    } finally {
      elements.batchProcessButton.disabled = false;
      elements.batchProcessButton.textContent = "批量处理并导出";
    }
  }

  // 地图本身的点击和悬停交互，只作用于投诉点位图层。
  map.on("singleclick", (event) => {
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { hitTolerance: 6 });
    selectFeature(feature);
  });

  map.on("pointermove", (event) => {
    const hit = map.hasFeatureAtPixel(event.pixel, { hitTolerance: 6 });
    map.getTargetElement().style.cursor = hit ? "pointer" : "";
  });

  // 统一的容错事件绑定：旧 HTML 缓存缺少某个按钮时，也不阻断地图初始化。
  function on(element, eventName, handler) {
    if (element) {
      element.addEventListener(eventName, handler);
    }
  }

  on(elements.zoomInButton, "click", () => {
    const view = map.getView();
    view.animate({ zoom: Math.min((view.getZoom() || INITIAL_ZOOM) + 1, MAX_ZOOM), duration: 180 });
  });
  on(elements.zoomOutButton, "click", () => {
    const view = map.getView();
    view.animate({ zoom: Math.max((view.getZoom() || INITIAL_ZOOM) - 1, MIN_ZOOM), duration: 180 });
  });
  on(elements.fitButton, "click", fitToVisibleFeatures);
  on(elements.resetButton, "click", resetFilters);
  on(elements.refreshMapButton, "click", async () => {
    setStatus("正在从数据库刷新地图点位...");
    try {
      await reloadComplaintData({ shouldFit: true });
      await refreshBatchList();
      setStatus(`已刷新地图，共加载 ${allFeatures.length} 个投诉地点。`);
    } catch (error) {
      setStatus(`地图刷新失败：${error.message}`, true);
    }
  });
  on(elements.undoLastBatchButton, "click", deleteLatestBatch);
  on(elements.analyzeForm, "submit", analyzeInputText);
  on(elements.batchPreviewButton, "click", previewBatchInputFile);
  on(elements.batchForm, "submit", processBatchInputFile);
  on(elements.batchFileInput, "change", () => {
    currentBatchUploadId = null;
    if (elements.batchProcessButton) {
      elements.batchProcessButton.disabled = true;
    }
    renderBatchResult(elements, "文件已选择，请点击读取列名。", false);
  });
  on(elements.vectorBasemapButton, "click", () => switchBasemap("vector"));
  on(elements.satelliteBasemapButton, "click", () => switchBasemap("satellite"));

  function switchBasemap(mode) {
    currentBasemap = mode;
    setGaodeBasemapMode(basemapLayers, currentBasemap);
    elements.vectorBasemapButton.classList.toggle("active", currentBasemap === "vector");
    elements.satelliteBasemapButton.classList.toggle("active", currentBasemap === "satellite");
    setStatus(`已切换为${currentBasemap === "vector" ? "高德矢量底图" : "高德影像底图"}；投诉点位保持不变。`);
  }

  // 初始化顺序：先加载数据和侧栏，再设置底图状态，最后更新状态栏。
  setStatus("正在加载信访投诉点位...");
  await reloadComplaintData({ shouldFit: true });
  await refreshBatchList();
  switchBasemap(currentBasemap);
  setStatus(`已加载 ${allFeatures.length} 个投诉点位。底图可在高德矢量与影像间切换；坐标：GCJ-02。`);
}

function createDefaultControls() {
  if (typeof ol.control.defaults === "function") {
    return ol.control.defaults({ attribution: false, rotate: false });
  }
  return ol.control.defaults.defaults({ attribution: false, rotate: false });
}
