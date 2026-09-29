#!/usr/bin/env python3
"""学习工作台 — study-coach skill 的入口薄壳（服务逻辑全在 app/server.py）。

与 zcode 的协议（文件即数据库，Obsidian 全程可读可改）：
  zcode 出题/写资料  →  <zone>/待答题/*.md      (frontmatter status: pending)
  学生在本软件作答   →  移入 <zone>/已答待批/   (status: answered)
  zcode 批改写回     →  移入 <zone>/已批改/    (status: graded)
  学生回来看批改，按 zcode 写的「下一步」行动 → 循环

用法（.command 启动脚本同款）：
  python3 learning_zone.py --zone <目录> --port 8765 --open-browser
优雅退出：Ctrl+C、SIGTERM，或页面「退出工作台」（POST /shutdown）。
只监听 127.0.0.1，不对局域网开放。
"""

import argparse
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

import server  # noqa: E402  JSON API + 静态文件服务端

DIRS = ("待答题", "已答待批", "已批改")


def main():
    ap = argparse.ArgumentParser(description="学习工作台（study-coach 异步答题软件）")
    ap.add_argument("--zone", default=".", help="学习工作区目录（含 待答题/已答待批/已批改）")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--open-browser", action="store_true")
    args = ap.parse_args()

    zone = Path(args.zone).resolve()
    if not zone.is_dir():
        sys.exit("工作区不存在：%s" % zone)
    for d in DIRS:  # 全新 zone 也直接可用
        (zone / d).mkdir(exist_ok=True)
    server.serve(zone, args.port, open_browser=args.open_browser)


if __name__ == "__main__":
    main()
