// review.js — 到期复习清单（只读）+ 白纸包直达入口。默写动作在工作台白纸页做，
// 出包/批改/判档回 zcode 做。
import { get } from '../api.js';
import { el, empty, icon, badge } from '../ui.js';
import { mdToHtml } from '../md.js';

const enc = encodeURIComponent;

export async function render(outlet) {
  outlet.append(el('h1', { class: 'page-title' }, [icon('timer'), '复习']));
  outlet.append(el('div', {
    class: 'px-notice',
    text: '到期卡的默写做「白纸包」：在 zcode 说「晨间默写」领包，回这里或「作业」箱开写——一次一张、自动计时。',
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
  } else {
    outlet.append(el('table', { class: 'px-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: '主题' }), el('th', { text: '下次复习' })])]),
      el('tbody', {}, due.map((c) => el('tr', {}, [
        // 主题 + wikilink 链接（经 md 渲染成 .wikilink span）
        el('td', { html: mdToHtml([c.topic, c.link].filter(Boolean).join(' ')) }),
        el('td', {}, [el('small', { text: c.next })]),
      ]))),
    ]));
  }
  try { // 有待默写的白纸包就直接给入口，别让学生找
    const inbox = await get('/api/assignments?dir=' + enc('待答题'));
    const packs = (inbox.items || []).filter((it) => it.type === 'recall');
    if (packs.length) {
      outlet.append(el('h2', { class: 'px-card-title', style: { marginTop: '20px' } },
        ['白纸包待默写']));
      for (const p of packs) {
        outlet.append(el('a', {
          class: 'px-card', href: '#/recall?dir=' + enc('待答题') + '&file=' + enc(p.file),
        }, [
          el('p', {}, [el('strong', { text: p.title || p.file }), ' ', badge('recall', 'danger')]),
          el('p', {}, [el('small', { text: '点开进白纸——第 1 张马上开始' })]),
        ]));
      }
    }
  } catch { /* 待答题列表拿不到不致命，静默 */ }
}
