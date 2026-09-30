// home.js — 仪表盘：贴士 / 计划与日历（月历热度 + 五问）/ 到期复习 / XP / 三箱入口。
// 日历五问：①计划是什么 ②学过什么 ③要学什么 ④下一步干什么 ⑤计划啥时候完成。
import { get } from '../api.js';
import { el, badge, empty, icon, progress, toast } from '../ui.js';
import { recentList } from './doc.js';

const DIRS = [['待答题', 'pencil', '去答题'], ['已答待批', 'list', '等批改'],
  ['已批改', 'star', '已收获']];
const enc = encodeURIComponent;
const pad = (n) => String(n).padStart(2, '0');

// 通用卡片骨架：.px-card > .px-card-title + 内容
function card(title, ic, kids) {
  return el('section', { class: 'px-card' },
    [el('div', { class: 'px-card-title' }, [icon(ic), title]), ...kids]);
}

// ---------- ⓪ 怎么用：人机配合一日循环（像素动画泳道 + 静态清晰文字） ----------
// 动画只做高亮与跳格移动（steps 硬切，像素风）；说明文字全部静态可读（排版铁律）。
function howtoCard() {
  const collapsed = localStorage.getItem('lz-howto') === '1';
  const coach = el('div', { class: 'howto-role ht-coach' }, [
    icon('robot'),
    el('div', {}, [
      el('strong', { text: 'Agent 教练' }),
      el('small', { text: '出题 · 发白纸包 · 红笔批改 · SM-2 判档' }),
    ]),
  ]);
  const student = el('div', { class: 'howto-role ht-student' }, [
    icon('person'),
    el('div', {}, [
      el('strong', { text: '你（工作台）' }),
      el('small', { text: '白纸默写 · 答题 · 划线批注 · 交卷' }),
    ]),
  ]);
  const st = (ic, label, cls) => el('div', { class: 'howto-station ' + (cls || '') },
    [icon(ic), el('span', { text: label })]);
  const track = el('div', { class: 'howto-track' }, [
    st('robot', 'Agent'),
    st('box', '待答题', 's1'),
    st('pencil', '已答待批', 's2'),
    st('star', '已批改', 's3'),
    el('span', { class: 'howto-courier', title: '作业包在流转' }, [icon('book')]),
  ]);
  const steps = el('ol', { class: 'howto-steps' }, [
    el('li', {}, ['晨间对 Agent 说「', el('strong', { text: '晨间默写' }),
      '」→ 到期卡发成白纸包，你在工作台一次一张默写（自动计时）']),
    el('li', {}, ['白天在工作台：答题 / 精读材料——', el('strong', { text: '选中文字写批注' }),
      '，读完交一句话笔记'],
    ),
    el('li', {}, ['回 Agent 说「', el('strong', { text: '批改' }),
      '」→ 红笔 + 判档 + 错题归档，新作业包又进待答题——循环']),
  ]);
  const foot = el('small', {
    class: 'howto-foot',
    text: '进度全在 vault 文件里：Obsidian 管原文（含 PDF 论文），工作台管消化——文件是唯一媒介。',
  });
  const body = el('div', { class: 'howto-body' + (collapsed ? ' hide' : '') },
    [coach, track, student, steps, foot]);
  const btn = el('button', {
    class: 'px-btn ghost', style: { marginLeft: 'auto', padding: '4px 10px', fontSize: '14px' },
    onclick: () => {
      const hide = body.classList.toggle('hide');
      localStorage.setItem('lz-howto', hide ? '1' : '0');
      btn.textContent = hide ? '展开' : '收起';
    },
  }, [collapsed ? '展开' : '收起']);
  return el('section', { class: 'px-card' }, [
    el('div', { class: 'px-card-title' }, [icon('book'), '使用指南', btn]),
    body,
  ]);
}

// ---------- ① 贴士卡：原理名 + 一句话 + 怎么做 + 领域徽章，「再来一条」换内容 ----------
function tipCard(tip) {
  const body = el('div');
  const paint = (t) => {
    body.innerHTML = '';
    if (!t) { body.append(empty('贴士库还没装上——不影响学习。')); return; }
    body.append(
      el('p', {}, [el('strong', { text: t.name }), ' ', badge(t.domain)]),
      el('p', { text: t.line }),
      el('p', {}, [el('small', { text: '怎么做：' + t.how })]),
    );
  };
  paint(tip);
  const btn = el('button', {
    class: 'px-btn ghost',
    onclick: async () => { // 全库随机换一条并排除当前条（小领域池会抽回原条，点了像没换）
      const q = tip && tip.name ? '?exclude=' + enc(tip.name) : '';
      try {
        const r = await get('/api/tips/random' + q);
        tip = r.tip;
        paint(tip);
      } catch (e) { toast(e.message, 'danger'); }
    },
  }, ['再来一条']);
  return card('今日贴士', 'star', [body, btn]);
}

