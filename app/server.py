#!/usr/bin/env python3
"""学习工作台服务端 — JSON API + 静态文件（SPA），零第三方依赖。

只做三件事：服务 app/static 下的前端静态文件、提供 /api/* JSON 接口、
处理 POST /shutdown 优雅退出。不再产出任何业务 HTML。
所有文件协议逻辑（作业三目录、批注侧车、番茄钟日志、计划/队列解析、
路径安全）从 zonefs 复用；游戏化数值从 gamify 复用；计划体检复用
scripts/scheduler.plan_check——本文件不重复实现协议。

约定：
  成功 {"ok": true, ...}；失败 {"ok": false, "error": 中文可读原因} + 4xx/5xx。
  写操作（提交作答/批注/番茄钟）统一持 FILE_LOCK，避免并发写坏文件。
  POST/PUT/DELETE 校验 Origin/Referer 为空或指向本机端口，防跨站驱动浏览器。
只监听 127.0.0.1，不对局域网开放。
"""

import json
import re
import signal
import sys
import threading
import webbrowser
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

APP_DIR = Path(__file__).resolve().parent
SKILL_DIR = APP_DIR.parent                # study-coach skill 根（app/ 的上级）
STATIC_DIR = APP_DIR / "static"           # 前端产物（可能尚未安装）
TIPS_PATH = SKILL_DIR / "assets" / "science_tips.md"  # 贴士库（可能不存在）

sys.path.insert(0, str(APP_DIR))
sys.path.insert(0, str(SKILL_DIR / "scripts"))  # 复用 scheduler.plan_check（纯函数）

import zonefs   # noqa: E402
import gamify   # noqa: E402
from scheduler import plan_check  # noqa: E402

VERSION = "2.0"

# 浏览器不请自来要的图标（终端日志里曾经的三个 404）：别名到 static/icons/
FAVICON_ALIASES = {
    "/favicon.ico": "icons/favicon-32.png",
    "/apple-touch-icon.png": "icons/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png": "icons/apple-touch-icon.png",
}
ZONE = Path.cwd()      # 以下全局态由 WorkbenchServer()/serve() 赋值
PORT = 8765
VAULT = None           # vault 根：自 zone 向上找 .obsidian 的父目录；找不到 = None
VAULT_NAME = None
SERVER = None          # ThreadingHTTPServer 实例（/shutdown 与信号退出用）
FILE_LOCK = threading.Lock()


# ---------- 启动 ----------

def vault_root_of(zone: Path):
    """自 zone（含自身）逐级向上找 .obsidian，返回其父目录；找不到返回 None。"""
    for p in [zone, *zone.parents]:
        if (p / ".obsidian").is_dir():
            return p
    return None


def WorkbenchServer(zone: Path):
    """组装工作台服务：绑定全局状态，返回未 start 的 ThreadingHTTPServer。"""
    global ZONE, VAULT, VAULT_NAME, SERVER
    ZONE = zone
    VAULT = vault_root_of(zone)
    VAULT_NAME = VAULT.name if VAULT else None
    SERVER = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    return SERVER


def serve(zone: Path, port: int, open_browser: bool = False):
    """入口主循环：绑 127.0.0.1、注册信号、可选延时 0.6s 开浏览器，阻塞到退出。"""
    global PORT
    PORT = port
    srv = WorkbenchServer(zone)

    def graceful(signum, _frame):
        print("\n收到退出信号（%s），正在优雅退出…" % signum)
        threading.Thread(target=srv.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, graceful)
    signal.signal(signal.SIGINT, graceful)

    url = "http://127.0.0.1:%d" % PORT
    print("📚 学习工作台已启动：%s   （zone：%s）" % (url, ZONE))
    print("   优雅退出：终端 Ctrl+C，或页面「退出工作台」（POST /shutdown）。")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    finally:
        srv.server_close()
    print("👋 工作台已退出。所有进度都在 Obsidian 里，没有丢失的东西。")


# ---------- 通用工具 ----------

def _as_list(v):
    """frontmatter 标量/列表统一成列表（与 zonefs.list_assignments 同规则）。"""
    return v if isinstance(v, list) else [v]


