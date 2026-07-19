import { FALLBACK_COLORS, TYPE_COLORS } from "./config.js?v=20260719-refactor3";
import { getFeatureType } from "./data.js?v=20260719-refactor3";

export function getTypeColor(type, typeOrder = []) {
  if (TYPE_COLORS[type]) {
    return TYPE_COLORS[type];
  }
  const index = Math.max(0, typeOrder.indexOf(type));
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export function createComplaintStyle(feature, selectedFeature, typeOrder) {
  if (feature.get("isHighlight")) {
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: selectedFeature === feature ? 13 : 11,
        fill: new ol.style.Fill({ color: "#ffd43b" }),
        stroke: new ol.style.Stroke({ color: "#1d2b38", width: 4 }),
      }),
      zIndex: 20,
    });
  }

  const type = getFeatureType(feature);
  const selected = selectedFeature === feature;
  const color = getTypeColor(type, typeOrder);
  const complaintCount = Math.max(1, Number(feature.get("投诉数量") || 1));
  const radius = Math.min(18, 7 + Math.sqrt(complaintCount) * 2);

  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: selected ? radius + 3 : radius,
      fill: new ol.style.Fill({ color }),
      stroke: new ol.style.Stroke({
        color: selected ? "#16232f" : "#ffffff",
        width: selected ? 3 : 2,
      }),
    }),
  });
}
