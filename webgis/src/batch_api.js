// 批量处理 API 封装层。
// 前端页面只关心“预览列名”和“处理文件”两个动作，具体 HTTP 细节集中在这里。
export async function previewBatchFile(file) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/batch/preview", {
    method: "POST",
    body,
  });
  return readJsonResponse(response);
}

export async function processBatchFile({ uploadId, contentColumn, regionColumn }) {
  const response = await fetch("/api/batch/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, contentColumn, regionColumn }),
  });
  return readJsonResponse(response);
}

// 统一解析后端 JSON 响应，让调用方只处理成功结果或 Error。
async function readJsonResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = { ok: false, error: "本地批处理服务未响应，请先运行 python/webgis_api_server.py" };
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  return payload;
}