// ---------- ② 计划与日历大卡：左月历（活动热度/截止旗/到期角标）+ 右五问 ----------
function daysUntil(iso) { // 本地时区算天数差；非 YYYY-MM-DD（如占位符）返回 null 而非 NaN
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if ([y, m, d].some(Number.isNaN)) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

function deadlineText(dl, iso) {
  if (dl == null) return iso ? '截止：' + iso : '未设截止日期';
  if (dl < 0) return '截止 ' + iso + '（已过 ' + -dl + ' 天）';
  if (dl === 0) return '截止就是今天——冲。';
  return '距截止还有 ' + dl + ' 天';
}

// 活动分 → 热度档（1-3）：番茄权重 ×2（25 分钟一个，比一次提交重）
const heatLv = (score) => (score >= 5 ? 3 : score >= 3 ? 2 : score >= 1 ? 1 : 0);

// 月历盒子：任意年月渲染 + 切月导航；点选格子 → onPick(iso)，切月 → onNav()
function monthBox(cal, meta, state, selIso, onPick, onNav, todayIso) {
  const y = state.y, m = state.m;
  const now = new Date();
  const isCur = y === now.getFullYear() && m === now.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // 周一为第一列
  const go = (dy, dm) => {
    const d0 = new Date(y + dy, m + dm, 1);
    state.y = d0.getFullYear();
    state.m = d0.getMonth();
    onNav();
  };
  const nav = el('div', { class: 'cal-nav' }, [
    el('button', { class: 'px-btn ghost', type: 'button', onclick: () => go(0, -1) }, ['◀']),
    el('strong', { text: y + ' 年 ' + (m + 1) + ' 月' }),
    el('button', { class: 'px-btn ghost', type: 'button', onclick: () => go(0, 1) }, ['▶']),
    el('button', {
      class: 'px-btn ghost', type: 'button', disabled: isCur,
      onclick: () => { state.y = now.getFullYear(); state.m = now.getMonth(); onNav(); },
    }, ['今天']),
  ]);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(el('span', { class: 'cal-cell blank' }));
  for (let day = 1; day <= dim; day++) {
    const iso = y + '-' + pad(m + 1) + '-' + pad(day);
    const a = cal.days[iso] || {};
    const h = heatLv((a.pomo || 0) * 2 + (a.answered || 0) + (a.graded || 0));
    const dueN = cal.due_ahead[iso] || 0;
    const bits = [];
    if (a.pomo) bits.push(a.pomo + ' 番茄');
    if (a.answered) bits.push(a.answered + ' 次提交');
    if (a.graded) bits.push(a.graded + ' 次批改');
    if (dueN) bits.push(dueN + ' 张卡到期');
    if (meta.deadline === iso) bits.push('截止日');
    const kids = [String(day)];
    if (dueN) kids.push(el('span', { class: 'cal-due', text: String(dueN) }));
    if (h) kids.push(el('span', { class: 'cal-heat' }));
    cells.push(el('button', {
      type: 'button',
      class: 'cal-cell' + (h ? ' h' + h : '') + (iso === todayIso ? ' today' : '')
        + (meta.deadline === iso ? ' dl' : '') + (iso === selIso ? ' sel' : ''),
      title: bits.join(' · ') || '没有学习记录',
      onclick: () => onPick(iso),
    }, kids));
  }
  const grid = el('div', { class: 'cal-grid' },
    ['一', '二', '三', '四', '五', '六', '日']
      .map((w) => el('span', { class: 'cal-head', text: w })).concat(cells));
  return el('div', {}, [nav, grid]);
}

// 当日流水面板：点选日期 → /api/day 明细（番茄逐条/当天作业/到期/截止）
async function drawDayPanel(panel, meta, iso) {
  panel.innerHTML = '';
  panel.append(el('small', { class: 'cal-loading', text: '加载当日明细…' }));
  let day;
  try {
    day = await get('/api/day?date=' + iso);
  } catch (e) {
    panel.innerHTML = '';
    panel.append(el('div', { class: 'cal-detail', text: '明细加载失败：' + e.message }));
    return;
  }
  panel.innerHTML = '';
  const md = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
    new Date(Number(md[1]), Number(md[2]) - 1, Number(md[3])).getDay()];
  const kids = [el('strong', { text: Number(md[2]) + ' 月 ' + Number(md[3]) + ' 日 · ' + wd })];
  if (meta.deadline === iso) kids.push(el('div', { class: 'cal-row', text: '⚑ 计划截止日' }));
  for (const p of day.pomo || []) {
    kids.push(el('div', { class: 'cal-row',
      text: '🍅 ' + p.start + '–' + p.end + ' · ' + p.min + ' min · ' + (p.label || '无标签') }));
  }
  for (const a of day.submitted || []) {
    kids.push(el('div', { class: 'cal-row' }, ['交：',
      el('a', { href: '#/assignment?dir=' + enc(a.dir) + '&file=' + enc(a.file) }, [a.title]),
      ' ', badge(a.type || 'quiz')]));
  }
  for (const a of day.graded || []) {
    kids.push(el('div', { class: 'cal-row' }, ['批：',
      el('a', { href: '#/assignment?dir=' + enc(a.dir) + '&file=' + enc(a.file) }, [a.title]),
      ' ', badge('已批改', 'ok')]));
  }
  if (day.due) kids.push(el('div', { class: 'cal-row' }, [day.due + ' 张卡到期　',
    el('a', { href: '#/review' }, ['去复习页'])]));
  if (day.log) kids.push(el('div', { class: 'cal-row' }, [
    el('a', { class: 'px-btn ghost', href: '#/doc?path=' + enc('学习日志/' + iso + '.md') },
      ['打开当天日志'])]));
  if (kids.length === 1) kids.push(el('div', { class: 'cal-row', text: '这天没有学习记录' }));
  panel.append(el('div', { class: 'cal-detail' }, kids));
}

