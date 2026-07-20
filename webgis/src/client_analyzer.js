// 浏览器端单条文本分析兜底逻辑。
// 正常情况下优先调用本地 Python API；服务不可用时才使用这里的简化规则。
const KEYWORD_URL = "./data/noise_keywords.tsv";
const BAIDU_AK = window.WEBGIS_CONFIG?.BAIDU_MAP_AK || "";
const X_PI = Math.PI * 3000.0 / 180.0;

let keywordRulesPromise = null;

// 单条投诉文本分析入口：分类、抽地址、地理编码，并返回可直接上图的字段。
export async function analyzeComplaintText(text, region) {
  const serverResult = await analyzeByLocalApi(text, region);
  if (serverResult) {
    return normalizeServerResult(serverResult);
  }

  const rules = await loadKeywordRules();
  const classification = classifyText(text, rules);
  const address = extractAddress(text);
  const queryAddress = buildQueryAddress(region || "浙江省", address);
  const geocode = await geocodeByBaidu(queryAddress);

  const result = {
    "事项编号": "临时识别",
    "诉求内容": text,
    "问题属地": region || "浙江省",
    "噪声分类": classification.type,
    "噪声分类命中关键词": classification.keywords.join(","),
    "噪声分类命中数量": classification.keywords.length,
    "噪声分类全部命中": classification.allHits,
    "识别地址": address,
    "地址识别状态": address ? "命中截止词" : "未找到地址",
    "百度地理编码地址": queryAddress,
    "百度地理编码状态": geocode.status,
    "百度地理编码消息": geocode.message,
    "isHighlight": true,
  };

  if (geocode.ok) {
    const [gcjLng, gcjLat] = bd09ToGcj02(geocode.lng, geocode.lat);
    result["百度经度"] = geocode.lng;
    result["百度纬度"] = geocode.lat;
    result["GCJ02经度"] = gcjLng;
    result["GCJ02纬度"] = gcjLat;
    result["坐标转换状态"] = "browser_formula";
    result["坐标转换消息"] = "浏览器内置公式已转换为 GCJ-02";
  } else {
    result["坐标转换状态"] = "跳过";
    result["坐标转换消息"] = "百度地理编码未返回有效坐标";
  }

  return result;
}


// 本地 API 使用 Python 中更完整的规则和百度请求节流，是优先路径。
async function analyzeByLocalApi(text, region) {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, region }),
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return payload.ok ? payload.result : null;
  } catch {
    return null;
  }
}

// 后端返回 WGS84 时在浏览器补算 GCJ-02，保证点位和高德底图一致。
function normalizeServerResult(result) {
  const normalized = { ...result };
  if (Number.isFinite(Number(normalized["WGS84经度"])) && Number.isFinite(Number(normalized["WGS84纬度"]))) {
    const [gcjLng, gcjLat] = wgs84ToGcj02(Number(normalized["WGS84经度"]), Number(normalized["WGS84纬度"]));
    normalized["GCJ02经度"] = gcjLng;
    normalized["GCJ02纬度"] = gcjLat;
  }
  return normalized;
}

// 关键字 TSV 只加载一次，避免每次单条识别都重复请求文件。
async function loadKeywordRules() {
  if (!keywordRulesPromise) {
    keywordRulesPromise = fetch(KEYWORD_URL, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`关键词文件加载失败：${response.status}`);
        }
        return response.text();
      })
      .then((text) => text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, order) => {
          const [type, keywordText = ""] = line.split("\t");
          return {
            order,
            type,
            keywords: keywordText.split("|").map((item) => item.trim()).filter(Boolean),
          };
        }));
  }
  return keywordRulesPromise;
}

// 简化分类：统计每类命中关键词数量，命中数最多者获胜。
function classifyText(text, rules) {
  const details = [];
  for (const rule of rules) {
    const hits = rule.keywords.filter((keyword) => keyword && text.includes(keyword));
    if (hits.length) {
      details.push({ order: rule.order, type: rule.type, keywords: Array.from(new Set(hits)) });
    }
  }

  if (!details.length) {
    return { type: "未匹配", keywords: [], allHits: "" };
  }

  const maxCount = Math.max(...details.map((item) => item.keywords.length));
  const winner = details
    .filter((item) => item.keywords.length === maxCount)
    .sort((a, b) => a.order - b.order)[0];
  return {
    type: winner.type,
    keywords: winner.keywords,
    allHits: details
      .sort((a, b) => a.order - b.order)
      .map((item) => `${item.type}(${item.keywords.length}):${item.keywords.join(",")}`)
      .join("; "),
  };
}

