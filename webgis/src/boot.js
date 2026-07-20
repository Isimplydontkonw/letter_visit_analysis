// 页面启动入口：负责加载 OpenLayers，然后再启动业务地图。
// 这样做可以优先使用本地离线资源，失败后再尝试公共 CDN。
const statusBar = document.getElementById("statusBar");

// 候选顺序很重要：本地资源适合内网/离线使用，CDN 作为兜底。
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

// 动态插入 JS，等脚本真正加载完成后再继续初始化地图。
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

// OpenLayers 的 CSS 和 JS 分开加载，避免地图控件样式缺失。
function loadCss(url) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

// 本地 vendor/ol 目录可能只有 README，没有 ol.js；先探测可避免把 404 当脚本执行。
async function localAssetExists(url) {
  if (!url.startsWith("./")) {
    return true;
  }
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

// 依次尝试候选资源。只要 window.ol 出现，就认为 OpenLayers 可用了。
async function loadOpenLayers() {
  if (window.ol) {
    return;
  }

  const errors = [];
  for (const candidate of OPENLAYERS_CANDIDATES) {
    try {
      if (!(await localAssetExists(candidate.js))) {
        errors.push(`跳过不存在的本地 OpenLayers 文件：${candidate.js}`);
        continue;
      }
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
  // 加版本号是为了绕开浏览器模块缓存，尤其适合本地频繁调试。
  const { startWebGis } = await import("./main.js?v=20260719-refactor3");
  await startWebGis({ setStatus });
} catch (error) {
  setStatus(`地图初始化失败：${error.message}`, true);
}
