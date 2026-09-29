#!/usr/bin/env python3
"""zone 文件协议层 — study-coach skill 的纯函数库（无 HTTP，零第三方依赖）。

协议是「文件即数据库」：所有状态都放在 vault/zone 的 markdown 里
（frontmatter + 约定小节），Obsidian 全程可读可手改，软件、CLI 与 zcode
各凭同一份文件对齐。学习工作台（learning_zone.py）与将来的 MCP server
共用本层：作业三目录、复习队列表格、学习计划、批注侧车、番茄钟日志。

契约：读写一律 utf-8 + "\\n"；写回走「读全文 → 字符串操作 → 整体写回」，
绝不重排用户手写的内容。
"""

import re
from datetime import date, datetime
from pathlib import Path, PurePosixPath

INBOX, ANSWERED, GRADED = "待答题", "已答待批", "已批改"
ASSIGN_DIRS = (INBOX, ANSWERED, GRADED)
ANNOT_DIR = "学习批注"
ANNOT_TAG = "学习批注"
ANNOT_MARK = "**我的批注**："
QUOTE_MAX = 200  # 批注引文最长字符数，超出截断
LOG_DIR = "学习日志"
TEMPLATE_REL = "90_模板/学习日志模板.md"
POMO_SECTION = "## 番茄钟"
EXCLUDE_DIRS = {".obsidian", ".trash", ".git", "__pycache__", "node_modules"}


# ---------- 作业包旧格式（自 learning_zone.py 原样移植，行为逐位一致） ----------

def parse_frontmatter(text):
    meta, body = {}, text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            for line in text[3:end].strip("\n").splitlines():
                if ":" not in line:
                    continue
                k, _, v = line.partition(":")
                k, v = k.strip(), v.strip()
                if v.startswith("[") and v.endswith("]"):
                    meta[k] = [i.strip().strip("'\"") for i in v[1:-1].split(",") if i.strip()]
                else:
                    meta[k] = v.strip("'\"")
            body = text[end + 4:]
    return meta, body


def set_status(text, new_status):
    """frontmatter 里替换或追加 status: 行；没有 frontmatter 就放在文件头。幂等。

    （与 learning_zone.py 原版唯一差异：status 行已是目标值时原版会误判成
    "没有 status 行" 而再插一条重复行；这里改为有 status 行就只替换，保证幂等。）
    """
    if re.search(r"(?m)^status:", text):
        return re.sub(r"(?m)^status:.*$", "status: " + new_status, text, count=1)
    if text.startswith("---\n"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[:end] + "\nstatus: " + new_status + text[end:]
    return "status: " + new_status + "\n" + text


def split_sections(body):
    """按协议三节切：题面/材料、我的作答、批改。"""
    m1 = re.search(r"(?m)^## 我的作答\s*$", body)
    m2 = re.search(r"(?m)^## 批改\s*$", body)
    task = body[: m1.start()] if m1 else body
    ans = body[m1.end(): m2.start() if m2 else len(body)].strip() if m1 else ""
    grade = body[m2.end():].strip() if m2 else ""
    return task, ans, grade


def unquote_block(ans_md):
    """把作答区的 '> ' 引用前缀还原成纯文本。"""
    return re.sub(r"(?m)^> ?", "", ans_md)


def parse_questions(task_md):
    """按 '### Q<n> · 题型' 切题；material 无题块则整段是材料。"""
    parts = re.split(r"(?m)^### (?=Q\d)", task_md)
    intro, qs = parts[0], []
    for p in parts[1:]:
        nl = p.find("\n")
        header, rest = p[:nl].strip(), p[nl + 1:].strip()
        num = re.match(r"Q(\d+)", header).group(1)
        qtype = header.split("·")[-1].strip() if "·" in header else "简答"
        qs.append((num, qtype, rest))
    return intro, qs


def quote_block(text):
    lines = text.replace("\r\n", "\n").strip().split("\n")
    return "\n".join("> " + l for l in lines) if lines and lines != [""] else "> （空）"


# ---------- 队列与计划（只读解析，供工作台/server 展示） ----------

def due_cards(queue_path):
    """读复习队列表格，返回今天（含逾期）到期的卡 [(主题, 链接, 下次复习)]，按计划日排序。"""
    today = date.today().isoformat()
    cards = []
    for line in Path(queue_path).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) != 7 or cells[0] == "主题" or set(cells[0]) <= set("-: "):
            continue
        topic, link, nxt, status = cells[0], cells[1], cells[4], cells[6]
        if status == "进行中" and nxt <= today:
            cards.append((topic, link, nxt))
    return sorted(cards, key=lambda c: c[2])


