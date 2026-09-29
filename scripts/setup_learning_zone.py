#!/usr/bin/env python3
"""setup-learning-zone：在当前学习文件夹初始化/升级学习工作台（study-coach skill）。

用法（"已学习文件夹为工作目录"——cd 到学习文件夹后运行，或用 --zone 指定）：
  python3 ~/.agents/skills/study-coach/scripts/setup_learning_zone.py [--zone 目录] [--port 8765] [--upgrade]

两种模式：
- 默认（首装）：搭好全套目录与说明文件
- --upgrade（软件大版本升级后）：只刷新生成物，不动学生内容
  · 总是重写：学习工作台.md、启动学习工作台.command
  · 待答题/_格式示例.md：仅当内容与模板不同才覆盖（首装则只在缺失时写）
  · 学习计划.md 与三个作业目录：绝不触碰（学习计划可能已访谈填实）
  · 两种模式都会创建 学习批注/（阅读器高亮批注的落地目录）

做六件事：
1. 创建 待答题/ 已答待批/ 已批改/ 学习批注/ 目录，并写 待答题/_格式示例.md（zcode 出题的协议样例）
2. 生成 学习工作台.md（功能说明 + 配置，Obsidian 可读可改）
3. 生成一键启动脚本 启动学习工作台.command（chmod +x，Finder 双击即用）
4. 生成 学习计划.md 骨架（全局规划：目标/期限/路线 checklist/当前指针；vault 内放 00_地图/，否则 zone 根）
5. 打印 zcode 收尾清单（zone 在 vault 内时：更新写作规范目录树、MOC 挂链、计划访谈填实、像素字体检查）
"""

import argparse
import datetime
import sys
from pathlib import Path

SKILL_APP = Path(__file__).resolve().parent.parent / "app" / "learning_zone.py"

FORMAT_EXAMPLE = """---
title: 格式示例 · 矩阵=机器第一次拷问
date: 2026-09-28
type: quiz
topics: [矩阵]
links: ["[[数学课_第01课_矩阵机器与逐步猜]]"]
status: pending
---

### Q1 · 简答
用你自己的话说说：矩阵为什么是"机器"？它的"输入"和"输出"各是什么？

### Q2 · 计算
设 A = [[1, 2], [3, 4]]，求 A 作用在向量 [2, 1] 上的结果（写出步骤）。

## 我的作答

（未作答）

## 批改

（待批改）
"""

README_TMPL = """---
title: 学习工作台
date: {today}
tags: [学习方法, 工作台]
aliases: [工作台]
---

# 学习工作台

你的学习根据地：答题、读材料、记批注、攒经验值，都在这一个页面里。
**启动方式：Finder 双击 `启动学习工作台.command`**，浏览器会自动打开 http://127.0.0.1:{port} —— 不用装软件，也不用敲命令。

## 每天怎么用（三步循环：zcode 出包 → 这里作答 → 回 zcode 喊批改）

1. **zcode 出包**：作业包（题目或学习材料）写进 `待答题/`
2. **这里作答**：打开工作台，一份作业包里按 Q1、Q2…… 逐题作答，提交；读材料时随手选中文字写批注
3. **回 zcode 喊批改**：说一声「批改」就行——批改写回文件、更新复习队列/错题本/学习日志，并告诉你下一步；回工作台刷新，`已批改/` 里看结果，`待答题/` 里收新作业包

## 功能地图

- **作业（三箱流转）**：`待答题/` → `已答待批/` → `已批改/`。作答以 `> ` 引用格式写回原文件，笔记结构不会被破坏；`待答题/_格式示例.md` 是协议样例，出题格式以它为准。
- **阅读器（边读边批）**：左边学习材料、右边批注栏。选中一段文字就能写批注，批注自动落到 `学习批注/<材料名>.md`，在 Obsidian 里可以直接打开翻看；页面上还有「在 Obsidian 打开」按钮一键跳转。
- **番茄钟**：页面右上角的 25 分钟专注 + 5 分钟休息计时，结束后自动记进当天的学习日志。
- **仪表盘**：首页一眼看全——今日到期复习卡、学习计划的进度与倒计时、每日一条学习科学小贴士、你的 XP 等级与连续学习天数。

## 数据都在哪

**你的所有进度都存在这个文件夹的 Markdown 文件里**：作答、批改、批注、番茄钟记录、XP，全是你打开就能看的笔记（用 Obsidian 直接看也行）。工作台软件只是个「壳」——删掉软件、换台电脑重装，文件在，进度就在，不会丢。

## 常见问题

- **怎么退出？** 点页面右上角「退出工作台」按钮，或在启动它的终端按 Ctrl+C。都是优雅退出，进度早已写进文件，随时可关。
- **怎么换深色/浅色主题？** 页头 🌓 按钮切换，会记住你的选择（第一次跟随系统配色）。
- **打不开，或提示端口被占用？** 软件只监听本机 127.0.0.1:{port}，不联外网。端口被占用多半是上一次没退干净——关掉旧窗口再双击试试；还不行就找 zcode 换个端口重新初始化。

## 配置（zcode 维护，平时不用动）

- zone 根：{zone}
- 端口：{port}
- 软件：{app}（skill 升级即自动生效，本目录不存代码）
- 联动：首页读取 `00_地图/复习队列.md` 的今日到期卡与 `00_地图/学习计划.md` 的计划面板（zone 不在 vault 内时，改读 zone 根的同名文件）
"""

