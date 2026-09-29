#!/usr/bin/env python3
"""复习队列调度器 — study-coach skill 的间隔重复引擎（SM-2 算法，Anki 同源）。

数据就是 vault 里的 markdown 表格（00_地图/复习队列.md），人可读可手改。
CLI 即 MCP 边界：默认输出人类可读文本，加 --json 得到结构化输出，
将来要给别的客户端用，包一层 MCP server 透传 JSON 即可。

算法（SM-2，四档评分，间隔自适应）：
  add   新卡：间隔 1 天，难易 2.5，次日到期
  again 忘了：打回 1 天，难易 -0.2，连对清零
  hard  勉强想起：间隔 ×1.2（至少 2 天），难易 -0.15
  good  正常想起：开局走 1→3→7（手册节奏），之后间隔 ×难易
  easy  秒答：开局 1→4、3→9，之后间隔 ×难易 ×1.3，难易 +0.15
  毕业线：间隔 ≥21 天且本次 good/easy → 状态毕业，退出队列
  难易系数（EF）范围 [1.3, 3.0]：越高说明这张卡对你越容易，间隔涨得越快；
  答得费劲它就变低（下次间隔更短）——间隔因此千人千卡，不再固定 1-3-7-21。

用法：
  scheduler.py due [--date YYYY-MM-DD] [--json]              今天（含逾期）该复习哪些
  scheduler.py add "主题" "[[链接]]" [--date D]                新增卡片（每日新卡 ≤5）
  scheduler.py advance "主题" again|hard|good|easy [--date D]  记录一次复习结果
  scheduler.py stats [--date D] [--json]                     队列统计
  scheduler.py plan-check [--hours-per-block 1.5] [--date D] [--json]  学习计划体检
（pass/fail 仍接受，分别是 good/again 的旧别名。）

队列/学习计划文件发现顺序：--file 显式指定 > --zone 目录（00_地图/ 优先，其次 zone 根）
> 从 cwd 逐级向上找 .obsidian 定位 vault（取其 00_地图/）> cwd（00_地图/ 优先，其次根）。
plan-check 找的是学习计划.md，同法；--file 只作用于队列。
"""

import argparse
import json
import math
import re
import sys
from datetime import date, timedelta
from pathlib import Path

QUEUE_NAME = "复习队列.md"
PLAN_NAME = "学习计划.md"
HEADER = ["主题", "链接", "间隔", "难易", "下次复习", "连对", "状态"]
EF_MIN, EF_MAX = 1.3, 3.0
EF_DEFAULT = 2.5
GRADUATE_AT = 21  # 间隔达到 21 天再通过 good/easy 即毕业
ACTIVE = "进行中"
DONE = "毕业"
RATINGS = {"again", "hard", "good", "easy"}
ALIASES = {"fail": "again", "pass": "good"}


def parse_day(s):
    try:
        return date.fromisoformat(s)
    except ValueError:
        sys.exit(f"错误：日期格式应为 YYYY-MM-DD，收到：{s}")


# ---------- 文件自动发现（--file > --zone > vault > cwd） ----------

def find_md_file(name, zone=None, cwd=None):
    """按发现顺序找约定文件，返回第一个存在的路径，都没有则 None。

    顺序：--zone（00_地图/ 优先，其次 zone 根）> cwd 逐级向上找 .obsidian
    定位 vault（取其 00_地图/）> cwd（00_地图/ 优先，其次根）。
    """
    cwd = Path(cwd) if cwd else Path.cwd()
    cands = []
    if zone:
        z = Path(zone)
        cands += [z / "00_地图" / name, z / name]
    for base in [cwd, *cwd.parents]:
        if (base / ".obsidian").is_dir():
            cands.append(base / "00_地图" / name)
            break
    cands += [cwd / "00_地图" / name, cwd / name]
    for c in cands:
        if c.is_file():
            return c
    return None