def parse_plan(plan_path):
    """读学习计划：frontmatter 指针 + '### 阶段'分块统计 '- [ ]/- [x]' 进度（行尾可带 '—— 注释'）。"""
    path = Path(plan_path) if plan_path else None
    if path is None or not path.is_file():
        return None
    meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    stages, cur = [], None
    done = total = 0
    for line in body.splitlines():
        if line.startswith("###"):
            cur = {"name": line.lstrip("# ").strip(), "done": 0, "total": 0}
            stages.append(cur)
        m = re.match(r"\s*-\s+\[( |x|X)\]\s", line)
        if m:
            d = 1 if m.group(1).lower() == "x" else 0
            done, total = done + d, total + 1
            if cur:
                cur["done"] += d
                cur["total"] += 1
    return {"meta": meta, "stages": stages, "done": done, "total": total,
            "pct": int(round(done / total * 100)) if total else 0}


# ---------- 路径安全 ----------

def safe_path(rel: str, *roots: Path) -> Path | None:
    """防目录穿越：rel 必须是相对路径，不含 ..、空段、反斜杠，且落在某个 root 内。

    逐个 root 拼接尝试，返回第一个通过校验的确切路径；全失败返回 None。
    """
    if not roots or not rel or "\\" in rel:
        return None
    if PurePosixPath(rel).is_absolute():
        return None
    if any(seg in ("", ".", "..") for seg in rel.split("/")):
        return None
    for root in roots:
        root = Path(root)
        try:
            cand = (root / rel).resolve()
            if cand.is_relative_to(root.resolve()):
                return cand
        except OSError:
            continue
    return None


# ---------- 批注侧车（<zone>/学习批注/<材料stem>.md） ----------

def _match_by_source(ann_dir, material_rel):
    """在批注目录里按 frontmatter source 找材料对应的侧车文件。"""
    for p in sorted(ann_dir.glob("*.md")):
        try:
            meta, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        except OSError:
            continue
        if meta.get("source", "") == material_rel:
            return p
    return None


def _annotation_path(ann_dir, material_rel, create=False):
    """定位材料的批注侧车文件；create=True 时给出可写路径（stem 冲突加 -2 后缀重试）。"""
    stem = Path(material_rel).stem
    direct = ann_dir / (stem + ".md")
    if direct.is_file():
        meta, _ = parse_frontmatter(direct.read_text(encoding="utf-8"))
        if meta.get("source", "") == material_rel:
            return direct
        hit = _match_by_source(ann_dir, material_rel)  # 同名不同源：按 source 扫全目录
        if hit is not None:
            return hit
        if not create:
            return None
        n = 2
        while (ann_dir / ("%s-%d.md" % (stem, n))).exists():
            n += 1
        return ann_dir / ("%s-%d.md" % (stem, n))
    return direct if create else _match_by_source(ann_dir, material_rel)


def _split_entries(text):
    """按 '## A<n> · 时间' 标题切条目，返回 [(id, ts, 条目正文)]（正文不含标题行）。"""
    heads = list(re.finditer(r"(?m)^## (A\d+) · (.+)$", text))
    out = []
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        out.append((m.group(1), m.group(2).strip(), text[m.end():end]))
    return out


def _parse_entry(body):
    """条目正文 → (quote, note)：首个连续 '> ' 块拼成 quote；ANNOT_MARK 之后到条目结束是 note。"""
    quote_lines = []
    for line in body.splitlines():
        if line.startswith(">"):
            quote_lines.append(re.sub(r"^> ?", "", line))
        elif quote_lines:
            break
    mk = body.find(ANNOT_MARK)
    note = body[mk + len(ANNOT_MARK):].strip() if mk != -1 else ""
    return "\n".join(quote_lines), note


def load_annotations(zone, material_rel):
    """读材料的批注：返回 {material, file, exists, entries:[{id,ts,quote,note}]}。

    匹配：先试 <stem>.md（frontmatter source 一致才认），不符则按 source 扫全目录。
    """
    ann_dir = Path(zone) / ANNOT_DIR
    path = _annotation_path(ann_dir, material_rel)
    if path is None:
        return {"material": material_rel, "file": None, "exists": False, "entries": []}
    _meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    entries = []
    for ann_id, ts, entry_body in _split_entries(body):
        quote, note = _parse_entry(entry_body)
        entries.append({"id": ann_id, "ts": ts, "quote": quote, "note": note})
    return {"material": material_rel, "file": str(path), "exists": True, "entries": entries}


