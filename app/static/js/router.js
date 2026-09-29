// router.js — 极简 hash 路由：解析 #/path?k=v，注册表分发，hashchange 重渲染。
// 页面模块约定：render(outlet, params)（async 亦可），自己往 outlet 里塞内容。

const routes = new Map();
let outlet = null;       // 渲染容器（main.px-main）
let onChange = null;     // 每次渲染后的回调（app.js 用来同步导航高亮）
let notFoundFn = null;   // 未注册路由的兜底渲染

export function register(path, handler) { routes.set(path, handler); }
export function notFound(fn) { notFoundFn = fn; }

// 解析当前 hash → { path, params }；无 hash / 空 path 视为 '/'
export function parse() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const qi = raw.indexOf('?');
  const path = (qi === -1 ? raw : raw.slice(0, qi)) || '/';
  const params = new URLSearchParams(qi === -1 ? '' : raw.slice(qi + 1));
  return { path, params };
}

// 清空容器后按注册表渲染；页面抛错渲染成错误卡，不砸掉整个应用
export async function render() {
  if (!outlet) return;
  const { path, params } = parse();
  const fn = routes.get(path) || notFoundFn;
  outlet.innerHTML = '';
  try {
    if (fn) await fn(outlet, params);
    else outlet.textContent = '找不到页面。';
  } catch (e) {
    outlet.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'px-card';
    card.textContent = '页面加载失败：' + (e && e.message ? e.message : e);
    outlet.append(card);
  }
  if (onChange) onChange(path);
}

// 启动：绑定容器与回调，监听 hashchange，立即渲染当前路由
export function start(el, cb) {
  outlet = el;
  onChange = cb || null;
  window.addEventListener('hashchange', render);
  render();
}
