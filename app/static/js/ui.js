// ui.js — 像素 UI 组件工厂：建元素 / toast / 进度条 / 徽章 / 空态 / 8×8 像素图标。
// 类名契约见 references/visual-spec.md，本文件不发明样式，只拼装契约类名。

const SVG_NS = 'http://www.w3.org/2000/svg';

// 图标画布：每个图标 8 行、每行 8 字符，'#' = 一个填充像素（纯矩形，无圆弧）
export const ICONS = {
  home: [
    '...##...',
    '..####..',
    '.######.',
    '##....##',
    '#......#',
    '#..##..#',
    '#..##..#',
    '########',
  ],
  book: [
    '........',
    '.######.',
    '#..##..#',
    '#..##..#',
    '#......#',
    '#......#',
    '#......#',
    '.######.',
  ],
  read: [ // 打开的书（左右两页 + 中缝），「阅读」导航专用
    '........',
    '##....##',
    '###..###',
    '########',
    '###..###',
    '##....##',
    '........',
    '........',
  ],
  list: [
    '##.#####',
    '##.#####',
    '........',
    '##.#####',
    '##.#####',
    '........',
    '##.#####',
    '##.#####',
  ],
  pencil: [
    '..####..',
    '..####..',
    '..####..',
    '..####..',
    '..####..',
    '...##...',
    '...##...',
    '....#...',
  ],
  timer: [
    '...##...',
    '...##...',
    '.######.',
    '#......#',
    '#..##..#',
    '#......#',
    '.######.',
    '........',
  ],
  flag: [
    '######..',
    '######..',
    '######..',
    '######..',
    '#.......',
    '#.......',
    '#.......',
    '#.......',
  ],
  star: [
    '...##...',
    '...##...',
    '########',
    '.######.',
    '..####..',
    '.##..##.',
    '##....##',
    '........',
  ],
  quit: [
    '..######',
    '..#.....',
    '..#..###',
    '########',
    '########',
    '..#..###',
    '..#.....',
    '..######',
  ],
  sun: [
    '...##...',
    '........',
    '..####..',
    '#.####.#',
    '#.####.#',
    '..####..',
    '........',
    '...##...',
  ],
  moon: [
    '..###...',
    '.##.....',
    '##......',
    '##......',
    '##......',
    '##......',
    '.##.....',
    '..###...',
  ],
  robot: [ // zcode 教练（首页「怎么用」卡）
    '...##...',
    '..####..',
    '.#.##.#.',
    '.######.',
    '..####..',
    '.######.',
    '.#.##.#.',
    '..#..#..',
  ],
  person: [ // 学生（首页「怎么用」卡）
    '..####..',
    '..####..',
    '...##...',
    '.######.',
    '#.####.#',
    '.######.',
    '..#..#..',
    '.##..##.',
  ],
  box: [ // 作业包（流转轨道站点）
    '........',
    '.######.',
    '.#....#.',
    '.#.##.#.',
    '.#.##.#.',
    '.#....#.',
    '.######.',
    '........',
  ],
};

// 快捷建元素：attrs 支持 class/text/html/style(对象)/dataset/onXxx 事件与普通属性
// children 递归拍平：嵌套数组（如 .map() 的结果） historically 会被 String() 成
// "[object HTMLSpanElement],…" 渲染出来（2026-09-30 作业详情页 topics 踩过）
function flattenChildren(cs) {
  if (cs == null || cs === false) return [];
  if (Array.isArray(cs)) return cs.flatMap(flattenChildren);
  return [cs];
}

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;        // 仅用于 mdToHtml 的可信输出
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') Object.assign(n.style, v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of flattenChildren(children)) {
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

// 8×8 像素图标：画布字符串 → 内联 SVG（crispEdges + currentColor），外面包一层 .px-icon
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '8');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('fill', 'currentColor');
  const art = ICONS[name] || [];
  art.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '#') continue;
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', x);
      r.setAttribute('y', y);
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      svg.appendChild(r);
    }
  });
  return el('span', { class: 'px-icon' }, [svg]);
}

// 语义徽章：kind 可为 ok / warn / danger / accent
export function badge(text, kind = '') {
  return el('span', { class: 'px-badge' + (kind ? ' ' + kind : ''), text: String(text) });
}

// 空态引导块
export function empty(text) {
  return el('div', { class: 'px-empty', text: String(text) });
}

// 阶梯化进度条：外层 .px-progress[data-value] + 10 个格子，格子加 .on 表示已填；
// 给了 label 就再包一层放 .px-progress-label（新类，已向主代理报告）。
export function progress(pct, label = '') {
  const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const on = Math.round(p / 10);
  const cells = [];
  for (let i = 0; i < 10; i++) cells.push(el('span', { class: i < on ? 'on' : '' }));
  const bar = el('div', { class: 'px-progress', dataset: { value: p } }, cells);
  // 兼容路径：attr(data-value type(<number>)) 尚未全量支持，内联 --px-value 保底（pix.css 双声明）
  bar.style.setProperty('--px-value', p + '%');
  if (!label) return bar;
  return el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
    [bar, el('span', { class: 'px-progress-label', text: String(label) })]);
}

// 右下角 toast：2.5s 自动消失；kind: ok / warn / danger
export function toast(msg, kind = 'ok') {
  const t = el('div', { class: 'px-toast ' + kind, text: String(msg) });
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300); // 等 CSS 滑出动画结束再移除节点
  }, 2500);
}