def add_annotation(zone, material_rel, quote, note):
    """追加一条批注；侧车不存在则建档（frontmatter: title/date/tags/source）。返回新条目 dict。"""
    ann_dir = Path(zone) / ANNOT_DIR
    ann_dir.mkdir(parents=True, exist_ok=True)
    path = _annotation_path(ann_dir, material_rel, create=True)
    quote = quote.strip()[:QUOTE_MAX]
    note = note.strip()
    if path.is_file():
        text = path.read_text(encoding="utf-8")
        _meta, body = parse_frontmatter(text)
        last = max((int(i[1:]) for i, _ts, _b in _split_entries(body)), default=0)
        if text and not text.endswith("\n"):
            text += "\n"
        text += "\n"
    else:
        text = ("---\ntitle: 批注 · %s\ndate: %s\ntags: [%s]\nsource: %s\n---\n\n"
                % (path.stem, date.today().isoformat(), ANNOT_TAG, material_rel))
        last = 0
    ann_id = "A%d" % (last + 1)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    qblock = "\n".join("> " + l for l in quote.split("\n")) if quote else "> "
    text += "## %s · %s\n\n%s\n\n%s%s\n" % (ann_id, ts, qblock, ANNOT_MARK, note)
    path.write_text(text, encoding="utf-8")
    return {"file": str(path), "id": ann_id, "ts": ts, "quote": quote, "note": note}


def _entry_span(text, ann_id):
    """定位条目：返回 (标题 match, 条目结束位置)；找不到返回 (None, None)。"""
    m = re.search(r"(?m)^## %s · .*$" % re.escape(ann_id), text)
    if not m:
        return None, None
    nxt = re.search(r"(?m)^## A\d+ · ", text[m.end():])
    return m, (m.end() + nxt.start() if nxt else len(text))


def update_annotation(zone, material_rel, ann_id, note):
    """只改某条目的 note（ANNOT_MARK 起到条目结束）；条目不存在报 KeyError。"""
    path = _annotation_path(Path(zone) / ANNOT_DIR, material_rel)
    if path is None:
        raise KeyError("找不到材料的批注文件：%s" % material_rel)
    text = path.read_text(encoding="utf-8")
    m, end = _entry_span(text, ann_id)
    if m is None:
        raise KeyError("批注条目不存在：%s" % ann_id)
    body = text[m.end():end]
    mk = body.find(ANNOT_MARK)
    if mk != -1:
        nl = body.find("\n", mk)
        tail = body[nl:] if nl != -1 else ""  # 保留条目尾部的空行/下一条前的间隔
        new_body = body[:mk] + ANNOT_MARK + note.strip() + tail
    else:  # 条目里还没有 note 行：补一条
        new_body = body.rstrip("\n") + "\n\n" + ANNOT_MARK + note.strip() + "\n"
    text = text[:m.end()] + new_body + text[end:]
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text, encoding="utf-8")


def delete_annotation(zone, material_rel, ann_id):
    """整条删除（'## A<n>' 到下一个 '## A' 前）；删空后文件保留（只剩 frontmatter）。"""
    path = _annotation_path(Path(zone) / ANNOT_DIR, material_rel)
    if path is None:
        raise KeyError("找不到材料的批注文件：%s" % material_rel)
    text = path.read_text(encoding="utf-8")
    m, end = _entry_span(text, ann_id)
    if m is None:
        raise KeyError("批注条目不存在：%s" % ann_id)
    text = (text[:m.start()] + text[end:]).rstrip("\n") + "\n"
    path.write_text(text, encoding="utf-8")


# ---------- 番茄钟日志 ----------

def _new_log_text(zone, date_str):
    """新建学习日志内容：优先复制 90_模板/学习日志模板.md（替换日期占位），缺模板用最小骨架。"""
    tpl = Path(zone) / TEMPLATE_REL
    if tpl.is_file():
        return tpl.read_text(encoding="utf-8").replace("YYYY-MM-DD", date_str)
    return ("---\ntitle: 学习日志 %s\ndate: %s\ntags: [学习日志]\n---\n\n# 学习日志 %s\n"
            % (date_str, date_str, date_str))


