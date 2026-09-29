// reader.js — 双栏阅读器：无 path = 资料库浏览（面包屑 + 目录/文件）；
// 有 path = 阅读模式（左材料 + 右批注，选区浮钮批注，纯文本定位高亮）。
// API 契约见 app/server.py：/api/library、/api/read、/api/annotations（GET/POST/PUT/DELETE）。
import { get, post } from '../api.js';
import { el, badge, empty, icon, toast } from '../ui.js';
import { mdToHtml } from '../md.js';

const enc = encodeURIComponent;
const ASSIGN_DIRS = ['待答题', '已答待批', '已批改'];
const QUOTE_MAX = 200; // 与 zonefs.QUOTE_MAX 一致：超长引文前端先截断再发
const MIN_SELECT = 4;  // 选区至少这么长才浮出批注按钮

// ---------- PUT / DELETE 薄封装 ----------
// api.js 目前只导出 get/post（公共模块不在本任务改动范围），这里按同一约定补齐：
// 失败 {ok:false,error} + 4xx/5xx → 抛中文 Error，行为与 get/post 完全一致。
async function send(method, url, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 响应走统一报错 */ }
  if (!res.ok || (data && data.ok === false)) {
    throw new Error((data && data.error) || ('请求失败（HTTP ' + res.status + '）'));
  }
  return data;
}
const put = (url, body = {}) => send('PUT', url, body);
const del = (url) => send('DELETE', url);

// 路由入口：path 为空 → 库模式；否则阅读模式
export async function render(outlet, params) {
  const path = params.get('path') || '';
  if (path) await renderReader(outlet, path);
  else await renderLibrary(outlet, params);
}

// ---------- A. 库模式：目录浏览器 ----------
async function renderLibrary(outlet, params) {
  const rel = params.get('path') || '';
  outlet.append(el('h1', { class: 'page-title' }, [icon('book'), '资料库']));
  const card = el('section', { class: 'px-card' });
  outlet.append(card);

  // 面包屑：根 = 📚 库（回 #/read），每级目录名可点回上级
  const crumbs = el('div', { class: 'px-card-title' }, [el('a', { href: '#/read' }, ['📚 库'])]);
  const segs = rel.split('/').filter(Boolean);
  segs.forEach((seg, i) => {
    crumbs.append(' / ');
    crumbs.append(i === segs.length - 1
      ? el('span', { text: seg })
      : el('a', { href: '#/read?path=' + enc(segs.slice(0, i + 1).join('/')) }, [seg]));
  });
  card.append(crumbs);

  let data;
  try {
    data = await get('/api/library?path=' + enc(rel));
  } catch (e) {
    card.append(empty('打不开这个目录：' + e.message));
    return;
  }
  if (data.truncated) card.append(el('div', { class: 'px-notice', text: '只显示前 200 项' }));
  if (!(data.dirs || []).length && !(data.files || []).length) {
    card.append(empty('这个目录空空的。'));
    return;
  }
  const up = segs.join('/'); // 当前目录（拼子项链接用）
  for (const d of data.dirs || []) {
    card.append(el('a', {
      class: 'reader-item', href: '#/read?path=' + enc(up ? up + '/' + d : d),
    }, ['📁 ', d + '/']));
  }
  for (const f of data.files || []) {
    card.append(el('a', { class: 'reader-item', href: '#/read?path=' + enc(f.path) },
      ['📄 ', el('strong', { text: f.title })]));
  }
}

