// review.js — 到期复习清单（只读）：提示条 + 到期卡表格。真正的复习动作回 zcode 做。
import { get } from '../api.js';
import { el, empty, icon } from '../ui.js';
import { mdToHtml } from '../md.js';

export async function render(outlet) {
  outlet.append(el('h1', { class: 'page-title' }, [icon('timer'), '复习']));
  outlet.append(el('div', {
    class: 'px-notice',
    text: '白纸默写后回 zcode 说「晨间默写」，这里只是清单。',
  }));
  let d;
  try {
    d = await get('/api/dashboard');
  } catch (e) {
    outlet.append(empty('加载失败：' + e.message));
    return;
  }
  const due = d.due || [];
  if (!due.length) {
    outlet.append(empty('队列里没有到期卡——享受这一天。'));
    return;
  }
  outlet.append(el('table', { class: 'px-table' }, [
    el('thead', {}, [el('tr', {}, [el('th', { text: '主题' }), el('th', { text: '下次复习' })])]),
    el('tbody', {}, due.map((c) => el('tr', {}, [
      // 主题 + wikilink 链接（经 md 渲染成 .wikilink span）
      el('td', { html: mdToHtml([c.topic, c.link].filter(Boolean).join(' ')) }),
      el('td', {}, [el('small', { text: c.next })]),
    ]))),
  ]));
}