def append_pomodoro(zone, minutes: int, label: str, start_hhmm: str, today=None) -> str:
    """向 学习日志/<日期>.md 追加一条番茄钟记录，绝不改动文件已有行；返回写入文件的相对路径。

    行格式：`- 14:32–14:57 · 25 min · <label>`（en-dash；结束时间 = 开始 + 分钟数，自动进位）。
    """
    zone = Path(zone)
    if today is None:
        today = date.today()
    if isinstance(today, str):
        today = date.fromisoformat(today)
    log_dir = zone / LOG_DIR
    log_dir.mkdir(parents=True, exist_ok=True)
    date_str = today.isoformat()
    log = log_dir / (date_str + ".md")
    if not log.exists():
        log.write_text(_new_log_text(zone, date_str), encoding="utf-8")
    h, m = (int(x) for x in start_hhmm.split(":"))
    end_total = h * 60 + m + int(minutes)
    line = "- %02d:%02d–%02d:%02d · %d min · %s" % (
        h, m, end_total // 60 % 24, end_total % 60, int(minutes), label.strip() or "（无标签）")
    text = log.read_text(encoding="utf-8")
    lines = text.split("\n")
    sec = next((i for i, l in enumerate(lines) if l.strip() == POMO_SECTION), None)
    if sec is None:  # 没有番茄钟节：在文件最末尾建节
        if text and not text.endswith("\n"):
            text += "\n"
        text += "\n" + POMO_SECTION + "\n\n" + line + "\n"
    else:  # 已有节：插到节内最后一个非空行之后，已有行原样保留
        j = sec + 1
        while j < len(lines) and not lines[j].startswith("## "):
            j += 1
        k = j - 1
        while k > sec and not lines[k].strip():
            k -= 1
        lines.insert(k + 1, line)
        text = "\n".join(lines)
    log.write_text(text, encoding="utf-8")
    return "%s/%s.md" % (LOG_DIR, date_str)


# ---------- 作业与阅读文件访问 ----------

def list_assignments(zone, dir_name):
    """列某个作业目录（待答题/已答待批/已批改）的 md 包，跳过 '_' 开头；frontmatter 缺省字段给空值。"""
    if dir_name not in ASSIGN_DIRS:
        raise ValueError("dir_name 必须是 %s 之一，收到：%r" % ("/".join(ASSIGN_DIRS), dir_name))
    d = Path(zone) / dir_name
    if not d.is_dir():
        return []
    out = []
    for p in sorted(d.glob("*.md")):
        if p.name.startswith("_"):
            continue
        try:
            meta, _body = parse_frontmatter(p.read_text(encoding="utf-8"))
        except OSError:
            meta = {}
        topics = meta.get("topics", [])
        topics = topics if isinstance(topics, list) else [topics]
        out.append({"file": p.name,
                    "title": meta.get("title", ""),
                    "type": meta.get("type", ""),
                    "topics": topics,
                    "status": meta.get("status", ""),
                    "date": meta.get("date", ""),
                    "mtime": date.fromtimestamp(p.stat().st_mtime).isoformat()})
    return out


def read_material(zone_or_vault_root, rel):
    """读任意允许的 md 原文（safe_path 校验防穿越）：返回 {path, title, md}。"""
    p = safe_path(rel, Path(zone_or_vault_root))
    if p is None:
        raise ValueError("路径不允许：%r" % rel)
    md = p.read_text(encoding="utf-8")
    meta, _body = parse_frontmatter(md)
    return {"path": str(p), "title": meta.get("title") or p.stem, "md": md}


def list_library(root, rel_dir=""):
    """浅层列库一层：{dirs:[...], files:[{path,title,mtime}], truncated}。

    只列子目录与 .md 文件，排除 .obsidian/.trash/.git/__pycache__/node_modules 及点开头项；
    单层超 200 项截断并置 truncated: True。
    """
    root = Path(root)
    base = root if rel_dir in ("", ".") else safe_path(rel_dir, root)
    if base is None:
        raise ValueError("路径不允许：%r" % rel_dir)
    if not base.is_dir():
        raise FileNotFoundError("目录不存在：%s" % base)
    dirs, files, truncated = [], [], False
    for p in sorted(base.iterdir(), key=lambda x: x.name):
        if p.name in EXCLUDE_DIRS or p.name.startswith("."):
            continue
        if len(dirs) + len(files) >= 200:
            truncated = True
            break
        if p.is_dir():
            dirs.append(p.name)
        elif p.is_file() and p.suffix == ".md":
            try:
                meta, _body = parse_frontmatter(p.read_text(encoding="utf-8"))
            except OSError:
                meta = {}
            files.append({"path": p.relative_to(root).as_posix(),
                          "title": meta.get("title") or p.stem,
                          "mtime": date.fromtimestamp(p.stat().st_mtime).isoformat()})
    return {"dirs": dirs, "files": files, "truncated": truncated}
