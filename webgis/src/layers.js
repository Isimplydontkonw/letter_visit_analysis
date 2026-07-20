// 地图图层工厂：封装高德底图和投诉点位图层。
// 高德矢量瓦片走 webrd，卫星影像和注记走 webst。
function createGaodeTileLayer(title, hostPrefix, style, visible = true) {
  const urls = [1, 2, 3, 4].map(
    (server) => `https://${hostPrefix}0${server}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=${style}&x={x}&y={y}&z={z}`
  );

  return new ol.layer.Tile({
    title,
    visible,
    source: new ol.source.XYZ({
      urls,
      crossOrigin: "anonymous",
      wrapX: true,
    }),
  });
}

// 返回两组互斥底图图层；main.js 只负责切换 visible 状态。
export function createGaodeBasemapLayers() {
  return {
    vector: [
      createGaodeTileLayer("高德矢量底图", "webrd", 7, true),
    ],
    satellite: [
      createGaodeTileLayer("高德卫星影像", "webst", 6, false),
      createGaodeTileLayer("高德影像注记", "webst", 8, false),
    ],
  };
}

// mode 为 vector 时显示矢量底图，否则显示影像和注记两层。
export function setGaodeBasemapMode(basemapLayers, mode) {
  const isVector = mode === "vector";
  basemapLayers.vector.forEach((layer) => layer.setVisible(isVector));
  basemapLayers.satellite.forEach((layer) => layer.setVisible(!isVector));
}

// 投诉点位使用单独矢量图层，样式函数由 styles.js 提供。
export function createComplaintLayer(source, styleFunction) {
  return new ol.layer.Vector({
    title: "信访投诉点位",
    source,
    style: styleFunction,
    declutter: true,
  });
}
