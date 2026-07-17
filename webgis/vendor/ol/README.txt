这里可以放置 OpenLayers 离线文件：

- ol.js
- ol.css

页面会优先加载 ./vendor/ol/ol.js 和 ./vendor/ol/ol.css。
如果本地文件不存在，才会依次尝试 jsDelivr、unpkg、BootCDN。
