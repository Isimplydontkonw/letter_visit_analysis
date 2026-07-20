// 地图数据加载与坐标转换工具。
// 优先读取本地 SQLite API；没有服务时再用 GeoJSON 兜底，方便开发和演示。
const GEOJSON_URL = "./data/complaints.geojson";
const PI = Math.PI;
const AXIS = 6378245.0;
const OFFSET = 0.00669342162296594323;

// 主入口：返回 OpenLayers Feature 数组，供 main.js 放入矢量图层。
export async function loadComplaintFeatures() {
  const databaseGeojson = await loadDatabaseGeojson();
  if (databaseGeojson && Array.isArray(databaseGeojson.features)) {
    return readGcj02Features(databaseGeojson);
  }

  const fallbackGeojson = await loadFallbackGeojson();
  if (fallbackGeojson && Array.isArray(fallbackGeojson.features)) {
    // 旧 GeoJSON 通常是 WGS84，经转换后才能和高德 GCJ-02 底图对齐。
    return readGcj02Features(convertGeojsonWgs84ToGcj02(fallbackGeojson));
  }

  throw new Error("未能加载点位数据。请通过 启动WebGIS.bat 打开本地服务，或提供 webgis/data/complaints.geojson 兜底数据。");
}

export async function loadLocationComplaints(locationKey) {
  const response = await fetch(`/api/location-complaints?locationKey=${encodeURIComponent(locationKey)}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "投诉明细加载失败");
  }
  return payload;
}

// 聚合后的数据库点位优先使用“主要噪声分类”，旧 GeoJSON 点位则只有“噪声分类”。
export function getFeatureType(feature) {
  return feature.get("主要噪声分类") || feature.get("噪声分类") || "未匹配";
}

// 点位详情和选中状态需要一个稳定 ID；地点聚合 ID 优先于原始事项编号。
export function getFeatureId(feature) {
  return feature.get("地点ID") || feature.get("事项编号") || "";
}

// 本地服务可用时从 SQLite 读取，失败时静默返回 null 交给兜底数据。
async function loadDatabaseGeojson() {
  if (window.location.protocol === "file:") {
    return null;
  }
  try {
    const response = await fetch("/api/complaints", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return payload.ok ? payload.geojson : null;
  } catch {
    return null;
  }
}

// 支持两类旧数据：页面全局变量和静态 GeoJSON 文件。
async function loadFallbackGeojson() {
  if (window.COMPLAINTS_GEOJSON && Array.isArray(window.COMPLAINTS_GEOJSON.features)) {
    return window.COMPLAINTS_GEOJSON;
  }
  if (window.COMPLAINT_GEOJSON && Array.isArray(window.COMPLAINT_GEOJSON.features)) {
    return window.COMPLAINT_GEOJSON;
  }
  try {
    const response = await fetch(GEOJSON_URL, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

// 数据管理面板读取导入批次列表，用于显示和撤销。
export async function loadImportBatches() {
  const response = await fetch("/api/batches", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "批次列表加载失败");
  }
  return payload.batches || [];
}

// 删除一个批次后，后端会同时重建地点聚合表。
export async function deleteImportBatch(batchId) {
  const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}`, {
    method: "DELETE",
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "批次撤销失败");
  }
  return payload;
}

// GeoJSON 坐标已经是 GCJ-02 时直接读入 EPSG:3857，供 OpenLayers 渲染。
export function readGcj02Features(geojson) {
  return new ol.format.GeoJSON().readFeatures(geojson, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });
}

// 兼容旧数据：原始导出文件多为 WGS84，需要转成 GCJ-02 贴合高德底图。
function convertGeojsonWgs84ToGcj02(geojson) {
  return {
    ...geojson,
    features: (geojson.features || []).map((feature) => {
      if (!feature.geometry || feature.geometry.type !== "Point") {
        return feature;
      }
      const [lng, lat] = feature.geometry.coordinates;
      const [gcjLng, gcjLat] = wgs84ToGcj02(Number(lng), Number(lat));
      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: [gcjLng, gcjLat],
        },
        properties: {
          ...(feature.properties || {}),
          "显示坐标系": "GCJ-02",
          "显示经度": gcjLng,
          "显示纬度": gcjLat,
        },
      };
    }),
  };
}

// WGS84 -> GCJ-02 公开公式，主要用于旧静态数据兜底展示。
function wgs84ToGcj02(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || outOfChina(lng, lat)) {
    return [lng, lat];
  }
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - OFFSET * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((AXIS * (1 - OFFSET)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}