def _data_file(name):
    """约定数据文件（学习计划.md/复习队列.md）定位：zone 在 vault 内 → vault/00_地图/ 优先，
    否则 zone 根（沿用旧 find_plan 的候选顺序）。都没有返回 None。"""
    cands = ([VAULT / "00_地图" / name] if VAULT else []) + [ZONE / name]
    for c in cands:
        if c.is_file():
            return c
    return None


def obsidian_url(target):
    """vault 相对/绝对路径 → obsidian://open URL（去 .md 后缀，保留子目录斜线）；
    无 vault 或不在 vault 内返回 None。"""
    if not VAULT:
        return None
    p = Path(target)
    try:
        rel = p.relative_to(VAULT).as_posix() if p.is_absolute() else p.as_posix()
    except ValueError:
        return None
    return "obsidian://open?vault=%s&file=%s" % (quote(VAULT_NAME), quote(rel.removesuffix(".md")))


def _attach_plan_items(parsed, plan_md):
    """给 zonefs.parse_plan 的 stages 补 items 明细（parse_plan 只统计数量）。
    小节/勾选框的行规则与 zonefs.parse_plan 一致；'###' 之前的散块不归属任何阶段。"""
    for s in parsed["stages"]:
        s["items"] = []
    _meta, body = zonefs.parse_frontmatter(plan_md)
    idx = -1
    for line in body.splitlines():
        if line.startswith("###"):
            idx += 1
            continue
        m = re.match(r"\s*-\s+\[( |x|X)\]\s(.*)$", line)
        if m and 0 <= idx < len(parsed["stages"]):
            parsed["stages"][idx]["items"].append(
                {"text": m.group(2).strip(), "done": m.group(1).lower() == "x"})
    return parsed


# ---------- HTTP Handler ----------

