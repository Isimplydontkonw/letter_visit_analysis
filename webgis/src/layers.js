function createGaodeTileLayer(title, style, visible = true) {
  return new ol.layer.Tile({
    title,
    visible,
    source: new ol.source.XYZ({
      url: `http://wprd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=${style}&x={x}&y={y}&z={z}`,
      crossOrigin: "anonymous",
      wrapX: true,
    }),
  });
}

export function createGaodeBasemapLayers() {
  return {
    vector: [
      createGaodeTileLayer("高德矢量底图", 7, true),
    ],
    satellite: [
      createGaodeTileLayer("高德卫星影像", 6, false),
      createGaodeTileLayer("高德影像注记", 8, false),
    ],
  };
}

export function setGaodeBasemapMode(basemapLayers, mode) {
  const isVector = mode === "vector";
  basemapLayers.vector.forEach((layer) => layer.setVisible(isVector));
  basemapLayers.satellite.forEach((layer) => layer.setVisible(!isVector));
}

export function createComplaintLayer(source, styleFunction) {
  return new ol.layer.Vector({
    title: "信访投诉点位",
    source,
    style: styleFunction,
    declutter: true,
  });
}
