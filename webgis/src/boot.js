const statusBar = document.getElementById("statusBar");

const OPENLAYERS_CANDIDATES = [
  {
    js: "./vendor/ol/ol.js",
    css: "./vendor/ol/ol.css",
  },
  {
    js: "https://cdn.jsdelivr.net/npm/ol@10.4.0/dist/ol.js",
    css: "https://cdn.jsdelivr.net/npm/ol@10.4.0/ol.css",
  },
  {
    js: "https://unpkg.com/ol@10.4.0/dist/ol.js",
    css: "https://unpkg.com/ol@10.4.0/ol.css",
  },
  {
    js: "https://cdn.bootcdn.net/ajax/libs/openlayers/10.4.0/dist/ol.js",
    css: "https://cdn.bootcdn.net/ajax/libs/openlayers/10.4.0/ol.css",
  },
];

function setStatus(message, isError = false) {
  statusBar.textContent = message;
  statusBar.classList.toggle("error", isError);
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`OpenLayers 脚本加载失败：${url}`));
    document.head.appendChild(script);
  });
}

function loadCss(url) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

async function loadOpenLayers() {
  if (window.ol) {
    return;
  }

  const errors = [];
  for (const candidate of OPENLAYERS_CANDIDATES) {
    try {
      setStatus("正在加载 OpenLayers...");
      loadCss(candidate.css);
      await loadScript(candidate.js);
      if (window.ol) {
        return;
      }
      errors.push(`加载后未发现 window.ol：${candidate.js}`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.join("；"));
}

try {
  await loadOpenLayers();
  const { startWebGis } = await import("./main.js");
  await startWebGis({ setStatus });
} catch (error) {
  setStatus(`地图初始化失败：${error.message}`, true);
}