// ---------- B. 阅读模式：左材料 + 右批注 ----------
async function renderReader(outlet, path) {
  let mat, anns;
  try {
    [mat, anns] = await Promise.all([
      get('/api/read?path=' + enc(path)),
      get('/api/annotations?material=' + enc(path)),
    ]);
  } catch (e) {
    outlet.append(el('h1', { class: 'page-title' }, [icon('book'), '阅读器']));
    outlet.append(empty('打不开这份材料：' + e.message));
    outlet.append(el('p', {}, [el('a', { class: 'px-btn ghost', href: '#/read' }, ['返回资料库'])]));
    return;
  }

  // 左栏：标题行（标题 + Obsidian 按钮（无 url 不渲染）+ 返回库）+ 正文
  const leftBody = el('div', { class: 'md-body', id: 'read-left', html: mdToHtml(mat.md) });
  const leftCard = el('section', { class: 'px-card' }, [
    el('div', { class: 'px-card-title' }, [
      el('span', { text: mat.title }),
      mat.obsidian_url ? el('button', {
        class: 'px-btn ghost', onclick: () => window.open(mat.obsidian_url, '_blank'),
      }, ['在 Obsidian 打开']) : null,
      el('a', { class: 'px-btn ghost', href: '#/read' }, ['返回库']),
    ]),
    leftBody,
  ]);

  // 右栏：批注数徽章 + 首次提示 + （作业包才有）作答/批改入口，下面是条目列表
  const countBadge = badge('0', 'accent');
  const hint = el('small', { class: 'ann-hint', text: '选中左侧文字即可批注' });
  const listEl = el('div', { id: 'ann-scroll' });
  const rightCard = el('section', { class: 'px-card' }, [
    el('div', { class: 'px-card-title' },
      [el('span', { text: '批注' }), countBadge, hint, assignmentLink(path)]),
    listEl,
  ]);
  outlet.append(el('div', { class: 'grid-2 reader' }, [leftCard, rightCard]));

  page = { path, leftEl: leftBody, listEl, countBadge, hint, fab: null };
  renderAnns(anns);
  anchorAll(anns.entries); // 初始渲染：把已有批注逐条定位高亮
  wireSelection(leftBody);
}

// 作业包（三目录下的材料）→ 右栏顶部的「去作答 / 去看批改」快捷入口；普通笔记返回 null
function assignmentLink(path) {
  const m = path.match(/^(待答题|已答待批|已批改)\/(.+)$/);
  if (!m) return null;
  return el('a', { class: 'px-btn ghost',
    href: '#/assignment?dir=' + enc(m[1]) + '&file=' + enc(m[2]) },
  [m[1] === ASSIGN_DIRS[0] ? '去作答' : '去看批改']);
}

// ---------- 批注列表 ----------
async function refreshAnnotations() {
  const anns = await get('/api/annotations?material=' + enc(page.path));
  renderAnns(anns);
  anchorAll(anns.entries);
  return anns;
}

function renderAnns(anns) {
  const listEl = page.listEl;
  listEl.innerHTML = '';
  const entries = anns.entries || [];
  page.countBadge.textContent = String(entries.length);
  page.hint.style.display = entries.length ? 'none' : ''; // 提示只在还没有批注时出现
  if (!entries.length) {
    listEl.append(empty('还没有批注。'));
    return;
  }
  for (const e of entries) listEl.append(annEntry(e, page.path));
}

// 单条批注卡：引用 + note（只读 ⇄ 编辑切换）+ 编辑/删除 + 时间戳
// 请求一律用渲染时捕获的 material 路径（matPath），路由切走后旧节点上的请求也不会打错材料
function annEntry(e, matPath) {
  const card = el('div', { class: 'ann-entry', dataset: { id: e.id } });
  card.append(el('div', { class: 'ann-quote', text: '> ' + e.quote }));

  const noteWrap = el('div');
  const showNote = () => { // 只读态：无内容时给一行灰字占位（不用 .ann-fail，那是定位失败的标记）
    noteWrap.innerHTML = '';
    noteWrap.append(e.note
      ? el('div', { class: 'ann-note', text: e.note })
      : el('div', { class: 'ann-note', style: { color: 'var(--muted)' }, text: '（还没写内容）' }));
  };
  const editNote = () => { // 编辑态：textarea + 保存/取消
    const ta = el('textarea', { class: 'px-textarea', rows: '3' });
    ta.value = e.note;
    noteWrap.innerHTML = '';
    noteWrap.append(ta, el('div', { class: 'px-row' }, [
      el('button', {
        class: 'px-btn',
        onclick: async (ev) => {
          ev.target.disabled = true;
          try {
            await put('/api/annotations', { material: matPath, id: e.id, note: ta.value });
            e.note = ta.value;
            showNote();
            toast('批注已更新', 'ok');
          } catch (err) {
            toast(err.message, 'danger');
            ev.target.disabled = false;
          }
        },
      }, ['保存']),
      el('button', { class: 'px-btn ghost', onclick: showNote }, ['取消']),
    ]));
    ta.focus();
  };
  showNote();
  card.append(noteWrap);

  card.append(el('div', { class: 'px-row' }, [
    el('button', { class: 'px-btn ghost', onclick: editNote }, ['编辑']),
    el('button', {
      class: 'px-btn ghost danger',
      onclick: async (ev) => {
        ev.target.disabled = true;
        try {
          await del('/api/annotations?material=' + enc(matPath) + '&id=' + enc(e.id));
          card.remove();
          unmark(page.leftEl, e.id); // 左栏对应 mark 同步去掉
          page.countBadge.textContent =
            String(Math.max(0, (Number(page.countBadge.textContent) || 0) - 1));
          toast('批注已删除', 'ok');
        } catch (err) {
          toast(err.message, 'danger');
          ev.target.disabled = false;
        }
      },
    }, ['删除']),
    el('span', { class: 'ann-ts', text: e.ts }),
  ]));
  return card;
}

