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
    onclick: async () => { // 沿当前领域随机换一条
      const q = tip && tip.domain ? '?domain=' + enc(tip.domain) : '';
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

// 月历：每一天都是按钮——点选高亮 + 当日详情条（repaint 重画），不再只有番茄日能点
function calGrid(d, selIso, repaint) {
  const cal = d.calendar || { days: {}, due_ahead: {} };
  const meta = (d.plan && d.plan.meta) || {};
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const todayIso = y + '-' + pad(m + 1) + '-' + pad(now.getDate());
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // 周一为第一列
  const dim = new Date(y, m + 1, 0).getDate();
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
      onclick: () => repaint(iso),
    }, kids));
  }
  return el('div', { class: 'cal-grid' },
    ['一', '二', '三', '四', '五', '六', '日']
      .map((w) => el('span', { class: 'cal-head', text: w })).concat(cells));
}

// 当日详情条：点选的日期 → 活动/到期/截止 + 动作入口
function dayDetail(d, iso) {
  const cal = d.calendar || { days: {}, due_ahead: {} };
  const meta = (d.plan && d.plan.meta) || {};
  const a = cal.days[iso] || {};
  const dueN = cal.due_ahead[iso] || 0;
  const md = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const label = md ? (Number(md[2]) + ' 月 ' + Number(md[3]) + ' 日') : iso;
  const bits = [];
  if (a.pomo) bits.push(a.pomo + ' 番茄');
  if (a.answered) bits.push(a.answered + ' 次提交');
  if (a.graded) bits.push(a.graded + ' 次批改');
  if (dueN) bits.push(dueN + ' 张卡到期');
  if (meta.deadline === iso) bits.push('⚑ 计划截止日');
  const kids = [el('strong', { text: label + '：' }),
    bits.length ? bits.join(' · ') : '这天没有学习记录'];
  if (a.pomo) kids.push(el('a', { class: 'px-btn ghost',
    href: '#/doc?path=' + enc('学习日志/' + iso + '.md') }, ['打开当天日志']));
  if (dueN) kids.push(el('a', { class: 'px-btn ghost', href: '#/review' }, ['去复习页']));
  return el('div', { class: 'cal-detail' }, kids);
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
  // 月历 + 当日详情在左栏；点选日期 → 重画这两块（五问不动）
  const wrap = el('div', { class: 'cal-wrap' });
  const leftCol = el('div');
  wrap.append(leftCol, el('div', {}, [qs]));
  const paint = (selIso) => {
    leftCol.innerHTML = '';
    leftCol.append(calGrid(d, selIso, paint), dayDetail(d, selIso));
  };
  paint(todayIso);
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
  if (d.tip) outlet.append(tipCard(d.tip));
  const recent = recentCard();
  if (recent) outlet.append(recent);
  const lag = lagNotice(d.plan_check);
  if (lag) outlet.append(lag);
  let inbox = []; // 五问③要学什么：待答题清单
  try { inbox = (await get('/api/assignments?dir=' + enc('待答题'))).items || []; } catch { /* 拿不到就只显示计数缺失 */ }
  outlet.append(calCard(d, inbox));
  const grid = el('div', { class: 'grid-2' }, [dueCard(d.due || []), xpCard(d.xp)]);
  outlet.append(grid);
  const grid2 = el('div', { class: 'grid-3' }); // 三箱一行
  for (const c of await boxCards()) grid2.append(c);
  outlet.append(grid2);
}