function calCard(d, inbox) {
  const cal = d.calendar || { days: {}, due_ahead: {} };
  const plan = d.plan;
  const meta = (plan && plan.meta) || {};
  const pc = d.plan_check;
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const monthKey = y + '-' + pad(m + 1);
  const todayIso = monthKey + '-' + pad(now.getDate());

  // ② 本月学过：days 按月前缀汇总
  let pomo = 0, answered = 0, graded = 0;
  for (const [iso, a] of Object.entries(cal.days)) {
    if (!iso.startsWith(monthKey)) continue;
    pomo += a.pomo || 0; answered += a.answered || 0; graded += a.graded || 0;
  }
  // ③ 未来 7 天到期数
  let due7 = 0;
  for (let i = 0; i < 7; i++) {
    const dt = new Date(y, m, now.getDate() + i);
    due7 += cal.due_ahead[dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())] || 0;
  }
  const pend = inbox || [];
  const firstMaterial = pend.find((it) => it.type === 'material');
  const due = d.due || [];
  const dl = pc && pc.days_left != null ? pc.days_left : daysUntil(meta.deadline);

  const qs = el('dl', { class: 'q-list' }, [
    el('dt', { text: '① 计划' }),
    el('dd', {}, [
      el('strong', { text: meta.goal || '（未设目标）' }),
    ]),
    plan ? el('dd', {}, [progress(plan.pct, plan.done + '/' + plan.total + ' · ' + plan.pct + '%')]) : null,
    el('dt', { text: '② 学过（本月）' }),
    el('dd', { text: pomo + ' 个番茄 · ' + answered + ' 次提交 · ' + graded + ' 次批改（点日历格子看当天日志）' }),
    el('dt', { text: '③ 要学' }),
    el('dd', { text: '待答题 ' + pend.length + ' 份'
      + (firstMaterial ? '（在读：' + (firstMaterial.title || firstMaterial.file) + '）' : '')
      + (due7 ? '；未来 7 天 ' + due7 + ' 张卡到期' : '') }),
    el('dt', { text: '④ 下一步' }),
    due.length
      ? el('dd', {}, [el('a', { href: '#/review' },
          ['先去默写 ' + due.length + ' 张到期卡（白纸包在复习页领）'])])
      : el('dd', { text: (meta.current_item || '—') + '　→　下一个：' + (meta.next_item || '—') }),
    el('dt', { text: '⑤ 完成' }),
    el('dd', {
      text: deadlineText(dl, meta.deadline)
        + (pc && pc.eta_date ? ' · 按当前节奏预计 ' + pc.eta_date + ' 完成' : ''),
    }),
  ]);
  // 月历（可切年月）+ 当日流水面板在左栏；五问固定「现在时」不随切月变
  const state = { y: now.getFullYear(), m: now.getMonth() };
  let selIso = todayIso;
  const wrap = el('div', { class: 'cal-wrap' });
  const leftCol = el('div');
  const monthHolder = el('div');
  const panel = el('div', { class: 'cal-panel' });
  leftCol.append(monthHolder, panel);
  wrap.append(leftCol, el('div', {}, [qs]));
  const drawMonth = () => {
    monthHolder.innerHTML = '';
    monthHolder.append(monthBox(cal, meta, state, selIso, onPick, onNav, todayIso));
  };
  const onPick = (iso) => { selIso = iso; drawMonth(); drawDayPanel(panel, meta, iso); };
  const onNav = () => { // 切月后默认选：当月选今天，否则选 1 号
    selIso = (state.y === now.getFullYear() && state.m === now.getMonth())
      ? todayIso : state.y + '-' + pad(state.m + 1) + '-01';
    drawMonth();
    drawDayPanel(panel, meta, selIso);
  };
  drawMonth();
  drawDayPanel(panel, meta, selIso);
  return card('计划与日历', 'flag', [wrap]);
}

