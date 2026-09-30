// doc.js — 批注视图（基础能力）：任何 markdown 打开都是「左内容 + 右批注」。
// 不再有独立的「资料库浏览」——原文与自由浏览归 Obsidian，工作台只放精炼过的
// 学习材料（作业包 / 学习日志 / 计划 / 笔记 wikilink）。
// 入口：#/doc?path=<相对路径>（日历点开的日志、最近在读、material 作业页内嵌）
// 或 #/doc?name=<wikilink 名>（材料正文里的 [[笔记]] 链接，服务端按名解析）。
// mountDoc 是可复用组件：作业 material 详情页用 header:false + footer（一句话笔记）。
// API 契约见 app/server.py：/api/read（path|name）、/api/annotations（GET/POST/PUT/DELETE）。
import { get, post } from '../api.js';
import { el, badge, empty, icon, toast } from '../ui.js';
import { mdToHtml } from '../md.js';

const enc = encodeURIComponent;
const ASSIGN_DIRS = ['待答题', '已答待批', '已批改'];
const QUOTE_MAX = 200; // 与 zonefs.QUOTE_MAX 一致：超长引文前端先截断再发
const MIN_SELECT = 4;  // 选区至少这么长才浮出批注按钮
const RECENT_KEY = 'lz-recent'; // 最近在读（首页「最近在读」与本文空态页共用）

// ---------- PUT / DELETE 薄封装 ----------
// api.js 目前只导出 get/post，这里按同一约定补齐：
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

// 路由入口：path/name → 批注视图；都没有 → 引导页（自由浏览去 Obsidian）
export async function render(outlet, params) {
  const path = params.get('path') || '';
  const name = params.get('name') || '';
  if (!path && !name) { renderHome(outlet); return; }
  try {
    await mountDoc(outlet, { path, name, header: true });
  } catch (e) {
    outlet.append(el('h1', { class: 'page-title' }, [icon('read'), '批注阅读']));
    outlet.append(empty('打不开这份材料：' + e.message));
    outlet.append(el('p', {}, [el('a', { class: 'px-btn ghost', href: '#/' }, ['回首页'])]));
  }
}

// 引导页：工作台的定位说明 + 最近在读（快速续读）
function renderHome(outlet) {
  outlet.append(el('h1', { class: 'page-title' }, [icon('read'), '批注阅读']));
  outlet.append(el('div', {
    class: 'px-notice',
    text: '这里打开具体材料：作业包、学习日志、材料里的笔记链接。'
      + '工作台只放精炼过的学习材料——原文（含 PDF 论文）都在 Obsidian 里，自由浏览请去那里。',
  }));
  const list = recentList();
  if (!list.length) {
    outlet.append(empty('还没有打开过的材料——从「作业」箱或首页开始。'));
    return;
  }
  for (const r of list) {
    outlet.append(el('a', { class: 'px-card', href: '#/doc?path=' + enc(r.path) }, [
      el('p', {}, [el('strong', { text: r.title || r.path })]),
      el('p', {}, [el('small', { text: r.path })]),
    ]));
  }
}

// ---------- 批注视图组件 ----------
// 先读材料（path 或 name；返回的 source 是权威相对路径），批注一律按 source 落侧车。
// opts.header = 左栏是否带标题行（#/doc 用 true；作业 material 详情页自带标题用 false）
// opts.footer = 追加到右栏批注列表下方的节点（作业页放「一句话笔记」表单）
export async function mountDoc(container, opts = {}) {
  const path = opts.path || '';
  const name = opts.name || '';
  const mat = await get('/api/read?' + (path ? 'path=' + enc(path) : 'name=' + enc(name)));
  const anns = await get('/api/annotations?material=' + enc(mat.source));

  // 左栏：（header 时）标题行 + 大纲条 + 正文
  const leftBody = el('div', { class: 'md-body', id: 'read-left', html: mdToHtml(mat.md) });
  const leftKids = [];
  if (opts.header) {
    leftKids.push(el('div', { class: 'px-card-title' }, [
      el('span', { text: mat.title }),
      mat.obsidian_url ? el('button', {
        class: 'px-btn ghost', onclick: () => window.open(mat.obsidian_url, '_blank'),
      }, ['在 Obsidian 打开']) : null,
      el('a', { class: 'px-btn ghost', href: '#/' }, ['回首页']),
    ]));
  }
  leftKids.push(buildOutline(leftBody), leftBody);
  const leftCard = el('section', { class: 'px-card' }, leftKids);

  // 右栏：批注数徽章 + 首次提示 + （#/doc 打开作业包时）作答入口，下面是条目列表
  const countBadge = badge('0', 'accent');
  const hint = el('small', { class: 'ann-hint', text: '选中左侧文字即可批注' });
  const listEl = el('div', { id: 'ann-scroll' });
  const rightKids = [el('div', { class: 'px-card-title' },
    [el('span', { text: '批注' }), countBadge, hint,
      opts.header ? assignmentLink(mat.source) : null])];
  rightKids.push(listEl);
  if (opts.footer) rightKids.push(opts.footer); // 提交表单放列表下方，不被长列表顶走
  const rightCard = el('section', { class: 'px-card' }, rightKids);
  container.append(el('div', { class: 'grid-2 reader' }, [leftCard, rightCard]));

  page = { path: mat.source, leftEl: leftBody, listEl, countBadge, hint, fab: null };
  pushRecent(mat.source, mat.title); // 首页「最近在读」的数据源
  renderAnns(anns);
  anchorAll(anns.entries); // 初始渲染：把已有批注逐条定位高亮
  wireSelection(leftBody);
  return { listEl, countBadge };
}

