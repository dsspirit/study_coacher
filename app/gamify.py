#!/usr/bin/env python3
"""游戏化统计 — study-coach skill 的激励层（纯函数，零第三方依赖）。

数据照旧全在 markdown 里：已批改作业计数、学习日志的「## 番茄钟」节、
以及一张贴士库表格（| id | 原理 | 一句话 | 怎么做 | 领域 |）。
只做只读统计与随机抽贴士，不写任何文件。
"""

import random
import re
from datetime import date, timedelta
from pathlib import Path

POMO_SECTION = "## 番茄钟"
POMO_LINE = re.compile(r"^- .* min · ")  # 例：- 14:32–14:57 · 25 min · 默写
# 称号表：取 ≤level 的最大档
TITLES = [(1, "新手村居民"), (5, "见习骑士"), (10, "领悟者"), (15, "大法师学徒"), (20, "出师")]


def load_tips(path):
    """解析贴士库 md 表格（表头固定：| id | 原理 | 一句话 | 怎么做 | 领域 |）。

    每行一条 {id,name,line,how,domain}；非表格行、表头、分隔线、列数不对的坏行一律跳过。
    """
    p = Path(path)
    if not p.is_file():
        return []
    tips = []
    for line in p.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not (s.startswith("|") and s.endswith("|")):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) != 5 or cells[0] == "id" or set(cells[0]) <= set("-: "):
            continue
        tips.append({"id": cells[0], "name": cells[1], "line": cells[2],
                     "how": cells[3], "domain": cells[4]})
    return tips


def tip_of_day(tips, date_str):
    """当日贴士：按日期字符码点和取模，同一天永远同一条；空库返回 None。"""
    if not tips:
        return None
    return tips[sum(ord(c) for c in date_str) % len(tips)]


def tip_random(tips, domain=None):
    """随机抽一条；给了 domain 先过滤，过滤后为空则回退全池；全池也空返回 None。"""
    pool = [t for t in tips if t.get("domain") == domain] if domain else list(tips)
    if not pool:
        pool = tips
    return random.choice(pool) if pool else None


def _pomodoro_count(text):
    """数一段 markdown 里 '## 番茄钟' 节内形如 '- … min · …' 的行数（节外不算）。"""
    count, in_sec = 0, False
    for line in text.splitlines():
        if line.strip() == POMO_SECTION:
            in_sec = True
            continue
        if in_sec and line.startswith("## "):
            break
        if in_sec and POMO_LINE.match(line):
            count += 1
    return count


def _log_dates(log_dir):
    """日志目录里按文件名（YYYY-MM-DD.md）能解析出的日期集合；非日期命名的文件忽略。"""
    dates = set()
    if not log_dir.is_dir():
        return dates
    for p in log_dir.glob("*.md"):
        try:
            dates.add(date.fromisoformat(p.stem))
        except ValueError:
            continue
    return dates


def _read_safe(path):
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError:
        return ""


def gamify_stats(graded_dir, log_dir, today):
    """汇总学习游戏化数值：xp/等级/称号/连击/批改数/番茄钟数。

    xp = 已批改作业 ×30 + 有日志天数 ×10 + 番茄钟总数 ×10；
    每升一级需 100 xp；streak 从今天（不在则从昨天）逐日回退数连续有日志的天数。
    """
    graded_dir, log_dir = Path(graded_dir), Path(log_dir)
    graded = (len([p for p in graded_dir.glob("*.md") if not p.name.startswith("_")])
              if graded_dir.is_dir() else 0)
    logs = sorted(log_dir.glob("*.md")) if log_dir.is_dir() else []
    pomos_total = sum(_pomodoro_count(_read_safe(p)) for p in logs)
    today_text = _read_safe(log_dir / (today.isoformat() + ".md"))
    pomos_today = _pomodoro_count(today_text)
    dates = _log_dates(log_dir)
    log_days = len(dates)
    xp = graded * 30 + log_days * 10 + pomos_total * 10
    level = 1 + xp // 100
    title = TITLES[0][1]
    for lv, name in TITLES:
        if lv <= level:
            title = name
    streak = 0
    d = today if today in dates else today - timedelta(days=1)
    while d in dates:
        streak += 1
        d -= timedelta(days=1)
    return {"xp": xp, "level": level, "title": title, "next_at": level * 100,
            "streak": streak, "graded": graded,
            "pomos_today": pomos_today, "pomos_total": pomos_total}