// ---------- D. 高亮锚定：纯文本定位 + Range 包 mark ----------
const cssId = (id) => (window.CSS && CSS.escape) ? CSS.escape(id) : id;

// TreeWalker 收集容器内所有文本节点，拼全文字符串并记录每节点 [start, end)
function textMap(container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let full = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data) continue;
    nodes.push({ node: n, start: full.length, end: full.length + n.data.length });
    full += n.data;
  }
  return { full, nodes };
}

function unmarkNode(m) { // 解包：mark 的子节点放回原位
  while (m.firstChild) m.parentNode.insertBefore(m.firstChild, m);
  m.remove();
}

function unmarkAll(container) {
  container.querySelectorAll('mark.px-hl').forEach(unmarkNode);
  container.normalize(); // 合并相邻文本节点，让下一次 textMap 干净
}

function unmark(container, annId) {
  const m = container.querySelector('mark.px-hl[data-id="' + cssId(annId) + '"]');
  if (m) { unmarkNode(m); container.normalize(); }
}

// 在纯文本里找 quote 第一处命中，用 Range 包进 <mark class="px-hl" data-id>；未命中返回 false
function locate(container, quote, annId) {
  if (!quote) return false;
  const { full, nodes } = textMap(container);
  const at = full.indexOf(quote); // 多次命中取第一处
  if (at === -1) return false;
  const stop = at + quote.length;
  let first = null, last = null;
  for (const r of nodes) {
    if (r.end <= at || r.start >= stop) continue;
    if (!first) first = r;
    last = r;
  }
  if (!first) return false;
  const range = document.createRange();
  range.setStart(first.node, at - first.start);
  range.setEnd(last.node, stop - last.start);
  const mark = document.createElement('mark');
  mark.className = 'px-hl';
  mark.dataset.id = annId;
  mark.appendChild(range.extractContents()); // 跨节点时自动拆分边界文本节点
  range.insertNode(mark);
  return true;
}

// 清掉旧 mark 后逐条定位；定位失败的条目在右栏挂一行灰字
function anchorAll(entries) {
  unmarkAll(page.leftEl);
  for (const e of entries || []) {
    const ok = locate(page.leftEl, e.quote, e.id);
    const card = page.listEl.querySelector('.ann-entry[data-id="' + cssId(e.id) + '"]');
    if (!ok && card && !card.querySelector('.ann-fail')) {
      card.insertBefore(el('div', { class: 'ann-fail', text: '原文已变，未能定位' }),
        card.querySelector('.px-row'));
    }
  }
}

// mark 点击 → 右栏对应条目滚进视野 + accent 闪烁 1s
function jumpTo(annId) {
  const card = page.listEl.querySelector('.ann-entry[data-id="' + cssId(annId) + '"]');
  if (!card) return;
  card.scrollIntoView({ block: 'center' });
  card.classList.remove('flash');
  void card.offsetWidth; // 强制重排以重启动画
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1000);
}

// ---------- C. 选区 → 浮动「✏ 批注」按钮 ----------
// 当前阅读页上下文；document 级监听只绑一次，靠 leftEl.isConnected 判断页面是否还活着，
// 路由切走后旧监听自动变空操作，不会重复绑监听。
let page = null;

