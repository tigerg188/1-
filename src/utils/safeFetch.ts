/**
 * 安全的 JSON 请求辅助函数，对非 JSON / HTML 404/500/502/504 响应提供良好的拦截与友好中文错误处理
 */
export async function safeFetchJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const text = await res.text();
    // 过滤掉 HTML 标签得到可读错误预览
    const cleanPreview = text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

    if (res.status === 504 || res.status === 502 || res.status === 503) {
      throw new Error(`服务请求超时或网关繁忙 (${res.status})，请稍后重试`);
    }
    if (res.status === 404) {
      throw new Error(`未找到请求接口 (404): ${url}`);
    }
    if (res.status === 403) {
      throw new Error(`请求被拦截或未授权 (403)，请刷新页面`);
    }

    throw new Error(`服务器返回非 JSON 响应 (${res.status}): ${cleanPreview || '未知响应内容'}`);
  }

  const data = await res.json();
  return data as T;
}
