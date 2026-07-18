const KEYWORD_URL = "./data/noise_keywords.tsv";
const BAIDU_AK = window.WEBGIS_CONFIG?.BAIDU_MAP_AK || "";
const X_PI = Math.PI * 3000.0 / 180.0;

let keywordRulesPromise = null;

export async function analyzeComplaintText(text, region) {
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
    script.src = `http://api.map.baidu.com/geocoding/v3/?output=json&ak=${encodeURIComponent(BAIDU_AK)}&address=${encodeURIComponent(address)}&callback=${callbackName}`;
    document.body.appendChild(script);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }
  });
}

function bd09ToGcj02(lng, lat) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}
