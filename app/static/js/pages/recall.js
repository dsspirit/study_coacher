// recall.js — 白纸默写（recall 包专用作答视图）。
// 设计要点：一次一张、只给主题不给材料、当前卡没提交不解锁下一张、
// 每张卡自动计时（用时写进作答末行，是判档证据）、卡住 10 秒出挣扎提示（铁律 5）、
// 草稿与进度存 localStorage（误刷新不丢）。提交走 /api/submit 通用协议，
// 服务端按 ### Q<n> · 默写 + '> ' 引用块重组，对本类型零特化。
import { get, post } from '../api.js';
import { el, badge, empty, icon, toast } from '../ui.js';
import { mdToHtml } from '../md.js';

const HINT_MS = 10000; // 铁律 5：卡住不立刻给答案，先催他憋 10 秒
const draftKey = (file) => 'lz-recall:' + file;
const fmt = (sec) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
const enc = encodeURIComponent;

let ticker = null; // 全页唯一秒表；每次重画先清，路由离开由 draw 里的 clearInterval 兜底

// 路由入口（#/recall?dir=&file=）：取包后交给 view
export async function render(outlet, params) {
  const dir = params.get('dir') || '待答题';
  const file = params.get('file') || '';
  let a;
  try {
    a = await get('/api/assignment?dir=' + enc(dir) + '&file=' + enc(file));
  } catch (e) {
    outlet.append(empty('打不开这个默写包：' + e.message));
    return;
  }
  view(outlet, a);
}

// 视图主体（作业详情页对 recall 包也走这里，复用已取的 a）
export function view(outlet, a) {
  if (!a.can_answer) { // 已提交/已批改的包没有白纸，回详情页看回显
    location.hash = '#/assignment?dir=' + enc(a.dir) + '&file=' + enc(a.file);
    return;
  }
  outlet.append(el('p', {}, [el('a', { href: '#/assignments?dir=' + enc(a.dir) }, ['← 返回列表'])]));
  const wrap = el('div'); // 逐张重画只清这里，返回链接不动
  outlet.append(wrap);
  const qs = a.questions || [];
  if (!qs.length) {
    outlet.append(empty('这个包切不出默写卡——题块要写成 ### Q<n> · 默写'));
    return;
  }
  const qi = a.task_md.search(/^### Q\d/m);
  const intro = (qi === -1 ? a.task_md : a.task_md.slice(0, qi)).trim();

  // 状态：answers/times 按题号存，cur 是当前卡下标（< cur 的都已锁定）
  const draft = loadDraft(a.file);
  const answers = (draft && draft.answers) || {};
  const times = (draft && draft.times) || {};
  let cur = Math.min((draft && draft.cur) || 0, qs.length - 1);
  const save = () => localStorage.setItem(draftKey(a.file),
    JSON.stringify({ answers, times, cur }));

  function draw() {
    clearInterval(ticker);
    let hintTimer = null;
    wrap.innerHTML = '';
    wrap.append(el('h1', { class: 'page-title' }, [icon('pencil'), '白纸默写']));
    wrap.append(el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' },
    }, [
      badge('第 ' + (cur + 1) + ' / ' + qs.length + ' 张', 'accent'),
      badge(a.title || a.file, ''),
    ]));
    if (intro) wrap.append(el('div', { class: 'md-body', html: mdToHtml(intro) }));

    // 已锁定的卡：只读回显，不能改
    for (let i = 0; i < cur; i++) {
      const q = qs[i];
      wrap.append(el('div', { class: 'recall-locked' }, [
        el('div', { class: 'q-head' }, [badge('Q' + q.num, 'accent'), badge('已收起', '')]),
        el('div', {
          class: 'recall-locked-text',
          text: (answers[q.num] || '').trim() || '（空）',
        }),
        el('p', {}, [el('small', { text: '用时 ' + fmt(times[q.num] || 0) })]),
      ]));
    }

    // 当前卡：主题 + 白纸 + 计时 + 挣扎提示
    const q = qs[cur];
    const paper = el('textarea', {
      class: 'recall-paper', rows: '14',
      placeholder: '合上材料，把这张卡能想起来的都写下来——顺序不限，写不满也要写。',
    });
    paper.value = answers[q.num] || '';
    const clock = badge('用时 ' + fmt(times[q.num] || 0), '');
    const hint = el('div', {
      class: 'recall-hint', style: { display: 'none' },
      text: '卡住了？先憋 10 秒——想起什么先写什么，挣扎本身就在加固。',
    });
    const nextBtn = el('button', { class: 'px-btn' },
      [cur === qs.length - 1 ? '交卷' : '下一张']);

    function armHint() {
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { // 10 秒没动笔才出现，一动笔就消失
        if (!paper.value.trim()) hint.style.display = '';
      }, HINT_MS);
    }
    paper.addEventListener('input', () => {
      answers[q.num] = paper.value;
      hint.style.display = 'none';
      armHint();
      save();
    });
    nextBtn.addEventListener('click', async () => {
      answers[q.num] = paper.value;
      times[q.num] = times[q.num] || 0;
      if (cur === qs.length - 1) return submit();
      cur += 1;
      save();
      draw();
      window.scrollTo(0, 0);
    });

    wrap.append(el('div', { class: 'q-block' }, [
      el('div', { class: 'q-head' }, [badge('Q' + q.num, 'accent'), badge('默写', 'danger')]),
      el('div', { class: 'md-body recall-topic', html: mdToHtml(q.md) }),
      paper, hint,
      el('div', { class: 'px-row', style: { marginTop: '10px' } }, [clock, nextBtn]),
    ]));
    paper.focus();
    armHint();
    ticker = setInterval(() => {
      times[q.num] = (times[q.num] || 0) + 1;
      clock.textContent = '用时 ' + fmt(times[q.num]);
      save();
    }, 1000);
  }

  async function submit() {
    const allEmpty = qs.every((q) => !(answers[q.num] || '').trim());
    if (allEmpty && !window.confirm('整张白纸都还空着，确定交卷吗？')) return;
    const out = {};
    for (const q of qs) { // 用时是判档证据，空卡也记（卡了多久都想不起 = again 的证据）
      const body = (answers[q.num] || '').trim();
      out[q.num] = body ? body + '\n\n（用时 ' + fmt(times[q.num] || 0) + '）'
        : '（用时 ' + fmt(times[q.num] || 0) + '）';
    }
    try {
      await post('/api/submit', { dir: a.dir, file: a.file, answers: out });
    } catch (e) {
      toast(e.message, 'danger');
      return;
    }
    clearInterval(ticker);
    localStorage.removeItem(draftKey(a.file));
    toast('白纸已交，移入「已答待批」——回 zcode 说「批改」', 'ok');
    location.hash = '#/assignments?dir=' + enc('已答待批');
  }

  draw();
}

function loadDraft(file) {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(file)));
    return (d && typeof d === 'object' && typeof d.cur === 'number') ? d : null;
  } catch {
    return null;
  }
}