// 作业包（三目录下的材料）→ 右栏顶部的「去作答 / 去看批改」快捷入口；普通笔记返回 null
function assignmentLink(path) {
  const m = path.match(/^(待答题|已答待批|已批改)\/(.+)$/);
  if (!m) return null;
  return el('a', { class: 'px-btn ghost',
    href: '#/assignment?dir=' + enc(m[1]) + '&file=' + enc(m[2]) },
  [m[1] === ASSIGN_DIRS[0] ? '去作答' : '去看批改']);
}

// ---------- 最近在读（localStorage，最多 5 条；首页最近在读卡消费） ----------
export function recentList() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((r) => r && r.path) : [];
  } catch {
    return [];
  }
}

function pushRecent(path, title) {
  try {
    const next = [{ path, title: title || path, ts: Date.now() },
      ...recentList().filter((r) => r.path !== path)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* 存不了就算了，不影响阅读 */ }
}

// ---------- 大纲条：从已渲染的左栏 DOM 收集标题（md.js：#→h2、##→h3、更深 h4） ----------
// 少于 3 个标题不值得目录；点击滚动定位，不做 URL 锚点（换材料即失效，无意义）。
function buildOutline(leftBody) {
  const heads = [...leftBody.querySelectorAll('h2, h3, h4')];
  if (heads.length < 3) return document.createComment(' outline: skip ');
  const list = el('div', { class: 'outline-list', style: { display: 'none' } },
    heads.map((h) => el('button', {
      class: 'outline-item lv' + h.tagName.toLowerCase(),
      text: h.textContent,
      onclick: () => {
        list.style.display = 'none';
        h.scrollIntoView({ block: 'start' });
      },
    })));
  const btn = el('button', { class: 'px-btn ghost' }, ['☰ 大纲 ' + heads.length]);
  btn.addEventListener('click', () => {
    list.style.display = list.style.display === 'none' ? '' : 'none';
  });
  return el('div', { class: 'outline' }, [btn, list]);
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
  for (const e of entries) listEl.append(annEntry(e, page.path, page.leftEl));
}

// 单条批注卡：引用 + note（只读 ⇄ 编辑切换）+ 定位/编辑/删除 + 时间戳
// 请求与 DOM 定位一律用渲染时捕获的 material 路径与左栏（matPath/leftEl），
// 路由切走后旧节点上的请求也不会打错材料
function annEntry(e, matPath, leftEl) {
  const card = el('div', { class: 'ann-entry', dataset: { id: e.id } });

  // 反向定位：点「定位原文」按钮或引用本身 → 左栏高亮滚进视野 + 闪烁
  const goOrigin = () => {
    const m = leftEl && leftEl.querySelector('mark.px-hl[data-id="' + cssId(e.id) + '"]');
    if (!m) { toast('原文已变，未能定位', 'warn'); return; }
    m.scrollIntoView({ block: 'center' });
    m.classList.remove('flash');
    void m.offsetWidth; // 强制重排以重启动画
    m.classList.add('flash');
    setTimeout(() => m.classList.remove('flash'), 1000);
  };
  card.append(el('div', { class: 'ann-quote', text: '> ' + e.quote, onclick: goOrigin }));

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
    el('button', { class: 'px-btn ghost', onclick: goOrigin }, ['↩ 定位']),
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

// ---------- 高亮锚定：纯文本定位 + Range 包 mark ----------
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

// ---------- 选区 → 浮动「✏ 批注」按钮 ----------
// 当前批注页上下文；document 级监听只绑一次，靠 leftEl.isConnected 判断页面是否还活着，
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
