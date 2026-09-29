// home.js — 仪表盘：贴士卡 / 到期复习 / 计划面板（含滞后警示）/ XP 卡 / 三箱快捷入口。
import { get } from '../api.js';
import { el, badge, empty, icon, progress, toast } from '../ui.js';

const DIRS = [['待答题', 'pencil', '去答题'], ['已答待批', 'list', '等批改'],
  ['已批改', 'star', '已收获']];
const enc = encodeURIComponent;

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

// ---------- ② 到期复习卡列表：空则庆祝，链接去复习页 ----------
function dueCard(due) {
  const kids = [];
  if (!due.length) {
    kids.push(empty('全部清空！今天没有到期的复习卡，这就是坚持的样子。'));
  } else {
    kids.push(el('table', { class: 'px-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: '主题' }), el('th', { text: '下次复习' })])]),
      el('tbody', {}, due.map((d) => el('tr', {}, [
        el('td', {}, [el('a', { href: '#/review' }, [d.topic])]),
        el('td', {}, [el('small', { text: d.next })]),
      ]))),
    ]));
  }
  kids.push(el('p', {}, [el('a', { class: 'px-btn ghost', href: '#/review' }, ['去复习页'])]));
  return card('到期复习', 'book', kids);
}

// ---------- ③ 计划面板：goal / 当前阶段 / 进度条 / 截止倒计时 ----------
function daysUntil(iso) { // 本地时区算天数差
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
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

function planCard(d) {
  const plan = d.plan;
  const meta = (plan && plan.meta) || {};
  const pc = d.plan_check;
  const kids = [el('p', {}, [el('strong', { text: meta.goal || '（未设目标）' })])];
  if (meta.current_stage) kids.push(el('p', {}, ['当前阶段：', badge(meta.current_stage, 'accent')]));
  if (plan) kids.push(progress(plan.pct, plan.done + '/' + plan.total + ' · ' + plan.pct + '%'));
  const dl = pc && pc.days_left != null ? pc.days_left : daysUntil(meta.deadline);
  kids.push(el('p', {}, [el('small', { text: deadlineText(dl, meta.deadline) })]));
  return card('学习计划', 'flag', kids);
}

// plan_check 滞后警示横条：lag_days > 0 才显示
function lagNotice(pc) {
  if (!pc || !pc.lag_days) return null;
  return el('div', { class: 'px-notice danger', text: '按当前节奏滞后 ' + pc.lag_days + ' 天：'
    + '剩余 ' + pc.blocks_left + ' 块 ≈ ' + pc.est_hours + ' h，预计 ' + (pc.eta_date || '?')
    + ' 完成（截止 ' + (pc.deadline || '未设') + '）。考虑砍范围或加时间。' });
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

// ---------- ⑤ 三箱快捷入口：并行拉三个目录计数 ----------
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
  outlet.append(dueCard(d.due || []));
  const lag = lagNotice(d.plan_check);
  if (lag) outlet.append(lag);
  const grid = el('div', { class: 'grid-2' }, [planCard(d), xpCard(d.xp)]);
  outlet.append(grid);
  const grid2 = el('div', { class: 'grid-2' });
  for (const c of await boxCards()) grid2.append(c);
  outlet.append(grid2);
}
