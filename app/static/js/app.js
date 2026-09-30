// app.js — 入口：初始化主题、装配全局 header（一次构建）、注册路由、启动 hash 路由。
// 对 reader / pomodoro 两个模块只做 import 与调用，不含具体逻辑（它们是待替换的桩）。

import { el, icon } from './ui.js';
import { post } from './api.js';
import * as router from './router.js';
import * as home from './pages/home.js';
import * as assignments from './pages/assignments.js';
import * as plan from './pages/plan.js';
import * as review from './pages/review.js';
import * as recall from './pages/recall.js';
import * as doc from './pages/doc.js';
import * as pomodoro from './pages/pomodoro.js';

const THEME_KEY = 'lz-theme'; // 沿用旧版 localStorage 键

// ---------- 主题：URL ?theme= 优先 → localStorage → 跟随系统 prefers-color-scheme ----------
function applyTheme(t, persist) {
  document.documentElement.dataset.theme = t;
  if (persist) localStorage.setItem(THEME_KEY, t);
  const btn = document.getElementById('theme-btn');
  if (btn) { // 图标 + 文字（即将切换到的主题：暗色时显示"变亮"的太阳）
    btn.innerHTML = '';
    btn.append(icon(t === 'dark' ? 'sun' : 'moon'), t === 'dark' ? ' 浅色' : ' 深色');
  }
}

function initTheme() {
  const q = new URLSearchParams(location.search).get('theme');
  let t = (q === 'dark' || q === 'light') ? q : localStorage.getItem(THEME_KEY);
  if (t !== 'dark' && t !== 'light') {
    t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  applyTheme(t, false);
  return t;
}

// ---------- header ----------
const NAV = [['/', '首页', 'home'], ['/assignments', '作业', 'book'],
  ['/plan', '计划', 'flag'], ['/review', '复习', 'timer']];
// 路由 → 导航高亮归属（作业详情页归「作业」，白纸默写归「复习」，批注视图归「首页」）
const NAV_OF = { '/': '/', '/assignments': '/assignments', '/assignment': '/assignments',
  '/doc': '/', '/read': '/', '/plan': '/plan', '/review': '/review', '/recall': '/review' };

// XP 迷你徽章：首页拿到 dashboard 后广播 'lz-xp' 事件，这里只负责刷新
const xpMini = el('span', { class: 'px-badge accent', id: 'xp-mini', style: { display: 'none' } });
window.addEventListener('lz-xp', (e) => {
  const x = e.detail;
  xpMini.innerHTML = '';
  if (!x) { xpMini.style.display = 'none'; return; }
  xpMini.append(icon('star'), document.createTextNode(' Lv.' + x.level + ' ' + x.title));
  xpMini.style.display = '';
});

function buildHeader() {
  const brand = el('div', { class: 'px-brand' }, [icon('home'), '像素学习台']);
  const nav = el('nav', { class: 'px-nav' }, NAV.map(([route, label, ic]) =>
    el('a', { href: '#' + route, dataset: { route } }, [icon(ic), label])));
  const themeBtn = el('button', {
    class: 'px-btn', id: 'theme-btn', title: '切换深浅主题',
    onclick: () => applyTheme(
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true),
  });
  const pomoSlot = el('div', { id: 'pomo-slot' }); // 番茄钟头部挂载点（桩为空实现）
  const quitBtn = el('button', { class: 'px-btn danger', onclick: quitWorkspace },
    [icon('quit'), '退出']);
  return el('header', { class: 'px-topbar' }, [
    brand, nav, el('div', { class: 'px-topbar-right' }, [themeBtn, xpMini, pomoSlot, quitBtn]),
  ]);
}

// ---------- 退出工作台：POST /shutdown，成败都渲染像素告别页（服务停了 fetch 必然失败） ----------
function farewell() {
  main.innerHTML = '';
  main.append(el('div', {
    class: 'px-card', style: { maxWidth: '520px', margin: '64px auto', textAlign: 'center' },
  }, [
    el('div', { class: 'px-card-title' }, ['工作台已关闭']),
    el('p', { text: '今天也辛苦了，进度都存好了' }),
    el('div', { class: 'xp-big', text: '▓▓▓' }),
    el('p', {}, [el('small', { text: '下次见。重启服务后刷新页面即可回来。' })]),
  ]));
}

async function quitWorkspace() {
  try {
    await post('/shutdown');
  } catch { /* 服务已退出，请求失败是预期内的结局 */ }
  farewell();
}

// ---------- 路由表与启动 ----------
router.register('/', home.render);
router.register('/assignments', assignments.render);
router.register('/assignment', assignments.renderDetail);
router.register('/plan', plan.render);
router.register('/review', review.render);
router.register('/recall', recall.render);
router.register('/doc', doc.render);    // 批注视图：path（相对路径）或 name（wikilink）
router.register('/read', doc.render);   // 旧链接兼容别名
router.notFound((outlet) => {
  outlet.append(el('div', { class: 'px-card' }, [
    el('div', { class: 'px-card-title' }, ['迷路了']),
    el('p', {}, [el('a', { href: '#/' }, ['回首页'])]),
  ]));
});

initTheme();
const app = document.getElementById('app');
app.append(buildHeader());
const main = el('main', { class: 'px-main' });
app.append(main);
pomodoro.mountHeader(document.getElementById('pomo-slot')); // 番茄钟只挂载，逻辑全在模块内
router.start(main, (path) => { // 每次路由后同步导航高亮
  const active = NAV_OF[path] || '';
  document.querySelectorAll('nav.px-nav a').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === active));
});
