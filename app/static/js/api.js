// api.js — fetch 薄封装：统一 JSON 编解码、统一中文错误消息。
// 服务端约定：成功 {ok:true,...}；失败 {ok:false,error:中文原因} + 4xx/5xx。

async function request(method, url, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    // 服务已停 / 网络断：fetch 直接 reject，给出可读提示
    throw new Error('连不上学习工作台服务——它还在运行吗？');
  }
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 响应走下面的统一报错 */ }
  if (!res.ok || (data && data.ok === false)) {
    throw new Error((data && data.error) || ('请求失败（HTTP ' + res.status + '）'));
  }
  return data;
}

export const get = (url) => request('GET', url);
export const post = (url, body = {}) => request('POST', url, body);
