// 地图初始视野和缩放限制。
// 坐标使用经纬度，进入 OpenLayers 视图前会转换为 Web Mercator。
export const INITIAL_CENTER = [120.3, 29.2];
export const INITIAL_ZOOM = 8;
export const MIN_ZOOM = 5;
export const MAX_ZOOM = 18;

// 噪声类型固定配色；未列出的类型会使用 FALLBACK_COLORS 轮换。
export const TYPE_COLORS = {
  交通: "#2878b5",
  工业噪声: "#d45d36",
  建筑施工: "#8f5ab8",
  社会生活: "#1f8a5b",
  未匹配: "#6f7882",
};

export const FALLBACK_COLORS = ["#2878b5", "#d45d36", "#8f5ab8", "#1f8a5b", "#c59a21", "#4f6fd9"];