// 轻量地址抽取规则，用于没有本地 Python 服务时的应急查询。
function extractAddress(text) {
  const content = String(text || "").replace(/\s+/g, "");
  const startPattern = /(?:[\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|乡|街道)|[\u4e00-\u9fa5A-Za-z0-9·-]{2,}(?:路|街|巷|弄|大道)|[\u4e00-\u9fa5A-Za-z0-9·-]{2,}(?:社区|小区|村|园|苑|府|城|大厦|广场|中心|公司|工厂|厂))/;
  const match = content.match(startPattern);
  if (!match || match.index === undefined) {
    return "";
  }

  let candidate = content.slice(match.index, match.index + 100)
    .replace(/^[0-9:：.\-年月日]+/, "")
    .replace(/^(来电反映|市民反映|群众反映|现来电反映|其表示|其是|反映|地址为|位于|在|至)/, "");

  const stopWords = ["门牌号", "号楼", "东门", "西门", "南门", "北门", "小区", "社区", "大厦", "广场", "中心", "公司", "工厂", "厂房", "学校", "医院", "市场", "商场", "酒店", "公寓", "写字楼", "停车场", "幢", "栋", "号", "门", "园", "苑", "府", "城", "村", "厂"];
  let bestEnd = -1;
  for (const word of stopWords) {
    const index = candidate.indexOf(word);
    if (index >= 0 && (bestEnd < 0 || index < bestEnd)) {
      bestEnd = index + word.length;
    }
  }

  if (bestEnd > 0) {
    return trimAddress(candidate.slice(0, bestEnd));
  }

  const fallback = candidate.search(/[，,。；;：:\n\r]|附近|旁边|隔壁|对面|每天|产生|存在|进行|发出|影响|要求|希望|反映/);
  if (fallback >= 0) {
    return trimAddress(candidate.slice(0, fallback));
  }

  return trimAddress(candidate.slice(0, 40));
}

function trimAddress(value) {
  return String(value || "").replace(/^[，,。；;：:（）()[\]【】]+|[，,。；;：:（）()[\]【】]+$/g, "");
}

function buildQueryAddress(region, address) {
  if (!address) {
    return region;
  }
  if (region && !address.includes(region)) {
    return `${region}${address}`;
  }
  return address;
}

// 用百度 JSONP 地理编码，避免浏览器跨域限制。
function geocodeByBaidu(address) {
  if (!BAIDU_AK) {
    return Promise.resolve({ ok: false, status: "NO_AK", message: "请在 webgis/config.local.js 中配置百度地图 AK" });
  }

  return new Promise((resolve) => {
    const callbackName = `baiduGeocode_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({ ok: false, status: "TIMEOUT", message: "百度地理编码请求超时" });
    }, 12000);

    window[callbackName] = (payload) => {
      cleanup();
      if (!payload || payload.status !== 0 || !payload.result || !payload.result.location) {
        resolve({ ok: false, status: payload ? payload.status : "ERROR", message: payload ? (payload.message || "百度地理编码失败") : "百度地理编码失败" });
        return;
      }
      resolve({
        ok: true,
        status: 0,
        message: "OK",
        lng: Number(payload.result.location.lng),
        lat: Number(payload.result.location.lat),
      });
    };

    script.onerror = () => {
      cleanup();
      resolve({ ok: false, status: "ERROR", message: "百度地理编码脚本加载失败" });
    };
    script.src = `https://api.map.baidu.com/geocoding/v3/?output=json&ak=${encodeURIComponent(BAIDU_AK)}&address=${encodeURIComponent(address)}&callback=${callbackName}`;
    document.body.appendChild(script);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }
  });
}

// 百度返回 BD-09，这里转换到 GCJ-02 后才能叠加到高德底图。
function bd09ToGcj02(lng, lat) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}
function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

// 服务端仅返回 WGS84 时使用这个公式兜底转换。
function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) {
    return [lng, lat];
  }
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - 0.00669342162296594323 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((6378245.0 * (1 - 0.00669342162296594323)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}
