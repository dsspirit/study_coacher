// assignments.js — 作业三箱列表 + 作业包详情（答题 / 材料批注精读 / 作答回显与批改）。
import { get, post } from '../api.js';
import { el, badge, empty, icon, toast } from '../ui.js';
import { mdToHtml } from '../md.js';
import { view as recallView } from './recall.js';
import { mountDoc } from './doc.js';

const DIRS = ['待答题', '已答待批', '已批改'];
const EMPTY_TEXT = {
  待答题: '这里空空的——去 zcode 说「晨间默写」领作业。',
  已答待批: '没有等着批改的作业——去 zcode 说「批改作业」，让它看看你的作答。',
  已批改: '还没有收获——批改完的作业会躺进这一箱。',
};
const TYPE_KIND = { quiz: 'accent', drill: 'warn', material: 'ok', recall: 'danger' };
const enc = encodeURIComponent;

const typeBadge = (t) => badge(t || 'quiz', TYPE_KIND[t] || '');

// ---------- 列表页：#/assignments?dir= ----------
export async function render(outlet, params) {
  let dir = params.get('dir') || DIRS[0];
  if (!DIRS.includes(dir)) dir = DIRS[0];
  outlet.append(el('h1', { class: 'page-title' }, [icon('book'), '作业']));
  outlet.append(el('div', {}, DIRS.map((d) => el('a', {
    class: 'px-tab' + (d === dir ? ' active' : ''),
    href: '#/assignments?dir=' + enc(d),
  }, [d]))));
  const list = el('div');
  outlet.append(list);
  let data;
  try {
    data = await get('/api/assignments?dir=' + enc(dir));
  } catch (e) {
    list.append(empty('加载失败：' + e.message));
    return;
  }
  const items = data.items || [];
  if (!items.length) {
    list.append(empty(EMPTY_TEXT[dir]));
    return;
  }
  if (dir === '已批改') return renderTimeline(list, dir, items); // 归宿：按天时间线
  for (const it of items) {
    // recall 包在待答题时直达白纸视图，其余进详情页
    const href = it.type === 'recall' && dir === DIRS[0]
      ? '#/recall?dir=' + enc(dir) + '&file=' + enc(it.file)
      : '#/assignment?dir=' + enc(dir) + '&file=' + enc(it.file);
    const meta = dir === '已答待批' ? '提交 ' + waitText(it.mtime_iso) : (it.date || it.mtime);
    list.append(el('a', { class: 'px-card', href }, [
      el('p', {}, [el('strong', { text: it.title || it.file }), ' ', typeBadge(it.type)]),
      el('p', {}, (it.topics || []).map((t) => el('span', { class: 'px-tag', text: t }))),
      el('p', {}, [el('small', { text: meta })]),
    ]));
  }
}

// 已答待批：提交时间 + 已等多久（提醒回来喊批改）
function waitText(mtimeIso) {
  if (!mtimeIso) return '';
  const t = new Date(mtimeIso);
  const mins = Math.max(0, Math.floor((Date.now() - t.getTime()) / 60000));
  if (mins < 60) return mins + ' 分钟（已等 ' + mins + ' 分钟）';
  const h = Math.floor(mins / 60);
  return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
    + '（已等 ' + (h >= 24 ? Math.floor(h / 24) + ' 天' : h + ' 小时') + '）';
}

// ---------- 已批改时间线：按天分组（新→旧），组内按批改时刻（新→旧） ----------
function dayLabel(iso) {
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const todayIso = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayIso = y.getFullYear() + '-' + pad2(y.getMonth() + 1) + '-' + pad2(y.getDate());
  const [_, m, d] = iso.split('-').map(Number);
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
    new Date(iso.substring(0, 4), m - 1, d).getDay()];
  const base = m + ' 月 ' + d + ' 日 · ' + wd;
  if (iso === todayIso) return '今天 · ' + base;
  if (iso === yesterdayIso) return '昨天 · ' + base;
  return base;
}

function renderTimeline(list, dir, items) {
  const sorted = items.slice()
    .sort((a, b) => (b.mtime_iso || b.mtime || '').localeCompare(a.mtime_iso || a.mtime || ''));
  const groups = new Map(); // 插入序 = 最新天在前
  for (const it of sorted) {
    const day = (it.mtime_iso || it.mtime || '').slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(it);
  }
  for (const [day, arr] of groups) {
    list.append(el('div', { class: 'tl-day' }, [
      el('div', { class: 'tl-head' },
        [el('span', { text: dayLabel(day) }), badge(arr.length + ' 份', 'accent')]),
      ...arr.map((it) => el('a', {
        class: 'px-card tl-item',
        href: '#/assignment?dir=' + enc(dir) + '&file=' + enc(it.file),
      }, [
        el('p', {}, [
          el('small', { text: (it.mtime_iso || '').slice(11, 16) + '　' }),
          el('strong', { text: it.title || it.file }),
          ' ',
          typeBadge(it.type),
        ]),
      ])),
    ]));
  }
}