PLAN_TMPL = """---
title: 学习计划
goal: 【待访谈】一句话总目标
deadline: 【待访谈】YYYY-MM-DD
weekly_hours: 【待访谈】
current_stage: 【待访谈】
current_item: "【待访谈】"
next_item: "【待访谈】"
created: {today}
updated: {today}
tags: [地图, 学习计划]
aliases: [全局规划]
---

# 学习计划（全局）

> **开场自检第一站**：每个 zcode 会话先读「路线与进度」再干活，不问"上次学到哪"。
> 维护方：zcode（批改收尾打勾挪指针，周日复盘核对期限）；学生只读，软件首页只读展示本文件。

## 目标与节奏

- **总目标**：【待访谈 zcode 填】
- **截止**：【待访谈】
- **每周可投入**：【待访谈】小时
- **每日最小闭环**：晨间默写 3-5 min → 白天工作台答题 → 收尾批改 2-3 min
- **周节奏**：周六费曼日 · 周日复盘

## 路线与进度

> zcode 把学习路线拆成带 `- [ ]` 的分级行（vault 有阅读路线图就照抄条目）；「← 当前」随进度挪动。

### 阶段一（→ 日期待谈）

- [ ] [[条目一]]
- [ ] [[条目二]]

### 阶段二（→ 日期待谈）

- [ ] [[条目三]]

## 变更记录

- {today} 建计划（setup 生成骨架，待计划访谈填实）
"""

BASH_TMPL = """#!/bin/bash
# 学习工作台一键启动（由 study-coach skill 的 setup_learning_zone.py 生成）
# 优雅退出：本窗口 Ctrl+C，或网页右上角「退出工作台」按钮
cd "$(dirname "$0")"
exec python3 "{app}" --zone "{zone}" --port {port} --open-browser
"""


def find_vault(start):
    for p in [start, *start.parents]:
        if (p / ".obsidian").is_dir():
            return p
    return None