function hideFab() {
  if (page && page.fab) { page.fab.remove(); page.fab = null; }
}

function onPageSelectionChange() {
  if (!page || !page.leftEl.isConnected) { hideFab(); return; }
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  const inside = sel && !sel.isCollapsed
    && page.leftEl.contains(sel.anchorNode) && page.leftEl.contains(sel.focusNode);
  if (!inside || text.length < MIN_SELECT) { hideFab(); return; }
  showFab(sel);
}

function showFab(sel) {
  hideFab();
  const btn = el('button', { class: 'px-btn px-fab', text: '✏ 批注' });
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // 点按钮别弄丢选区
  btn.addEventListener('click', () => startNewAnn(window.getSelection().toString()));
  document.body.append(btn);
  // 定位在选区结尾坐标附近；水平方向夹在视口内不出界
  const rects = sel.getRangeAt(0).getClientRects();
  const r = rects.length ? rects[rects.length - 1] : sel.getRangeAt(0).getBoundingClientRect();
  const sx = window.scrollX, sy = window.scrollY;
  btn.style.left = '0px'; btn.style.top = '0px'; // 先挂载再量尺寸
  const w = btn.offsetWidth;
  const x = Math.max(sx + 8, Math.min(r.right + sx - w, sx + document.documentElement.clientWidth - w - 8));
  btn.style.left = x + 'px';
  btn.style.top = (r.bottom + sy + 6) + 'px';
  page.fab = btn;
}

function wireSelection(leftEl) {
  leftEl.addEventListener('mouseup', onPageSelectionChange);
  leftEl.addEventListener('scroll', hideFab); // 内容滚走浮钮就没了
  // mark 点击 → 右栏对应条目滚进视野 + accent 闪烁
  leftEl.addEventListener('click', (ev) => {
    const m = ev.target.closest('mark.px-hl');
    if (m) jumpTo(m.dataset.id);
  });
}

// 点浮钮 → 右栏顶部插入新批注卡（quote 只读预显 + 空 note），保存走 POST
// ctx 在点击时捕获：保存请求与 DOM 更新只作用于打开新批注卡时的那个页面
function startNewAnn(rawQuote) {
  const ctx = page;
  hideFab();
  window.getSelection().removeAllRanges();
  let quote = String(rawQuote || '').trim();
  if (quote.length > QUOTE_MAX) { // 服务端也会截到 200，前端先截并明说
    quote = quote.slice(0, QUOTE_MAX);
    toast('引文超过 ' + QUOTE_MAX + ' 字，已截断保存', 'warn');
  }
  const ta = el('textarea', { class: 'px-textarea', rows: '3', placeholder: '写下你的想法……' });
  const card = el('div', { class: 'ann-entry ann-new' }, [
    el('div', { class: 'px-row' }, [badge('新批注', 'accent')]),
    el('div', { class: 'ann-quote', text: '> ' + quote }),
    ta,
    el('div', { class: 'px-row' }, [
      el('button', {
        class: 'px-btn',
        onclick: async (ev) => {
          ev.target.disabled = true;
          try {
            const r = await post('/api/annotations', { material: ctx.path, quote, note: ta.value });
            toast('批注已保存', 'ok');
            card.remove();
            if (ctx !== page) return; // 期间已切走路由：别去刷新页面的列表
            await refreshAnnotations(); // 重拉列表并全部重定位（含新条目）
            jumpTo(r.id);               // 右栏滚到新条目并闪一下
          } catch (e) {
            toast(e.message, 'danger');
            ev.target.disabled = false;
          }
        },
      }, ['保存批注']),
      el('button', { class: 'px-btn ghost', onclick: () => card.remove() }, ['取消']),
    ]),
  ]);
  ctx.listEl.prepend(card);
  ta.focus();
}

// document 级监听（模块只装一次）：选区变化驱动浮钮显隐；点左右栏以外的地方收掉浮钮
document.addEventListener('selectionchange', onPageSelectionChange);
document.addEventListener('mousedown', (ev) => {
  if (!page || !page.fab) return;
  if (!page.fab.contains(ev.target) && !page.leftEl.contains(ev.target)) hideFab();
});