class Handler(BaseHTTPRequestHandler):
    """按路由表分发；静态文件与首页在 _route 里特判。"""

    STATIC_TYPES = {"html": "text/html; charset=utf-8", "css": "text/css; charset=utf-8",
                    "js": "application/javascript; charset=utf-8", "woff2": "font/woff2",
                    "svg": "image/svg+xml", "png": "image/png"}

    def log_message(self, fmt, *args):
        pass  # 安静基类日志；下面 _send 里有自己的单行 access log

    # -- 发送与解析 --

    def _send(self, status, ctype, data, extra=()):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)
        print("%s %s → %d" % (self.command, self.path, status))  # access log，一行一个请求

    def _json(self, obj, status=200):
        self._send(status, "application/json; charset=utf-8",
                   json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _ok(self, **kw):
        self._json({"ok": True, **kw})

    def _fail(self, status, msg):
        self._json({"ok": False, "error": msg}, status)

    def _html(self, text, status=200):
        self._send(status, "text/html; charset=utf-8", text.encode("utf-8"))

    def _read_json(self):
        """读 body 并解析 JSON 对象；坏 JSON/超限返回 None（错误响应已发出）。"""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._fail(400, "Content-Length 非法")
            return None
        if n > 1048576:
            self._fail(400, "请求体过大（>1MB）")
            return None
        raw = self.rfile.read(n) if n > 0 else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._fail(400, "请求体不是合法 JSON")
            return None
        if not isinstance(data, dict):
            self._fail(400, "请求体应是 JSON 对象")
            return None
        return data

    def _origin_ok(self):
        """写方法防跨站：Origin/Referer 为空（CLI/curl）或 host 是本机端口才放行。"""
        allowed = {"127.0.0.1:%d" % PORT, "localhost:%d" % PORT}
        for h in (self.headers.get("Origin"), self.headers.get("Referer")):
            if h and urlparse(h).netloc not in allowed:
                return False
        return True

    # -- 分发 --

    def _route(self):
        parsed = urlparse(self.path)
        path, qs = parsed.path, parse_qs(parsed.query, keep_blank_values=True)
        try:
            if self.command != "GET" and not self._origin_ok():
                return self._fail(403, "跨站请求被拒绝（Origin/Referer 不匹配）")
            fn = ROUTES.get((self.command, path))
            if fn is not None:
                return fn(self, qs)
            if self.command == "GET" and path == "/":
                return self._serve_index()
            if self.command == "GET" and path in FAVICON_ALIASES:  # 浏览器自动请求的图标，别刷 404
                return self._serve_static(FAVICON_ALIASES[path])
            if self.command == "GET" and path.startswith("/static/"):
                return self._serve_static(path[len("/static/"):])
            known = any(p == path for _m, p in ROUTES)
            self._fail(405 if known else 404,
                       ("该接口不接受 %s 请求" % self.command) if known else ("未知路径：%s" % path))
        except Exception as e:  # 兜底：任何异常都渲染成 JSON，不砸掉服务
            import traceback
            traceback.print_exc()  # 终端留全栈，便于定位；客户端只看到简短中文原因
            self._fail(500, "服务器内部错误：%s" % e)

    do_GET = do_POST = do_PUT = do_DELETE = _route

    # -- 静态文件 --

    def _serve_index(self):
        index = STATIC_DIR / "index.html"
        if index.is_file():
            self._send(200, "text/html; charset=utf-8", index.read_bytes(),
                       extra=[("Cache-Control", "no-cache")])
        else:  # 前端尚未安装：极简占位页（API 已可用）
            self._html("<!doctype html><meta charset=utf-8><title>学习工作台</title>"
                       "<body style=\"font-family:sans-serif;padding:48px;line-height:1.8\">"
                       "<h1>📚 学习工作台</h1><p>前端尚未安装（缺少 app/static/index.html）。</p>"
                       "<p>服务端 API 已就绪，例如 <code>GET /api/state</code>。</p></body>")

    def _serve_static(self, rel):
        p = zonefs.safe_path(rel, STATIC_DIR)  # 防穿越：拒绝 ..、绝对路径、空段
        suffix = p.suffix.lstrip(".").lower() if p else ""
        if p is None or not p.is_file() or suffix not in self.STATIC_TYPES:
            return self._fail(404, "静态文件不存在：%s" % rel)
        self._send(200, self.STATIC_TYPES[suffix], p.read_bytes(),
                   extra=[("Cache-Control", "no-cache")])

    # -- API：状态与作业 --

    def api_state(self, qs):
        self._ok(version=VERSION, zone=str(ZONE), port=PORT,
                 vault={"name": VAULT_NAME, "root": str(VAULT) if VAULT else None,
                        "in_zone": VAULT is not None and ZONE.is_relative_to(VAULT)})

    def api_assignments(self, qs):
        d = qs.get("dir", [""])[0]
        if d not in zonefs.ASSIGN_DIRS:
            return self._fail(400, "dir 必须是 %s 之一" % "/".join(zonefs.ASSIGN_DIRS))
        self._ok(dir=d, items=zonefs.list_assignments(ZONE, d))

    def api_assignment(self, qs):
        d, f = qs.get("dir", [""])[0], qs.get("file", [""])[0]
        p = zonefs.safe_path("%s/%s" % (d, f), ZONE) if d in zonefs.ASSIGN_DIRS else None
        if p is None or "/" in f or f.startswith("_") or not p.is_file():
            return self._fail(404, "找不到这个作业（dir 非法、_ 开头或文件不存在）")
        text = p.read_text(encoding="utf-8")
        meta, body = zonefs.parse_frontmatter(text)
        task, ans, grade = zonefs.split_sections(body)
        ttype = meta.get("type", "quiz")
        out = {"dir": d, "file": f, "title": meta.get("title") or p.stem, "type": ttype,
               "topics": _as_list(meta.get("topics", [])),
               "links": _as_list(meta.get("links", [])),
               "status": meta.get("status", ""), "date": meta.get("date", ""),
               "task_md": task, "answer_md": ans, "grade_md": grade,
               "can_answer": d == zonefs.INBOX, "obsidian_url": obsidian_url(p)}
        if ttype in ("quiz", "drill"):  # quiz/drill 逐题切块；material 原样给 task_md 全文
            _intro, blocks = zonefs.parse_questions(task)
            out["questions"] = [{"num": n, "type": t, "md": rest} for n, t, rest in blocks]
        self._ok(**out)

    def api_submit(self, qs):
        data = self._read_json()
        if data is None:
            return
        if data.get("dir") != zonefs.INBOX:
            return self._fail(400, "只能提交 %s 目录的作业" % zonefs.INBOX)
        f = data.get("file", "")
        p = (zonefs.safe_path("%s/%s" % (zonefs.INBOX, f), ZONE)
             if isinstance(f, str) and "/" not in f and not f.startswith("_") else None)
        if p is None or not p.is_file():
            return self._fail(404, "作业不在待答题目录（可能已提交过）")
        answers = data.get("answers") or {}
        if not isinstance(answers, dict):
            return self._fail(400, "answers 应是 {题号: 文本} 对象")
        text = p.read_text(encoding="utf-8")
        meta, body = zonefs.parse_frontmatter(text)
        task, _old_ans, old_grade = zonefs.split_sections(body)
        if meta.get("type", "quiz") == "material":  # 服务端自查 frontmatter 判型，不信前端
            answer_md = zonefs.quote_block(str(data.get("note", "")))
        else:  # 作答区组装与旧版 do_submit 逐位一致：### Q<n> · 题型 + '> ' 引用块
            _intro, blocks = zonefs.parse_questions(task)
            chunks = []
            for num, qtype, _rest in blocks:
                val = answers.get(num, "")
                chunks.append("### Q%s · %s\n\n%s" % (
                    num, qtype, zonefs.quote_block(val if isinstance(val, str) else str(val))))
            answer_md = "\n\n".join(chunks)
        grade_keep = old_grade if old_grade and old_grade not in ("", "（待批改）") else "（待批改）"
        new_body = (task.rstrip() + "\n\n## 我的作答\n\n" + answer_md
                    + "\n\n## 批改\n\n" + grade_keep + "\n")
        dest = ZONE / zonefs.ANSWERED / p.name
        with FILE_LOCK:  # 先写新目录成功后再删旧文件，两步保证数据不丢
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(zonefs.set_status(text, "answered").replace(body, new_body, 1),
                            encoding="utf-8")
            p.unlink()
        self._ok(moved_to=zonefs.ANSWERED)

    # -- API：资料库与阅读 --

    def api_library(self, qs):
        rel = qs.get("path", [""])[0]
        root = VAULT if VAULT else ZONE
        try:
            listing = zonefs.list_library(root, rel)
        except ValueError:
            return self._fail(400, "路径不允许：%r" % rel)
        except FileNotFoundError:
            return self._fail(404, "目录不存在：%s" % rel)
        self._ok(root=str(root), path=rel, **listing)

    def api_read(self, qs):
        rel = qs.get("path", [""])[0]
        if not rel:
            return self._fail(400, "缺少 path 参数")
        # 允许根：vault 优先，其次 zone 三目录与 90_模板；末尾兜底 zone 根自身——
        # 无 vault 时 /api/library 列出的就是 zone 相对路径，read 必须能原样打开
        roots = ([VAULT] if VAULT else []) \
            + [ZONE / d for d in zonefs.ASSIGN_DIRS] + [ZONE / "90_模板"] + [ZONE]
        found = None
        for root in roots:  # safe_path 逐根尝试：vault 优先，其次 zone 三目录与 90_模板
            try:
                found = zonefs.read_material(root, rel)
                break
            except ValueError:  # 该根不允许（穿越/绝对路径）
                continue
            except OSError:     # 该根下没有这个文件
                continue
        if found is None:
            return self._fail(404, "路径不允许或文件不存在：%s" % rel)
        ann = zonefs.load_annotations(ZONE, rel)
        self._ok(path=found["path"], title=found["title"], md=found["md"], source=rel,
                 annotation={"file": ann["file"], "count": len(ann["entries"])},
                 obsidian_url=obsidian_url(found["path"]))

    # -- API：批注侧车 --

    def api_annotations_get(self, qs):
        material = qs.get("material", [""])[0]
        if not material:
            return self._fail(400, "缺少 material 参数")
        self._ok(**zonefs.load_annotations(ZONE, material))

    def api_annotations_post(self, qs):
        data = self._read_json()
        if data is None:
            return
        material = data.get("material", "")
        if not isinstance(material, str) or not material:
            return self._fail(400, "缺少 material")
        with FILE_LOCK:
            r = zonefs.add_annotation(ZONE, material, str(data.get("quote", "")),
                                      str(data.get("note", "")))
        self._ok(id=r["id"], file=r["file"], ts=r["ts"])

    def api_annotations_put(self, qs):
        data = self._read_json()
        if data is None:
            return
        material, ann_id = data.get("material", ""), data.get("id", "")
        if not material or not ann_id:
            return self._fail(400, "需要 material 与 id")
        try:
            with FILE_LOCK:
                zonefs.update_annotation(ZONE, material, str(ann_id), str(data.get("note", "")))
        except KeyError as e:
            return self._fail(404, str(e).strip("'\""))
        self._ok()

    def api_annotations_delete(self, qs):
        material, ann_id = qs.get("material", [""])[0], qs.get("id", [""])[0]
        if not material or not ann_id:
            return self._fail(400, "需要 material 与 id")
        try:
            with FILE_LOCK:
                zonefs.delete_annotation(ZONE, material, ann_id)
        except KeyError as e:
            return self._fail(404, str(e).strip("'\""))
        self._ok()

    # -- API：计划、面板、贴士、番茄钟、退出 --

    def api_plan(self, qs):
        p = _data_file("学习计划.md")
        if p is None:
            return self._fail(404, "学习计划不存在（回 zcode 说「初始化学习工作台」可生成）")
        md = p.read_text(encoding="utf-8")
        parsed = _attach_plan_items(zonefs.parse_plan(p), md)
        self._ok(**parsed, md=md, obsidian_url=obsidian_url(p))

    def api_dashboard(self, qs):
        today = date.today()
        out = {"due": [], "plan": None, "tip": None, "xp": None, "plan_check": None}
        try:  # 单个子块失败不影响整体：catch 后保持 null/空
            q = _data_file("复习队列.md")
            if q:
                out["due"] = [{"topic": t, "link": l, "next": n}
                              for t, l, n in zonefs.due_cards(q)]
        except Exception:
            pass
        try:
            p = _data_file("学习计划.md")
            if p:
                out["plan"] = zonefs.parse_plan(p)
        except Exception:
            pass
        try:
            out["tip"] = gamify.tip_of_day(gamify.load_tips(TIPS_PATH), today.isoformat())
        except Exception:
            pass
        try:
            out["xp"] = gamify.gamify_stats(ZONE / zonefs.GRADED, ZONE / zonefs.LOG_DIR, today)
        except Exception:
            pass
        try:
            p = _data_file("学习计划.md")
            if p:
                out["plan_check"] = plan_check(p)
        except Exception:
            pass
        self._ok(date=today.isoformat(), **out)

    def api_tips_random(self, qs):
        tips = gamify.load_tips(TIPS_PATH)
        if not tips:
            return self._fail(503, "贴士库未安装")
        self._ok(tip=gamify.tip_random(tips, qs.get("domain", [None])[0] or None))

    def api_pomodoro(self, qs):
        data = self._read_json()
        if data is None:
            return
        minutes, start = data.get("minutes"), data.get("start", "")
        if isinstance(minutes, bool) or not isinstance(minutes, int) or minutes <= 0:
            return self._fail(400, "minutes 必须是正整数")
        if not isinstance(start, str) or not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", start):
            return self._fail(400, "start 必须是 HH:MM（24 小时制）")
        with FILE_LOCK:
            log = zonefs.append_pomodoro(ZONE, minutes, str(data.get("label", "")), start)
        self._ok(log=log)

    def api_shutdown(self, qs):
        self._ok(bye=True)
        # 注意 threading.Timer 不像 Thread 那样收 daemon 关键字参数，要先建再置
        t = threading.Timer(0.3, SERVER.shutdown)
        t.daemon = True
        t.start()


ROUTES = {
    ("GET", "/api/state"): Handler.api_state,
    ("GET", "/api/assignments"): Handler.api_assignments,
    ("GET", "/api/assignment"): Handler.api_assignment,
    ("GET", "/api/library"): Handler.api_library,
    ("GET", "/api/read"): Handler.api_read,
    ("GET", "/api/annotations"): Handler.api_annotations_get,
    ("GET", "/api/plan"): Handler.api_plan,
    ("GET", "/api/dashboard"): Handler.api_dashboard,
    ("GET", "/api/tips/random"): Handler.api_tips_random,
    ("POST", "/api/submit"): Handler.api_submit,
    ("POST", "/api/annotations"): Handler.api_annotations_post,
    ("POST", "/api/pomodoro"): Handler.api_pomodoro,
    ("POST", "/shutdown"): Handler.api_shutdown,
    ("PUT", "/api/annotations"): Handler.api_annotations_put,
    ("DELETE", "/api/annotations"): Handler.api_annotations_delete,
}
