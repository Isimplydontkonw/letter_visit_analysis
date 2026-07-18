import { INITIAL_CENTER, INITIAL_ZOOM, MAX_ZOOM, MIN_ZOOM } from "./config.js";
import { analyzeComplaintText } from "./client_analyzer.js";
import { previewBatchFile, processBatchFile } from "./batch_api.js";
import { getFeatureType, loadComplaintFeatures } from "./data.js";
import { createComplaintLayer, createGaodeBasemapLayers, setGaodeBasemapMode } from "./layers.js";
import { createComplaintStyle } from "./styles.js";
import {
  createTypeOrder,
  getElements,
  renderAnalysisResult,
  renderBatchColumns,
  renderBatchResult,
  renderDetails,
  renderFilters,
  renderStats,
} from "./ui.js";

export async function startWebGis({ setStatus }) {
  const elements = getElements();
  const vectorSource = new ol.source.Vector();
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
    stopEvent: false,
    offset: [0, -14],
  });
  map.addOverlay(popupOverlay);

  function getVisibleFeatures() {
    return allFeatures.filter((feature) => activeTypes.has(getFeatureType(feature)));
  }

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

  function resetFilters() {
    activeTypes = new Set(typeOrder);
    renderFilters(elements, allFeatures, activeTypes, typeOrder, () => refreshVisibleFeatures());
    refreshVisibleFeatures({ shouldFit: true });
  }

  function selectFeature(feature) {
    selectedFeature = feature || null;
    renderDetails(elements, selectedFeature);
    popupOverlay.setPosition(selectedFeature ? selectedFeature.getGeometry().getCoordinates() : undefined);
    complaintLayer.changed();
  }

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
      setStatus(`批量处理完成：${result.filename}`);
    } catch (error) {
      renderBatchResult(elements, error.message || "批量处理失败", true);
      setStatus(`批量处理失败：${error.message}`, true);
    } finally {
      elements.batchProcessButton.disabled = false;
      elements.batchProcessButton.textContent = "批量处理并导出";
    }
  }
  map.on("singleclick", (event) => {
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { hitTolerance: 6 });
    selectFeature(feature);
  });

  map.on("pointermove", (event) => {
    const hit = map.hasFeatureAtPixel(event.pixel, { hitTolerance: 6 });
    map.getTargetElement().style.cursor = hit ? "pointer" : "";
  });

  elements.zoomInButton.addEventListener("click", () => {
    const view = map.getView();
    view.animate({ zoom: Math.min((view.getZoom() || INITIAL_ZOOM) + 1, MAX_ZOOM), duration: 180 });
  });
  elements.zoomOutButton.addEventListener("click", () => {
    const view = map.getView();
    view.animate({ zoom: Math.max((view.getZoom() || INITIAL_ZOOM) - 1, MIN_ZOOM), duration: 180 });
  });
  elements.fitButton.addEventListener("click", fitToVisibleFeatures);
  elements.resetButton.addEventListener("click", resetFilters);
  elements.analyzeForm.addEventListener("submit", analyzeInputText);
  elements.batchPreviewButton.addEventListener("click", previewBatchInputFile);
  elements.batchForm.addEventListener("submit", processBatchInputFile);
  elements.batchFileInput.addEventListener("change", () => {
    currentBatchUploadId = null;
    elements.batchProcessButton.disabled = true;
    renderBatchResult(elements, "文件已选择，请点击读取列名。", false);
  });
  elements.vectorBasemapButton.addEventListener("click", () => switchBasemap("vector"));
  elements.satelliteBasemapButton.addEventListener("click", () => switchBasemap("satellite"));

  function switchBasemap(mode) {
    currentBasemap = mode;
    setGaodeBasemapMode(basemapLayers, currentBasemap);
    elements.vectorBasemapButton.classList.toggle("active", currentBasemap === "vector");
    elements.satelliteBasemapButton.classList.toggle("active", currentBasemap === "satellite");
    setStatus(`已切换为${currentBasemap === "vector" ? "高德矢量底图" : "高德影像底图"}；投诉点位保持不变。`);
  }

  setStatus("正在加载信访投诉点位...");
  allFeatures = await loadComplaintFeatures();
  typeOrder = createTypeOrder(allFeatures);
  activeTypes = new Set(typeOrder);
  renderFilters(elements, allFeatures, activeTypes, typeOrder, () => refreshVisibleFeatures());
  renderDetails(elements, null);
  refreshVisibleFeatures({ shouldFit: true });
  switchBasemap(currentBasemap);
  setStatus(`已加载 ${allFeatures.length} 个投诉点位。底图可在高德矢量与影像间切换；坐标：GCJ-02。`);
}

function createDefaultControls() {
  if (typeof ol.control.defaults === "function") {
    return ol.control.defaults({ attribution: false, rotate: false });
  }
  return ol.control.defaults.defaults({ attribution: false, rotate: false });
}
