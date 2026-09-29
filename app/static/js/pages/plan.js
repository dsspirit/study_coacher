// plan.js — 只读完整学习计划：meta（goal/deadline/weekly_hours）+ 分阶段 checklist + 计划原文。
import { get } from '../api.js';
import { el, badge, empty, icon, progress } from '../ui.js';
import { mdToHtml } from '../md.js';

export async function render(outlet) {
  outlet.append(el('h1', { class: 'page-title' }, [icon('flag'), '学习计划']));
  let p;
  try {
    p = await get('/api/plan');
  } catch (e) {
    outlet.append(empty('读不到学习计划：' + e.message));
    return;
  }
  const meta = p.meta || {};
  // meta 卡：目标 / 截止 / 每周时长 / Obsidian 按钮（无 url 就不渲染）
  outlet.append(el('section', { class: 'px-card' }, [
    el('div', { class: 'px-card-title' }, ['目标']),
    el('p', {}, [el('strong', { text: meta.goal || '（未设目标）' })]),
    el('p', {}, [
      meta.deadline ? badge('截止 ' + meta.deadline, 'warn') : badge('未设截止'),
      ' ',
      meta.weekly_hours ? badge('每周 ' + meta.weekly_hours + ' 小时') : null,
    ]),
    p.obsidian_url ? el('p', {}, [el('button', {
      class: 'px-btn ghost', onclick: () => window.open(p.obsidian_url, '_blank'),
    }, ['在 Obsidian 打开'])]) : null,
  ]));
  // 总进度
  outlet.append(progress(p.pct, p.done + '/' + p.total + ' · ' + p.pct + '%'));
  // 分阶段 checklist：done 的打勾用 ok 色徽章，文字淡化
  for (const s of p.stages || []) {
    const items = (s.items || []).map((it) => el('div', {
      style: { display: 'flex', gap: '8px', alignItems: 'baseline' },
    }, [
      it.done ? badge('✓', 'ok') : badge('□'),
      el('span', { text: it.text, style: it.done ? { opacity: '.6' } : undefined }),
    ]));
    outlet.append(el('section', { class: 'px-card' }, [
      el('div', { class: 'px-card-title' }, [s.name, ' ', badge(s.done + '/' + s.total)]),
      ...(items.length ? items
        : [el('p', {}, [el('small', { text: '（这一阶段还没有拆块）' })])]),
    ]));
  }
  // 计划原文（变更记录等）
  outlet.append(el('section', { class: 'px-card' }, [
    el('div', { class: 'px-card-title' }, ['计划原文']),
    el('div', { class: 'md-body', html: mdToHtml(p.md || '') }),
  ]));
}