def queue_path(args):
    """解析队列文件：--file > 自动发现；都没有就报错并给 --file 用法示例。"""
    if args.file:
        p = Path(args.file)
        if not p.is_file():
            sys.exit(f"错误：--file 指定的文件不存在：{p}\n"
                     f"用法示例：scheduler.py --file /path/to/vault/00_地图/{QUEUE_NAME} due")
        return p
    p = find_md_file(QUEUE_NAME, zone=args.zone)
    if p:
        return p
    sys.exit(f"错误：没找到{QUEUE_NAME}。\n"
             f"用法示例：scheduler.py --file /path/to/vault/00_地图/{QUEUE_NAME} due\n"
             "或在 vault 目录下运行（自动向上找 .obsidian），或用 --zone 指定目录。")


def split_row(line):
    s = line.strip()
    if not (s.startswith("|") and s.endswith("|")):
        return None
    return [c.strip() for c in s.strip("|").split("|")]


def is_separator(cells):
    return all(set(c) <= set("-: ") for c in cells)


def load_queue(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    rows = []
    for i, line in enumerate(lines):
        cells = split_row(line)
        if cells is None or cells == HEADER or is_separator(cells) or len(cells) != len(HEADER):
            continue
        rows.append({"index": i, "cells": cells})
    return lines, rows


def row_str(cells):
    return "| " + " | ".join(cells) + " |"


def save_queue(path, lines):
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def insert_row(lines, cells):
    last = None
    for i, line in enumerate(lines):
        if line.strip().startswith("|"):
            last = i
    row = row_str(cells)
    if last is None:
        lines.append(row)
    else:
        lines.insert(last + 1, row)


def next_state(interval, ef, streak, rating):
    """SM-2 核心：返回 (新间隔, 新难易, 新连对)。毕业由调用方判。"""
    if rating == "again":
        return 1, max(EF_MIN, ef - 0.2), 0
    if rating == "hard":
        ni = 2 if interval <= 1 else max(2, round(interval * 1.2))
        return ni, max(EF_MIN, ef - 0.15), streak + 1
    if rating == "good":
        ni = 3 if interval <= 1 else (7 if interval <= 3 else round(interval * ef))
        return ni, ef, streak + 1
    if rating == "easy":
        ni = 4 if interval <= 1 else (9 if interval <= 3 else round(interval * ef * 1.3))
        return ni, min(EF_MAX, ef + 0.15), streak + 1
    sys.exit(f"错误：未知评分 {rating}")


def cmd_due(args):
    today = parse_day(args.date) if args.date else date.today()
    _lines, rows = load_queue(queue_path(args))
    due = []
    for r in rows:
        topic, link = r["cells"][0], r["cells"][1]
        next_date, status = r["cells"][4], r["cells"][6]
        if status != ACTIVE:
            continue
        try:
            d = date.fromisoformat(next_date)
        except ValueError:
            print(f"警告：『{topic}』的下次复习日期无法解析（{next_date}），请手改", file=sys.stderr)
            continue
        if d <= today:
            due.append({"主题": topic, "链接": link, "计划日": next_date, "逾期天数": (today - d).days})
    due.sort(key=lambda c: c["计划日"])
    if args.json:
        print(json.dumps({"date": today.isoformat(), "due": due}, ensure_ascii=False, indent=2))
        return
    if not due:
        print(f"{today} 没有到期的复习卡片。")
        return
    print(f"{today} 该复习 {len(due)} 张：")
    for c in due:
        overdue = f"（逾期 {c['逾期天数']} 天）" if c["逾期天数"] else ""
        print(f"  - {c['主题']}  {c['链接']}  计划日 {c['计划日']}{overdue}")


def cmd_add(args):
    today = parse_day(args.date) if args.date else date.today()
    path = queue_path(args)
    lines, rows = load_queue(path)
    if "|" in args.topic or "|" in args.link:
        sys.exit("错误：主题/链接不能含竖线 |（会破坏表格；链接请用纯 [[文件名]] 写法）。")
    if any(r["cells"][0] == args.topic for r in rows):
        sys.exit(f"错误：队列里已有『{args.topic}』，换个主题名，或直接手改那张卡。")
    next_date = (today + timedelta(days=1)).isoformat()
    insert_row(lines, [args.topic, args.link, "1", str(EF_DEFAULT), next_date, "0", ACTIVE])
    save_queue(path, lines)
    print(f"已添加：{args.topic} {args.link}，下次复习 {next_date}（间隔 1 天，难易 {EF_DEFAULT}）。")


def cmd_advance(args):
    today = parse_day(args.date) if args.date else date.today()
    path = queue_path(args)
    rating = ALIASES.get(args.result, args.result)
    lines, rows = load_queue(path)
    for r in rows:
        cells = r["cells"]
        if cells[0] != args.topic:
            continue
        if cells[6] == DONE:
            sys.exit(f"『{args.topic}』已毕业。想重学请手改：状态={ACTIVE}、间隔=1、难易={EF_DEFAULT}、日期=明天。")
        try:
            interval, ef = int(cells[2]), float(cells[3])
        except ValueError:
            sys.exit(f"『{args.topic}』的间隔/难易列不是数字（{cells[2]}/{cells[3]}），请手改后重试。")
        try:
            streak = int(cells[5])
        except ValueError:
            streak = 0
        interval, ef, streak = next_state(interval, ef, streak, rating)
        if interval >= GRADUATE_AT and rating in ("good", "easy"):
            cells[2], cells[3], cells[5] = str(interval), str(ef), str(streak)
            cells[4], cells[6] = "—", DONE
            lines[r["index"]] = row_str(cells)
            save_queue(path, lines)
            print(f"🎉 {args.topic} 间隔已达 {interval} 天且通过，毕业！（难易定格 {ef}）")
        else:
            next_date = (today + timedelta(days=interval)).isoformat()
            cells[2], cells[3], cells[4], cells[5] = str(interval), str(ef), next_date, str(streak)
            lines[r["index"]] = row_str(cells)
            save_queue(path, lines)
            print(f"已记录：{args.topic} [{rating}] → 间隔 {interval} 天，难易 {ef}，下次复习 {next_date}。")
        return
    sys.exit(f"错误：队列里没有『{args.topic}』。用 add 先加入，或检查主题名是否一字不差。")


def cmd_stats(args):
    day = parse_day(args.date) if args.date else date.today()
    _lines, rows = load_queue(queue_path(args))
    by_status, due_count, efs = {}, 0, []
    for r in rows:
        status = r["cells"][6]
        by_status[status] = by_status.get(status, 0) + 1
        if status == ACTIVE:
            try:
                efs.append(float(r["cells"][3]))
                if date.fromisoformat(r["cells"][4]) <= day:
                    due_count += 1
            except ValueError:
                pass
    avg_ef = round(sum(efs) / len(efs), 2) if efs else 0
    summary = {"date": day.isoformat(), "总数": len(rows), "到期": due_count,
               "平均难易": avg_ef, "按状态": by_status}
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    print(f"截至 {day}：共 {len(rows)} 张，今日到期 {due_count} 张，平均难易 {avg_ef}，" +
          "，".join(f"{k} {v}" for k, v in by_status.items()))


# ---------- 学习计划体检（plan-check） ----------

def _split_frontmatter(text):
    """轻量 frontmatter 解析（与 app.zonefs 同源逻辑；scheduler 不 import app 包，两入口零耦合）。"""
    meta, body = {}, text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            for line in text[3:end].strip("\n").splitlines():
                if ":" not in line:
                    continue
                k, _, v = line.partition(":")
                meta[k.strip()] = v.strip().strip("'\"")
            body = text[end + 4:]
    return meta, body


def plan_check(plan_path, hours_per_block=1.5, today=None):
    """学习计划体检：剩余块 × 单块时长外推完成日期，对 frontmatter 期限算滞后天数。

    可 import 的纯函数（server.py 将来直接用），不打印、不写文件：
    {deadline, days_left, blocks_left, est_hours, weekly_hours, eta_days,
     eta_date, lag_days, total_blocks, done_blocks}
    """
    if today is None:
        today = date.today()
    meta, body = _split_frontmatter(Path(plan_path).read_text(encoding="utf-8"))
    done = left = 0
    for line in body.splitlines():
        m = re.match(r"\s*-\s+\[( |x|X)\]\s", line)
        if m:
            if m.group(1).lower() == "x":
                done += 1
            else:
                left += 1
    try:
        weekly = float(meta.get("weekly_hours", 8))
    except (TypeError, ValueError):
        weekly = 8.0
    if weekly <= 0:
        weekly = 8.0
    deadline = None
    raw = str(meta.get("deadline", "")).strip()
    if raw:
        try:
            deadline = date.fromisoformat(raw)
        except ValueError:
            pass
    est_hours = round(left * hours_per_block, 2)
    eta_days = math.ceil(est_hours / weekly) * 7  # 按整周向上取整
    eta_date = today + timedelta(days=eta_days)
    days_left = (deadline - today).days if deadline else None
    lag_days = max(0, (eta_date - deadline).days) if deadline else 0
    return {"deadline": deadline.isoformat() if deadline else None,
            "days_left": days_left, "blocks_left": left, "est_hours": est_hours,
            "weekly_hours": weekly, "eta_days": eta_days, "eta_date": eta_date.isoformat(),
            "lag_days": lag_days, "total_blocks": done + left, "done_blocks": done}


def cmd_plan_check(args):
    today = parse_day(args.date) if args.date else date.today()
    path = find_md_file(PLAN_NAME, zone=args.zone)
    if not path:
        sys.exit(f"错误：没找到{PLAN_NAME}。在 vault/zone 目录下运行，或用 --zone 指定目录。")
    r = plan_check(path, hours_per_block=args.hours_per_block, today=today)
    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return
    if r["deadline"]:
        print(f"剩余 {r['blocks_left']}/{r['total_blocks']} 块 ≈ {r['est_hours']:g} h"
              f"（每周 {r['weekly_hours']:g} h，截止 {r['deadline']}，余 {r['days_left']} 天）")
    else:
        print(f"剩余 {r['blocks_left']}/{r['total_blocks']} 块 ≈ {r['est_hours']:g} h"
              f"（每周 {r['weekly_hours']:g} h，未设截止期限）")
    eta_mmdd = r["eta_date"][5:]  # ISO 日期取 MM-DD
    if r["deadline"] is None:
        print(f"按当前节奏预计 {eta_mmdd} 完成（未设截止期限）")
    elif r["lag_days"] > 0:
        print(f"滞后 {r['lag_days']} 天：考虑每周加时或砍块，写进计划变更记录")
    else:
        print(f"按当前节奏预计 {eta_mmdd} 完成，不滞后（余 {r['days_left']} 天）")


def main():
    p = argparse.ArgumentParser(description="SM-2 复习队列调度器 + 学习计划体检")
    p.add_argument("--file", default=None, help="队列 markdown 文件路径（默认自动发现）")
    p.add_argument("--zone", default=None, help="工作区目录（在其 00_地图/ 下找队列与学习计划）")
    sub = p.add_subparsers(dest="cmd", required=True)

    due = sub.add_parser("due", help="列出今天该复习的卡片")
    due.add_argument("--date", help="以该日期为准（默认今天）")
    due.add_argument("--json", action="store_true", help="输出 JSON（MCP 边界）")
    due.set_defaults(fn=cmd_due)

    add = sub.add_parser("add", help="新增卡片，次日到期")
    add.add_argument("topic")
    add.add_argument("link")
    add.add_argument("--date", help="以该日期为准（默认今天）")
    add.set_defaults(fn=cmd_add)

    adv = sub.add_parser("advance", help="记录一次复习结果（again/hard/good/easy）")
    adv.add_argument("topic")
    adv.add_argument("result", choices=["again", "hard", "good", "easy", "pass", "fail"])
    adv.add_argument("--date", help="以该日期为准（默认今天）")
    adv.set_defaults(fn=cmd_advance)

    st = sub.add_parser("stats", help="队列统计")
    st.add_argument("--date", help="以该日期为准（默认今天）")
    st.add_argument("--json", action="store_true", help="输出 JSON（MCP 边界）")
    st.set_defaults(fn=cmd_stats)

    pc = sub.add_parser("plan-check", help="学习计划体检：剩余块外推完成日，对期限算滞后")
    pc.add_argument("--hours-per-block", type=float, default=1.5, help="每块预估小时数（默认 1.5）")
    pc.add_argument("--date", help="以该日期为准（默认今天）")
    pc.add_argument("--json", action="store_true", help="输出 JSON（MCP 边界）")
    pc.set_defaults(fn=cmd_plan_check)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