// ---------- 详情页：#/assignment?dir=&file= ----------
export async function renderDetail(outlet, params) {
  const dir = params.get('dir') || DIRS[0];
  const file = params.get('file') || '';
  let a;
  try {
    a = await get('/api/assignment?dir=' + enc(dir) + '&file=' + enc(file));
  } catch (e) {
    outlet.append(el('p', {}, [el('a', { href: '#/assignments?dir=' + enc(dir) }, ['← 返回列表'])]));
    outlet.append(empty('打不开这个作业：' + e.message));
    return;
  }
  if (a.can_answer && a.type === 'recall') return recallView(outlet, a); // 白纸默写有自己的视图
  outlet.append(el('p', {}, [el('a', { href: '#/assignments?dir=' + enc(dir) }, ['← 返回列表'])]));
  // 头部：标题 + 类型徽章 + topics + Obsidian 按钮（无 url 就不渲染）
  outlet.append(el('h1', { class: 'page-title' }, [a.title || file]));
  outlet.append(el('div', {
    style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' },
  }, [
    typeBadge(a.type),
    (a.topics || []).map((t) => el('span', { class: 'px-tag', text: t })),
    a.obsidian_url ? el('button', {
      class: 'px-btn ghost',
      onclick: () => window.open(a.obsidian_url, '_blank'),
    }, ['在 Obsidian 打开']) : null,
  ]));
  if (a.can_answer && a.type !== 'material') answerForm(outlet, a);
  else if (a.can_answer) materialForm(outlet, a);
  else reviewView(outlet, a);
}

// quiz/drill 且可作答：引言（第一道 ### Q 之前的 task_md）+ 每题一块 + 交卷按钮
function answerForm(outlet, a) {
  const qi = a.task_md.search(/^### Q\d/m); // 客户端自己切引言，不依赖服务端
  outlet.append(el('div', {
    class: 'md-body', html: mdToHtml(qi === -1 ? a.task_md : a.task_md.slice(0, qi)),
  }));
  const boxes = {};
  for (const q of a.questions || []) {
    boxes[q.num] = el('textarea', { class: 'answer-box', rows: '4', placeholder: '写下你的答案……' });
    outlet.append(el('div', { class: 'q-block' }, [
      el('div', { class: 'q-head' }, [badge('Q' + q.num, 'accent'), badge(q.type || '简答')]),
      el('div', { class: 'md-body', html: mdToHtml(q.md) }),
      boxes[q.num],
    ]));
  }
  outlet.append(el('p', {}, [el('button', {
    class: 'px-btn',
    onclick: async (ev) => {
      ev.target.disabled = true;
      const answers = {}; // 键 = 题号字符串，与服务端 parse_questions 对齐
      for (const q of a.questions || []) answers[q.num] = boxes[q.num].value;
      try {
        await post('/api/submit', { dir: a.dir, file: a.file, answers });
        toast('已提交，移入「已答待批」', 'ok');
        location.hash = '#/assignments?dir=' + enc('已答待批');
      } catch (e) {
        toast(e.message, 'danger');
        ev.target.disabled = false;
      }
    },
  }, ['交卷'])]));
}

// material 且可作答：批注视图一体化（左材料划线批注，右批注列表 + 一句话笔记 + 提交）。
// 精读与作答在同一页完成，不再跳「阅读器」；原文（PDF 论文等）在 Obsidian，
// 材料里的 [[wikilink]] 点开即进那篇笔记的批注视图。
function materialForm(outlet, a) {
  const note = el('textarea', { class: 'answer-box', rows: '6', placeholder: '写三句话收获……' });
  const footer = el('div', { class: 'material-note' }, [
    el('label', { text: '一句话笔记（合上材料再写）' }),
    note,
    el('p', {}, [el('button', {
      class: 'px-btn',
      onclick: async (ev) => {
        ev.target.disabled = true;
        try {
          await post('/api/submit', { dir: a.dir, file: a.file, note: note.value });
          toast('已提交，移入「已答待批」——回 zcode 说「批改」', 'ok');
          location.hash = '#/assignments?dir=' + enc('已答待批');
        } catch (e) {
          toast(e.message, 'danger');
          ev.target.disabled = false;
        }
      },
    }, ['读完，提交笔记'])]),
  ]);
  mountDoc(outlet, { path: a.dir + '/' + a.file, header: false, footer });
}

// 已答/已批：作答回显（去行首引用符后按 md 渲染）+ 批改卡（accent 边框）
function reviewView(outlet, a) {
  if (a.answer_md && a.answer_md.trim()) {
    outlet.append(el('section', { class: 'px-card' }, [
      el('div', { class: 'px-card-title' }, ['我的作答']),
      el('div', { class: 'md-body', html: mdToHtml(a.answer_md.replace(/^> ?/gm, '')) }),
    ]));
  } else {
    outlet.append(empty('还没有作答记录。'));
  }
  const grade = (a.grade_md || '').trim();
  if (grade && !grade.includes('（待批改）')) {
    outlet.append(el('section', {
      class: 'px-card', style: { borderColor: 'var(--accent)' },
    }, [
      el('div', { class: 'px-card-title' }, ['批改']),
      el('div', { class: 'md-body', html: mdToHtml(grade) }),
    ]));
  } else {
    outlet.append(el('div', { class: 'px-notice', text: '已提交，等待 zcode 批改——批好会出现在这里。' }));
  }
}