def main():
    ap = argparse.ArgumentParser(description="初始化/升级学习工作台（异步答题循环）")
    ap.add_argument("--zone", default=".", help="学习文件夹（默认当前目录）")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--upgrade", action="store_true",
                    help="升级模式：刷新生成物（说明/启动脚本/格式示例），不动学习计划与学生内容")
    args = ap.parse_args()

    zone = Path(args.zone).resolve()
    if not zone.is_dir():
        sys.exit("错误：学习文件夹不存在：%s" % zone)
    if not SKILL_APP.is_file():
        sys.exit("错误：找不到软件本体 %s（skill 安装不完整）" % SKILL_APP)

    today = datetime.date.today().isoformat()

    # 四个目录都只 mkdir exist_ok，绝不写内容（学生作答、批注都在里面）
    for d in ("待答题", "已答待批", "已批改", "学习批注"):
        (zone / d).mkdir(exist_ok=True)

    # _格式示例.md：首装只在缺失时写（保持现状）；升级时内容与模板不同才覆盖（相同则不碰，避免无谓 mtime 变化）
    fmt = zone / "待答题" / "_格式示例.md"
    if not fmt.exists():
        fmt.write_text(FORMAT_EXAMPLE, encoding="utf-8")
    elif args.upgrade:
        try:
            same = fmt.read_text(encoding="utf-8") == FORMAT_EXAMPLE
        except UnicodeDecodeError:  # 编码损坏也视为不一致，按模板恢复
            same = False
        if not same:
            fmt.write_text(FORMAT_EXAMPLE, encoding="utf-8")
            print("格式示例与最新模板不一致，已刷新：%s" % fmt)

    # 学习工作台.md：纯生成物——首装缺失才写（保持现状），升级总是重写（幂等）
    readme = zone / "学习工作台.md"
    if args.upgrade or not readme.exists():
        readme.write_text(
            README_TMPL.format(today=today, zone=zone, port=args.port, app=SKILL_APP),
            encoding="utf-8")
        if args.upgrade:
            print("说明文件已按新版本重写：%s" % readme)
    else:
        print("说明文件已存在，未改动：%s" % readme)

    # 一键启动脚本：两种模式都总是重写（内容只依赖 zone/port/app 路径，天然幂等）
    cmd = zone / "启动学习工作台.command"
    cmd.write_text(BASH_TMPL.format(app=SKILL_APP, zone=zone, port=args.port), encoding="utf-8")
    cmd.chmod(0o755)

    # 学习计划：两种模式都只在缺失时生成骨架，已存在绝不触碰（可能已访谈填实）
    vault = find_vault(zone)
    plan_path = (vault / "00_地图" / "学习计划.md") if vault else (zone / "学习计划.md")
    if plan_path.exists():
        print("学习计划已存在，未改动：%s" % plan_path)
    else:
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(PLAN_TMPL.format(today=today), encoding="utf-8")
        print("已生成学习计划骨架（全局规划，待 zcode 计划访谈填实）：%s" % plan_path)

    print("✅ 学习工作台%s完成：%s" % ("升级" if args.upgrade else "初始化", zone))
    print("   - 目录：待答题/ 已答待批/ 已批改/ 学习批注/")
    print("   - 说明：学习工作台.md（功能地图与配置）")
    print("   - 一键启动：双击 启动学习工作台.command（端口 %d）" % args.port)
    print("   - 优雅退出：网页右上「退出工作台」或 Ctrl+C，进度都在 Obsidian")
    if args.upgrade:
        print("   - 升级模式：学习计划与学生内容未被改动")
    if vault:
        print("\n⚠️ zone 在 Obsidian vault 内（%s），请回 zcode 完成收尾：" % vault)
        print("   1. 把 待答题/ 已答待批/ 已批改/ 三个目录写进 00_地图/写作规范.md 的目录树")
        print("   2. 把 [[学习工作台]] 与 [[学习计划]] 登记进文件名登记表，并在总览 MOC 导航挂链")
        print("   3. 计划访谈：与学生把 00_地图/学习计划.md 填实（目标/期限/路线/当前指针）")
        print("   4. 写作规范目录树补 `学习批注/` 一行；建议加一句：学习批注/、学习日志/ 内文件为工作台动态生成，登记到目录级即可，不逐个登记")
        print("   5. 若像素字体缺失（app/static/fonts/ 为空），跑 scripts/fetch_pixel_font.sh 下载（无网络则自动降级系统等宽字体，功能不受影响）")
    else:
        print("\n（zone 不在 Obsidian vault 内：软件仍可用，复习卡/计划面板改读 zone 根的同名文件）")


if __name__ == "__main__":
    main()
