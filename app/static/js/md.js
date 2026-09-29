// md.js — markdown 子集渲染器（零依赖、防 XSS）。
// 流程：整体 HTML 转义 → 块级解析 → 行内标记。支持：
//   # 标题（#→h2、##→h3、更深一律 h4）、--- 分隔线、GFM 表格、> 引用块、
//   -/* 无序列表、1. 有序列表、``` 围栏代码（lang=mermaid 输出 .mmd 并懒加载
//   本地 /static/vendor/mermaid.min.js）、**粗体**、`code`、[[wikilink]]、
//   [文字](url)。输入一律视为不可信文本：先整体转义再处理（含 '>' 变 '&gt;'）。

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 行内标记（输入已整体转义，产出可信 HTML 片段）
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="wikilink">$1</span>')
    .replace(/\[([^\]]+)\]\(([^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

const FENCE_RE = /^```([A-Za-z0-9_-]*)\s*$/;
const CLOSE_RE = /^```\s*$/;
const HEAD_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^(-{3,}|\*{3,})\s*$/;
const QUOTE_RE = /^&gt;\s?(.*)$/; // 整体转义后行首 '>' 已是 '&gt;'
const UL_RE = /^\s{0,3}[-*]\s+(.*)$/;
const OL_RE = /^\s{0,3}\d+\.\s+(.*)$/;
const ROW_RE = /^\s*\|(.*)\|\s*$/;
const SEP_RE = /^[\s:|-]+$/; // 表头分隔行：只含空格/冒号/竖线/横线（还需含 '-'）
// 段落吸行时遇到这些块首就停
const STOP_RE = /^(#{1,6}\s|```|&gt;|\s{0,3}[-*]\s|\s{0,3}\d+\.\s|\|)/;

// 表格一行 → 单元格数组（做行内渲染）
function cells(row) {
  return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')
    .map((c) => inline(c.trim()));
}

// 块级解析：md 文本 → HTML 字符串
function blocks(src) {
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (FENCE_RE.test(line)) { // 围栏代码
      const lang = line.match(FENCE_RE)[1] || '';
      const buf = [];
      i += 1;
      while (i < lines.length && !CLOSE_RE.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1; // 跳过收尾 ```（缺收尾就吃到文本结尾）
      const code = buf.join('\n');
      out.push(lang === 'mermaid'
        ? '<div class="mmd">' + code + '</div>'
        : '<pre><code>' + code + '</code></pre>');
      continue;
    }
    m = line.match(HEAD_RE); // 标题
    if (m) {
      const lv = m[1].length === 1 ? 2 : m[1].length === 2 ? 3 : 4;
      out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>');
      i += 1;
      continue;
    }
    if (HR_RE.test(line)) { out.push('<hr>'); i += 1; continue; }
    if (ROW_RE.test(line) && i + 1 < lines.length // GFM 表格
        && SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && ROW_RE.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      out.push('<table><thead><tr>'
        + head.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }
    m = line.match(QUOTE_RE); // 引用块（内部递归解析，支持引用里的列表/标题等）
    if (m) {
      const buf = [m[1]];
      i += 1;
      while (i < lines.length) {
        const q = lines[i].match(QUOTE_RE);
        if (!q) break;
        buf.push(q[1]);
        i += 1;
      }
      out.push('<blockquote>' + blocks(buf.join('\n')) + '</blockquote>');
      continue;
    }
    m = line.match(UL_RE); // 无序列表（单层）
    if (m) {
      const items = [m[1]];
      i += 1;
      while (i < lines.length) {
        const u = lines[i].match(UL_RE);
        if (!u) break;
        items.push(u[1]);
        i += 1;
      }
      out.push('<ul>' + items.map((t) => '<li>' + inline(t) + '</li>').join('') + '</ul>');
      continue;
    }
    m = line.match(OL_RE); // 有序列表（单层）
    if (m) {
      const items = [m[1]];
      i += 1;
      while (i < lines.length) {
        const o = lines[i].match(OL_RE);
        if (!o) break;
        items.push(o[1]);
        i += 1;
      }
      out.push('<ol>' + items.map((t) => '<li>' + inline(t) + '</li>').join('') + '</ol>');
      continue;
    }
    if (!line.trim()) { i += 1; continue; } // 空行
    const buf = []; // 段落：连续普通行，软换行保留为 <br>
    while (i < lines.length && lines[i].trim() && !STOP_RE.test(lines[i]) && !HR_RE.test(lines[i])) {
      buf.push(lines[i].trim());
      i += 1;
    }
    if (!buf.length) { buf.push(line.trim()); i += 1; } // 防御：本行自身是块首就单行成段
    out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
  }
  return out.join('\n');
}

// ---------- mermaid 懒加载：第一个 .mmd 出现时才注入 vendor 脚本 ----------
let mmLib = null; // 脚本加载 Promise（单例）
const MM_ORIG = new WeakMap(); // .mmd 节点 → 原始代码（失败时还原成 pre）

function ensureMermaid() {
  if (window.mermaid) return Promise.resolve();
  if (!mmLib) {
    mmLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/static/vendor/mermaid.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('mermaid 脚本加载失败'));
      document.head.appendChild(s);
    });
  }
  return mmLib;
}

// 加载/渲染失败：把 .mmd 还原成普通代码块
function mermaidFallback(nodes) {
  for (const n of nodes) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = MM_ORIG.get(n) || n.textContent;
    pre.appendChild(code);
    n.replaceWith(pre);
  }
}

function hydrateMermaid() {
  const nodes = [...document.querySelectorAll('div.mmd')].filter((n) => !n.dataset.mm);
  if (!nodes.length) return;
  for (const n of nodes) { MM_ORIG.set(n, n.textContent); n.dataset.mm = 'loading'; }
  ensureMermaid().then(() => {
    try {
      const dark = document.documentElement.dataset.theme === 'dark';
      window.mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' });
      window.mermaid.run({ nodes })
        .then(() => nodes.forEach((n) => { n.dataset.mm = 'done'; }))
        .catch(() => mermaidFallback(nodes));
    } catch {
      mermaidFallback(nodes);
    }
  }).catch(() => mermaidFallback(nodes));
  nodes.forEach((n) => { n.textContent = '图加载中…'; });
}

// 对外入口：markdown 文本 → HTML 字符串。含 mermaid 块时安排一次懒加载
// （setTimeout 0 = 等调用方把 innerHTML 挂上 DOM 后再找 .mmd 节点）。
// 先剥掉文件头 frontmatter（--- … ---）：阅读器/计划页读的是整份 vault md，
// 元数据不该当正文渲染。
export function mdToHtml(md) {
  const stripped = String(md == null ? '' : md).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const html = blocks(esc(stripped));
  if (html.includes('class="mmd"')) setTimeout(hydrateMermaid, 0);
  return html;
}
