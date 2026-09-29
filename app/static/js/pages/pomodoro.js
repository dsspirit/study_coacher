// pomodoro.js — 番茄钟：header 常驻小控件（idle/focus/break 状态机）+ 说明卡页。
// 对外契约：mountHeader(slot)（app.js 装配 header 时调用一次）+ render(outlet)（无独立路由，保留导出）。
import { get, post } from '../api.js';
import { el, icon, toast } from '../ui.js';

// 测试钩子：URL 带 ?pomo=1 时专注时长改为 1 分钟并自动开始，供自动化验收在几秒内看到倒计时。
const ONE_MIN = new URLSearchParams(location.search).get('pomo') === '1';
const FOCUS_SEC = ONE_MIN ? 60 : 25 * 60;
const BREAK_SEC = 5 * 60;
const SITE = ' · 像素学习台';

let state = 'idle';  // idle | focus | break
let remain = 0;      // 当前阶段剩余秒数
let focusSec = 0;    // 本次专注总秒数（完成提示与日志用）
let startHHMM = '';  // 专注开始时刻 HH:MM（写日志用）
let label = '';      // 开始专注时的页面语境（写日志用）
let savedTitle = ''; // 进入专注前的页面标题，回 idle 时还原
let btn = null;      // header 上的控件按钮

const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); // 25:00 / 4:32 / 0:59
const hhmm = () => {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

// 开始专注时的页面语境作为日志标签：先去站点后缀，再去可能残留的倒计时前缀；
// 结果为空或就是站点名（不在具体页面）时传空串，由服务端写「（无标签）」。
function currentLabel() {
  const t = document.title.replace(/ · 像素学习台$/, '').replace(/^⏳.*· /, '');
  return t === '像素学习台' || t === '' ? '' : t;
}

function show(text, tip) { // 控件按钮本身就是状态文字
  btn.textContent = text;
  btn.title = tip;
}

function setTitle(s) { document.title = '⏳ ' + s + SITE; }

function renderCountdown() {
  show(state === 'focus' ? fmt(remain) : '☕ ' + fmt(remain),
    state === 'focus' ? '专注中，再点一下就放弃（不记日志）' : '休息中，点击跳过');
  setTitle(fmt(remain));
}

function toIdle() {
  state = 'idle';
  show('⏱ 番茄钟', '点击开始一个番茄（25 分钟专注 + 5 分钟休息）');
  if (savedTitle) { document.title = savedTitle; savedTitle = ''; }
}

function beginFocus() {
  savedTitle = document.title;
  label = currentLabel(); // 必须在标题被倒计时覆盖前读取
  focusSec = FOCUS_SEC;
  startHHMM = hhmm();
  remain = focusSec;
  state = 'focus';
}

function finishFocus() {
  // 乐观提示 + 异步记日志：请求失败不打断休息，只补一条错误 toast
  const minutes = Math.round(focusSec / 60);
  toast('🍅 专注 ' + minutes + ' 分钟完成，已记入学习日志');
  post('/api/pomodoro', { minutes, label, start: startHHMM })
    .catch((e) => toast('番茄日志没写上：' + e.message, 'danger'));
  state = 'break';
  remain = BREAK_SEC;
}

function tick() {
  if (state === 'idle') return;
  remain -= 1;
  if (remain > 0) { renderCountdown(); return; }
  if (state === 'focus') { finishFocus(); renderCountdown(); return; }
  toast('休息结束，随时再来一发');
  toIdle();
}

function onClick() {
  if (state === 'idle') { beginFocus(); renderCountdown(); }
  else if (state === 'focus') { toast('这次番茄作废', 'warn'); toIdle(); }
  else toIdle(); // 休息中点击 = 跳过（不写日志）
}

export function mountHeader(slot) {
  if (!slot) return;
  slot.innerHTML = '';
  btn = el('button', { class: 'px-btn', onclick: onClick });
  slot.append(btn);
  toIdle();
  if (ONE_MIN) { beginFocus(); renderCountdown(); } // 测试钩子：自动开始，免点击可验收
  // 模块内唯一的定时器：header 常驻整个页面生命周期，路由切换不清掉；
  // idle 态 tick 直接返回，开销可忽略。
  setInterval(tick, 1000);
}

// 说明卡：番茄钟没有独立路由入口（app.js 未注册），本函数保留导出供路由表扩展。
export async function render(outlet) {
  outlet.append(el('h1', { class: 'page-title' }, [icon('timer'), '番茄钟']));
  let n = null;
  try {
    const d = await get('/api/dashboard');
    if (d && d.xp && d.xp.pomos_today != null) n = d.xp.pomos_today;
  } catch { /* 说明卡不因统计接口失败而缺席 */ }
  outlet.append(el('section', { class: 'px-card' }, [
    el('div', { class: 'px-card-title' }, ['什么是番茄工作法']),
    el('p', { text: '挑一件事，专注 25 分钟——这叫一个「番茄」；然后休息 5 分钟。' +
      '一个又一个番茄把大任务切成坐得住的小块，也把「我是不是在偷懒」的焦虑，' +
      '换成「还剩几分钟」的确定。' }),
    el('p', {}, [
      el('strong', { text: '计时按钮就在页面右上角：' }),
      '点一下开始专注，再点一下放弃；专注结束自动进入休息，休息期间点一下可跳过。' +
      '完成的番茄都会自动记入学习日志。',
    ]),
    el('p', {}, [n == null
      ? el('small', { text: '今日番茄数暂时读不到。' })
      : el('span', { text: '今日已完成 ' + n + ' 个番茄。' })]),
  ]));
}
