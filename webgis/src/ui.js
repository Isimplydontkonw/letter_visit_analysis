import { getFeatureType } from "./data.js?v=20260719-refactor3";
import { getTypeColor } from "./styles.js?v=20260719-refactor3";

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
    refreshMapButton: document.getElementById("refreshMapButton"),
    undoLastBatchButton: document.getElementById("undoLastBatchButton"),
    batchList: document.getElementById("batchList"),
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

export function renderDetails(elements, feature, detailPayload = null) {
  if (!feature) {
    elements.featureDetails.className = "details-empty";
    elements.featureDetails.textContent = "点击地图点位查看该地点投诉详情";
    elements.popup.hidden = true;
    return;
  }

  const location = detailPayload?.location || {};
  const complaints = detailPayload?.complaints || [];
  const isLoading = detailPayload?.loading;
  const error = detailPayload?.error;
  const complaintCount = Number(location["投诉数量"] || feature.get("投诉数量") || complaints.length || 1);
  const locationName = location["投诉地点"] || feature.get("投诉地点") || feature.get("识别地址") || feature.get("问题属地") || "-";

  elements.featureDetails.className = "details-content";
  elements.featureDetails.innerHTML = `
    <div class="location-summary">
      <strong>${escapeHtml(locationName)}</strong>
      <span>共 ${escapeHtml(complaintCount)} 件投诉</span>
    </div>
    ${detailRow("主要噪声分类", location["主要噪声分类"] || feature.get("主要噪声分类") || feature.get("噪声分类"))}
    ${detailRow("问题属地", location["问题属地"] || feature.get("问题属地"))}
    ${detailRow("最早登记时间", location["最早登记时间"] || feature.get("最早登记时间"))}
    ${detailRow("最新登记时间", location["最新登记时间"] || feature.get("最新登记时间"))}
    ${isLoading ? '<div class="details-loading">正在从 complaints 数据库读取投诉明细...</div>' : ""}
    ${error ? `<div class="details-error">${escapeHtml(error)}</div>` : ""}
    ${complaints.length ? `<div class="complaint-list">${complaints.map(renderComplaintItem).join("")}</div>` : ""}
  `;

  elements.popup.innerHTML = `
    <h2 class="popup-title">${escapeHtml(locationName)}</h2>
    <p class="popup-text">共 ${escapeHtml(complaintCount)} 件投诉</p>
    <p class="popup-text">主要分类：${escapeHtml(location["主要噪声分类"] || feature.get("主要噪声分类") || feature.get("噪声分类") || "未匹配")}</p>
    <p class="popup-text">最新登记：${escapeHtml(location["最新登记时间"] || feature.get("最新登记时间") || "-")}</p>
  `;
  elements.popup.hidden = false;
}

function renderComplaintItem(complaint) {
  return `
    <article class="complaint-item">
      <div class="complaint-item-head">
        <strong>${escapeHtml(complaint["事项编号"] || `#${complaint.id}`)}</strong>
        <span>${escapeHtml(complaint["噪声分类"] || "未匹配")}</span>
      </div>
      <div class="complaint-time">登记：${escapeHtml(complaint["登记时间"] || "-")}</div>
      <div class="complaint-time">新建：${escapeHtml(complaint["新建时间"] || "-")}</div>
      <p>${escapeHtml(shortText(complaint["诉求内容"], 160))}</p>
    </article>
  `;
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
    <div>入库：${escapeHtml(result.insertedCount ?? "-")} 条；上图：${escapeHtml(result.validFeatureCount ?? 0)} 个；跳过：${escapeHtml(result.skippedFeatureCount ?? 0)} 条</div>
    <a class="download-link" href="${escapeHtml(result.downloadUrl)}" download>${escapeHtml(result.filename || "下载处理结果")}</a>
  `;
}

export function renderBatchList(elements, batches, onDelete) {
  if (!elements.batchList) {
    return;
  }
  if (!batches.length) {
    elements.batchList.innerHTML = '<div class="batch-empty">暂无导入批次</div>';
    return;
  }

  elements.batchList.innerHTML = batches
    .map((batch) => `
      <article class="batch-item">
        <div>
          <strong>${escapeHtml(batch.sourceFilename || "未命名文件")}</strong>
          <span>${escapeHtml(batch.createdAt || "-")} · ${escapeHtml(batch.rowCount)} 条 · ${escapeHtml(batch.featureCount)} 个点</span>
        </div>
        <button type="button" data-batch-id="${escapeHtml(batch.batchId)}">撤销</button>
      </article>
    `)
    .join("");

  elements.batchList.querySelectorAll("button[data-batch-id]").forEach((button) => {
    button.addEventListener("click", () => onDelete(button.dataset.batchId));
  });
}

function renderSummaryItems(value) {
  if (!value || !Object.keys(value).length) {
    return "-";
  }
  return Object.entries(value)
    .map(([key, count]) => `${escapeHtml(key)} ${escapeHtml(count)}`)
    .join("；");
}