// plan_check 滞后警示横条：lag_days > 0 才显示
function lagNotice(pc) {
  if (!pc || !pc.lag_days) return null;
  return el('div', { class: 'px-notice danger', text: '按当前节奏滞后 ' + pc.lag_days + ' 天：'
    + '剩余 ' + pc.blocks_left + ' 块 ≈ ' + pc.est_hours + ' h，预计 ' + (pc.eta_date || '?')
    + ' 完成（截止 ' + (pc.deadline || '未设') + '）。考虑砍范围或加时间。' });
}

// ---------- ③ 到期复习卡列表：空则庆祝，链接去复习页 ----------
function dueCard(due) {
  const kids = [];
  if (!due.length) {
    kids.push(empty('全部清空！今天没有到期的复习卡，这就是坚持的样子。'));
  } else {
    kids.push(el('table', { class: 'px-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: '主题' }), el('th', { text: '下次复习' })])]),
      el('tbody', {}, due.map((row) => el('tr', {}, [
        el('td', {}, [el('a', { href: '#/review' }, [row.topic])]),
        el('td', {}, [el('small', { text: row.next })]),
      ]))),
    ]));
  }
  kids.push(el('p', {}, [el('a', { class: 'px-btn ghost', href: '#/review' }, ['去复习页'])]));
  return card('到期复习', 'book', kids);
}

// ---------- ④ XP 卡：大数字 + 称号 + 连续天数 ----------
function xpCard(x) {
  if (!x) return card('经验值', 'star', [empty('还没有学习记录——从一页材料开始。')]);
  return card('经验值', 'star', [
    el('div', { class: 'xp-big', text: String(x.xp) }),
    el('p', {}, [badge('Lv.' + x.level, 'accent'), ' ', el('strong', { text: x.title })]),
    el('p', {}, [el('small', {
      text: '连续学习 ' + x.streak + ' 天 · 距下一级还差 ' + Math.max(0, x.next_at - x.xp) + ' XP',
    })]),
  ]);
}

// ---------- ⑤ 最近在读：doc.js 写入的 localStorage，最多 5 条 ----------
function recentCard() {
  const list = recentList();
  if (!list.length) return null;
  return card('最近在读', 'read', list.map((r) => el('a', {
    class: 'reader-item', href: '#/doc?path=' + enc(r.path),
  }, ['📄 ', el('strong', { text: r.title || r.path })])));
}

// ---------- ⑥ 三箱快捷入口：并行拉三个目录计数 ----------
async function boxCards() {
  const counts = await Promise.all(DIRS.map(([dir]) =>
    get('/api/assignments?dir=' + enc(dir)).then((r) => r.items.length).catch(() => null)));
  return DIRS.map(([dir, ic, hint], i) => el('a', {
    class: 'px-card', href: '#/assignments?dir=' + enc(dir),
  }, [
    el('div', { class: 'px-card-title' }, [icon(ic), dir]),
    el('p', {}, [badge(counts[i] == null ? '?' : String(counts[i])), ' ' + hint]),
  ]));
}

export async function render(outlet) {
  outlet.append(el('h1', { class: 'page-title' }, [icon('home'), '仪表盘']));
  let d;
  try {
    d = await get('/api/dashboard');
  } catch (e) {
    outlet.append(empty('加载失败：' + e.message));
    return;
  }
  if (d.xp) window.dispatchEvent(new CustomEvent('lz-xp', { detail: d.xp })); // 刷新 header 徽章
  const boxesP = boxCards(); // 三箱计数并行预取，不阻塞下面的卡片渲染
  outlet.append(howtoCard()); // 怎么用（可折叠，新手引导）
  if (d.tip) outlet.append(tipCard(d.tip));
  const boxes = el('div', { class: 'grid-3' }); // 三箱一行：紧跟今日贴士
  outlet.append(boxes);
  const recent = recentCard();
  if (recent) outlet.append(recent);
  const lag = lagNotice(d.plan_check);
  if (lag) outlet.append(lag);
  let inbox = []; // 五问③要学什么：待答题清单
  try { inbox = (await get('/api/assignments?dir=' + enc('待答题'))).items || []; } catch { /* 拿不到就只显示计数缺失 */ }
  outlet.append(calCard(d, inbox));
  const grid = el('div', { class: 'grid-2' }, [dueCard(d.due || []), xpCard(d.xp)]);
  outlet.append(grid);
  for (const c of await boxesP) boxes.append(c); // 预取回来后填进已占位的行
}
