import { getFeatureId, getFeatureType } from "./data.js";
import { getTypeColor } from "./styles.js";

export function getElements() {
  return {
    totalCount: document.getElementById("totalCount"),
    visibleCount: document.getElementById("visibleCount"),
    typeFilters: document.getElementById("typeFilters"),
    typeStats: document.getElementById("typeStats"),
    featureDetails: document.getElementById("featureDetails"),
    analyzeForm: document.getElementById("analyzeForm"),
    complaintText: document.getElementById("complaintText"),
    regionInput: document.getElementById("regionInput"),
    analyzeButton: document.getElementById("analyzeButton"),
    analysisResult: document.getElementById("analysisResult"),
    batchForm: document.getElementById("batchForm"),
    batchFileInput: document.getElementById("batchFileInput"),
    batchPreviewButton: document.getElementById("batchPreviewButton"),
    batchContentColumn: document.getElementById("batchContentColumn"),
    batchRegionColumn: document.getElementById("batchRegionColumn"),
    batchProcessButton: document.getElementById("batchProcessButton"),
    batchResult: document.getElementById("batchResult"),
    popup: document.getElementById("popup"),
    vectorBasemapButton: document.getElementById("vectorBasemapButton"),
    satelliteBasemapButton: document.getElementById("satelliteBasemapButton"),
    zoomInButton: document.getElementById("zoomInButton"),
    zoomOutButton: document.getElementById("zoomOutButton"),
    fitButton: document.getElementById("fitButton"),
    resetButton: document.getElementById("resetButton"),
  };
}

export function renderAnalysisResult(elements, result, isError = false) {
  elements.analysisResult.classList.toggle("error", isError);
  if (isError) {
    elements.analysisResult.textContent = result;
    return;
  }

  elements.analysisResult.innerHTML = `
    <div>分类：<strong>${escapeHtml(result["噪声分类"] || "-")}</strong></div>
    <div>命中词：${escapeHtml(result["噪声分类命中关键词"] || "-")}</div>
    <div>地址：<strong>${escapeHtml(result["识别地址"] || "-")}</strong></div>
    <div>地理编码：${escapeHtml(String(result["百度地理编码状态"] ?? "-"))} ${escapeHtml(result["百度地理编码消息"] || "")}</div>
    <div>坐标：${escapeHtml(result["GCJ02经度"] || "-")}，${escapeHtml(result["GCJ02纬度"] || "-")}</div>
  `;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function shortText(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function countByType(features) {
  return features.reduce((acc, feature) => {
    const type = getFeatureType(feature);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
}

export function createTypeOrder(features) {
  const counts = countByType(features);
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, "zh-CN"));
}

export function renderFilters(elements, allFeatures, activeTypes, typeOrder, onChange) {
  const counts = countByType(allFeatures);
  elements.typeFilters.innerHTML = typeOrder
    .map((type) => `
      <label class="filter-item">
        <input type="checkbox" value="${escapeHtml(type)}" ${activeTypes.has(type) ? "checked" : ""} />
        <span class="swatch" style="background:${getTypeColor(type, typeOrder)}"></span>
        <span class="type-name">${escapeHtml(type)}</span>
        <span class="count-pill">${counts[type]}</span>
      </label>
    `)
    .join("");

  elements.typeFilters.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        activeTypes.add(input.value);
      } else {
        activeTypes.delete(input.value);
      }
      onChange();
    });
  });
}

export function renderStats(elements, visibleFeatures, typeOrder) {
  const counts = countByType(visibleFeatures);
  elements.typeStats.innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([type, count]) => `
      <div class="stat-item">
        <span class="swatch" style="background:${getTypeColor(type, typeOrder)}"></span>
        <span class="type-name">${escapeHtml(type)}</span>
        <span class="count-pill">${count}</span>
      </div>
    `)
    .join("");
}

function detailRow(label, value) {
  return `
    <div class="detail-row">
      <span>${label}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    </div>
  `;
}

export function renderDetails(elements, feature) {
  if (!feature) {
    elements.featureDetails.className = "details-empty";
    elements.featureDetails.textContent = "点击地图点位查看详情";
    elements.popup.hidden = true;
    return;
  }

  elements.featureDetails.className = "details-content";
  elements.featureDetails.innerHTML = [
    detailRow("事项编号", feature.get("事项编号")),
    detailRow("噪声分类", feature.get("噪声分类")),
    detailRow("识别地址", feature.get("识别地址")),
    detailRow("问题属地", feature.get("问题属地")),
    detailRow("登记时间", feature.get("登记时间")),
    detailRow("坐标转换", feature.get("坐标转换状态")),
    detailRow("诉求内容", shortText(feature.get("诉求内容"), 180)),
  ].join("");

  elements.popup.innerHTML = `
    <h2 class="popup-title">${escapeHtml(feature.get("噪声分类") || "未匹配")}</h2>
    <p class="popup-text">${escapeHtml(feature.get("识别地址") || feature.get("问题属地") || "-")}</p>
    <p class="popup-text">${escapeHtml(shortText(feature.get("诉求内容"), 90))}</p>
    <p class="popup-text">编号：${escapeHtml(getFeatureId(feature))}</p>
  `;
  elements.popup.hidden = false;
}
export function renderBatchColumns(elements, columns) {
  const options = columns
    .map((column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`)
    .join("");
  const contentDefault = columns.includes("诉求内容") ? "诉求内容" : (columns[0] || "");
  const regionDefault = columns.includes("问题属地") ? "问题属地" : "";

  elements.batchContentColumn.innerHTML = options || '<option value="">未读取到列</option>';
  elements.batchRegionColumn.innerHTML = '<option value="">不使用属地列</option>' + options;
  elements.batchContentColumn.value = contentDefault;
  elements.batchRegionColumn.value = regionDefault;
  elements.batchContentColumn.disabled = !columns.length;
  elements.batchRegionColumn.disabled = !columns.length;
  elements.batchProcessButton.disabled = !columns.length;
}

export function renderBatchResult(elements, result, isError = false) {
  elements.batchResult.classList.toggle("error", isError);
  if (isError) {
    elements.batchResult.textContent = result;
    return;
  }

  if (typeof result === "string") {
    elements.batchResult.textContent = result;
    return;
  }

  const summary = result.summary || {};
  elements.batchResult.innerHTML = `
    <div>处理记录：<strong>${escapeHtml(summary.rows ?? "-")}</strong> 条</div>
    <div>分类统计：${renderSummaryItems(summary.classification)}</div>
    <div>地址识别：${renderSummaryItems(summary.address)}</div>
    <div>地理编码：${renderSummaryItems(summary.geocode)}</div>
    <a class="download-link" href="${escapeHtml(result.downloadUrl)}" download>${escapeHtml(result.filename || "下载处理结果")}</a>
  `;
}

function renderSummaryItems(value) {
  if (!value || !Object.keys(value).length) {
    return "-";
  }
  return Object.entries(value)
    .map(([key, count]) => `${escapeHtml(key)} ${escapeHtml(count)}`)
    .join("；");
}
