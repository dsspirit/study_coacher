#!/usr/bin/env python3
"""zonefs / gamify / plan-check 单元测试（stdlib unittest；夹具在 tests/fixtures/，不碰真实 vault）。

跑法：cd <skill 根> && python3 -m unittest discover tests -v
"""

import shutil
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL))
sys.path.insert(0, str(SKILL / "scripts"))

from app import gamify, zonefs  # noqa: E402
import scheduler  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
MATERIAL_REL = "待答题/2026-09-29-SFT与指令微调-L2.md"


def _read(p):
    return Path(p).read_text(encoding="utf-8")


def _assert_lines_preserved(test, before, after):
    """after 必须按原顺序完整保留 before 的每一行（一个字符都不能变）。"""
    rest = iter(after.split("\n"))
    for line in before.split("\n"):
        for cand in rest:
            if cand == line:
                break
        else:
            test.fail("原行丢失、被改或乱序：%r" % line)


class LegacyFormatTest(unittest.TestCase):
    """旧格式作业包回归：learning_zone.py 移植的四个函数行为逐位一致。"""

    def test_quiz_questions_and_sections(self):
        meta, body = zonefs.parse_frontmatter(_read(FIXTURES / "作业包_quiz.md"))
        self.assertEqual(meta["type"], "quiz")
        self.assertEqual(meta["topics"], ["SFT", "LoRA"])
        task, ans, grade = zonefs.split_sections(body)
        intro, qs = zonefs.parse_questions(task)
        self.assertEqual([q[0] for q in qs], ["1", "2", "3"])
        self.assertEqual([q[1] for q in qs], ["简答", "简答", "变式"])
        self.assertIn("合上材料", intro)
        self.assertEqual(zonefs.unquote_block(ans), "（未作答）")
        self.assertEqual(grade, "（待批改）")

    def test_material_package_no_question_split(self):
        _meta, body = zonefs.parse_frontmatter(_read(FIXTURES / "作业包_material.md"))
        task, ans, _grade = zonefs.split_sections(body)
        intro, qs = zonefs.parse_questions(task)
        self.assertEqual(qs, [])  # material 无题块：整段是材料
        self.assertIn("指令微调", intro)
        self.assertIn("损失掩码", zonefs.unquote_block(ans))

    def test_recall_package_question_split(self):
        """recall 白纸默写包：type=recall 也按 ### Q<n> 切卡，主题即题面。"""
        meta, body = zonefs.parse_frontmatter(_read(FIXTURES / "作业包_recall.md"))
        self.assertEqual(meta["type"], "recall")
        task, _ans, _grade = zonefs.split_sections(body)
        intro, qs = zonefs.parse_questions(task)
        self.assertEqual([q[0] for q in qs], ["1", "2"])
        self.assertEqual([q[1] for q in qs], ["默写", "默写"])
        self.assertEqual([q[2] for q in qs], ["后训练流水线", "SFT 与 DPO 的信号差别"])
        self.assertIn("合上所有材料", intro)
        # 白纸作答（含自动 appended 的用时行）经 quote_block 组装后可原样还原
        composed = zonefs.quote_block("流水线是……\n\n（用时 2:23）")
        self.assertEqual(zonefs.unquote_block(composed), "流水线是……\n\n（用时 2:23）")

    def test_set_status_idempotent(self):
        text = _read(FIXTURES / "作业包_quiz.md")
        once = zonefs.set_status(text, "graded")
        self.assertIn("status: graded", once)
        self.assertEqual(zonefs.set_status(once, "graded"), once)
        # 无 frontmatter 的文本：状态行放文件头，同样幂等
        bare = "# 纯题面\n\n内容\n"
        self.assertEqual(zonefs.set_status(zonefs.set_status(bare, "answered"), "answered"),
                         zonefs.set_status(bare, "answered"))


class QueuePlanTest(unittest.TestCase):
    """due_cards / parse_plan 的移植回归（夹具日期相对今天恒定，结果确定）。"""

    def test_due_cards(self):
        cards = zonefs.due_cards(FIXTURES / "复习队列.md")
        self.assertEqual(cards, [("过期卡", "[[a]]", "2020-01-01")])

    def test_parse_plan(self):
        plan = zonefs.parse_plan(FIXTURES / "学习计划.md")
        self.assertEqual(plan["done"], 4)
        self.assertEqual(plan["total"], 12)
        self.assertEqual(plan["pct"], 33)
        self.assertEqual([(s["done"], s["total"]) for s in plan["stages"]], [(4, 8), (0, 4)])
        self.assertEqual(plan["meta"]["deadline"], "2026-03-11")
        self.assertEqual(plan["meta"]["current_item"], "[[块1]]")
        self.assertIsNone(zonefs.parse_plan(FIXTURES / "不存在的计划.md"))


class SafePathTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "a").mkdir()

    def test_rejects_traversal(self):
        self.assertIsNone(zonefs.safe_path("../x.md", self.root))
        self.assertIsNone(zonefs.safe_path("/etc/passwd", self.root))
        self.assertIsNone(zonefs.safe_path("", self.root))
        self.assertIsNone(zonefs.safe_path("..\\x.md", self.root))
        self.assertIsNone(zonefs.safe_path("a//b.md", self.root))  # 空段
        self.assertIsNone(zonefs.safe_path("./a/b.md", self.root))  # 点段

    def test_allows_relative_under_roots(self):
        self.assertEqual(zonefs.safe_path("a/b.md", self.root),
                         (self.root / "a" / "b.md").resolve())
        other = self.root / "other"
        other.mkdir()
        self.assertEqual(zonefs.safe_path("x.md", self.root, other),
                         (self.root / "x.md").resolve())  # 多 root 取第一个通过的


class AnnotationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.zone = Path(self.tmp.name)

    def test_round_trip(self):
        a1 = zonefs.add_annotation(self.zone, MATERIAL_REL, "  LoRA 的秩并不是排序……  ", "rank 是矩阵的秩")
        self.assertEqual(a1["id"], "A1")
        a2 = zonefs.add_annotation(self.zone, MATERIAL_REL, "q" * 250, "超长引文要截断")
        self.assertEqual(a2["quote"], "q" * 200)  # 超 200 字符截断
        loaded = zonefs.load_annotations(self.zone, MATERIAL_REL)
        self.assertTrue(loaded["exists"])
        self.assertTrue(loaded["file"].endswith("2026-09-29-SFT与指令微调-L2.md"))
        self.assertEqual([e["id"] for e in loaded["entries"]], ["A1", "A2"])
        self.assertEqual(loaded["entries"][0]["quote"], "LoRA 的秩并不是排序……")
        self.assertEqual(loaded["entries"][0]["note"], "rank 是矩阵的秩")
        self.assertRegex(loaded["entries"][0]["ts"], r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}")
        meta, _ = zonefs.parse_frontmatter(_read(loaded["file"]))
        self.assertEqual(meta["source"], MATERIAL_REL)
        self.assertEqual(meta["title"], "批注 · 2026-09-29-SFT与指令微调-L2")

        zonefs.update_annotation(self.zone, MATERIAL_REL, "A1", "改后的批注")
        loaded = zonefs.load_annotations(self.zone, MATERIAL_REL)
        self.assertEqual(loaded["entries"][0]["note"], "改后的批注")
        self.assertEqual(loaded["entries"][1]["note"], "超长引文要截断")  # 只动 A1

        zonefs.delete_annotation(self.zone, MATERIAL_REL, "A2")
        loaded = zonefs.load_annotations(self.zone, MATERIAL_REL)
        self.assertEqual([e["id"] for e in loaded["entries"]], ["A1"])
        self.assertIn("source: " + MATERIAL_REL, _read(loaded["file"]))  # 删空后文件仍在

    def test_load_missing(self):
        loaded = zonefs.load_annotations(self.zone, "待答题/没有的材料.md")
        self.assertFalse(loaded["exists"])
        self.assertEqual(loaded["entries"], [])
        self.assertIsNone(loaded["file"])

    def test_update_delete_missing_entry_raises(self):
        zonefs.add_annotation(self.zone, MATERIAL_REL, "引文", "批注")
        with self.assertRaises(KeyError):
            zonefs.update_annotation(self.zone, MATERIAL_REL, "A9", "x")
        with self.assertRaises(KeyError):
            zonefs.delete_annotation(self.zone, MATERIAL_REL, "A9")

    def test_stem_conflict_uses_dash2(self):
        ann_dir = self.zone / zonefs.ANNOT_DIR
        ann_dir.mkdir(parents=True)
        stem = Path(MATERIAL_REL).stem
        other = MATERIAL_REL.replace("SFT", "RLHF")
        (ann_dir / (stem + ".md")).write_text(
            "---\ntitle: 批注 · %s\ndate: 2026-09-28\ntags: [%s]\nsource: %s\n---\n"
            % (stem, zonefs.ANNOT_TAG, other), encoding="utf-8")
        got = zonefs.add_annotation(self.zone, MATERIAL_REL, "引文", "批注")
        self.assertTrue(got["file"].endswith(stem + "-2.md"))  # 同名不同源 → -2 后缀
        meta, _ = zonefs.parse_frontmatter(_read(got["file"]))
        self.assertEqual(meta["source"], MATERIAL_REL)
        self.assertEqual(zonefs.load_annotations(self.zone, MATERIAL_REL)["file"], got["file"])
        self.assertTrue(zonefs.load_annotations(self.zone, other)["file"].endswith(stem + ".md"))


class PomodoroTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.zone = Path(self.tmp.name)

    def _log(self, d):
        return self.zone / zonefs.LOG_DIR / (d + ".md")

    def test_fresh_zone_creates_file_and_section(self):
        rel = zonefs.append_pomodoro(self.zone, 25, "默写", "14:32", today=date(2026, 3, 1))
        self.assertEqual(rel, "学习日志/2026-03-01.md")
        text = _read(self._log("2026-03-01"))
        self.assertIn("# 学习日志 2026-03-01", text)  # 无模板 → 最小骨架
        self.assertIn(zonefs.POMO_SECTION, text)
        self.assertIn("- 14:32–14:57 · 25 min · 默写", text)

    def test_fresh_zone_uses_template(self):
        shutil.copytree(FIXTURES / "90_模板", self.zone / "90_模板")
        zonefs.append_pomodoro(self.zone, 25, "", "09:00", today=date(2026, 3, 2))
        text = _read(self._log("2026-03-02"))
        self.assertIn("# 学习日志 2026-03-02", text)  # 模板日期占位被替换
        self.assertIn("- 09:00–09:25 · 25 min · （无标签）", text)  # 空 label → （无标签）

    def test_appends_section_at_eof_when_missing(self):
        log = self._log("2026-03-03")
        log.parent.mkdir(parents=True)
        before = ("---\ntitle: 学习日志 2026-03-03\n---\n\n# 学习日志 2026-03-03\n\n"
                  "## 1 · 昨日默写\n\n- 到期卡片：3 张\n")
        log.write_text(before, encoding="utf-8")
        zonefs.append_pomodoro(self.zone, 25, "早读", "08:00", today=date(2026, 3, 3))
        after = _read(log)
        _assert_lines_preserved(self, before, after)  # 已有行一个字符没变
        self.assertGreater(after.index(zonefs.POMO_SECTION), after.index("- 到期卡片：3 张"))
        self.assertIn("- 08:00–08:25 · 25 min · 早读", after)

    def test_appends_inside_existing_section(self):
        log = self._log("2026-03-04")
        log.parent.mkdir(parents=True)
        before = ("---\ntitle: 学习日志 2026-03-04\n---\n\n# 学习日志 2026-03-04\n\n"
                  "## 番茄钟\n\n- 08:00–08:25 · 25 min · 早读\n\n## 2 · 新内容\n\n- 学了新块\n")
        log.write_text(before, encoding="utf-8")
        zonefs.append_pomodoro(self.zone, 30, "午间", "13:00", today=date(2026, 3, 4))
        after = _read(log)
        _assert_lines_preserved(self, before, after)  # 已有行一个字符没变
        new_line = "- 13:00–13:30 · 30 min · 午间"
        self.assertIn(new_line, after)
        self.assertLess(after.index("- 08:00–08:25 · 25 min · 早读"), after.index(new_line))
        self.assertLess(after.index(new_line), after.index("## 2 · 新内容"))  # 追加在节内

    def test_minute_carry_over_midnight(self):
        zonefs.append_pomodoro(self.zone, 25, "夜刷", "23:50", today=date(2026, 3, 5))
        self.assertIn("- 23:50–00:15 · 25 min · 夜刷", _read(self._log("2026-03-05")))


class GamifyTest(unittest.TestCase):
    def test_load_tips_skips_bad_rows(self):
        tips = gamify.load_tips(FIXTURES / "贴士库.md")
        self.assertEqual([t["id"] for t in tips], ["t1", "t2", "t3"])
        self.assertEqual(tips[0], {"id": "t1", "name": "检索练习", "line": "捞过的才记得住",
                                   "how": "合上材料默写", "domain": "通用"})
        self.assertEqual(gamify.load_tips(FIXTURES / "不存在的贴士库.md"), [])

    def test_tip_of_day_stable_per_day(self):
        tips = gamify.load_tips(FIXTURES / "贴士库.md")
        self.assertIs(gamify.tip_of_day(tips, "2026-09-29"), gamify.tip_of_day(tips, "2026-09-29"))
        self.assertEqual(gamify.tip_of_day(tips, "2026-09-29"),
                         tips[sum(ord(c) for c in "2026-09-29") % len(tips)])
        self.assertIsNone(gamify.tip_of_day([], "2026-09-29"))

    def test_tip_random_exclude_current(self):
        """再来一条：exclude 当前条后必换（小领域池抽回原条的 bug 回归）。"""
        tips = [{"name": "a", "domain": "d"}, {"name": "b", "domain": "d"}]
        for _ in range(20):
            self.assertNotEqual(gamify.tip_random(tips, exclude="a")["name"], "a")
        # 全池只剩当前条时回退原条（不返回 None）
        self.assertEqual(gamify.tip_random(tips[:1], exclude="a")["name"], "a")

    def test_tip_random_filters_and_falls_back(self):
        tips = gamify.load_tips(FIXTURES / "贴士库.md")
        for _ in range(10):
            self.assertEqual(gamify.tip_random(tips, "数学")["domain"], "数学")
        self.assertIn(gamify.tip_random(tips, "不存在的领域"), tips)  # 空池回退全池
        self.assertIsNone(gamify.tip_random([], "x"))

    def test_gamify_stats(self):
        stats = gamify.gamify_stats(FIXTURES / "已批改", FIXTURES / "学习日志", date(2026, 1, 4))
        self.assertEqual(stats, {"xp": 130, "level": 2, "title": "新手村居民", "next_at": 200,
                                 "streak": 2, "graded": 2, "pomos_today": 2, "pomos_total": 4})

    def test_gamify_streak_from_yesterday_and_empty_dirs(self):
        stats = gamify.gamify_stats(FIXTURES / "已批改", FIXTURES / "学习日志", date(2026, 1, 5))
        self.assertEqual(stats["streak"], 2)  # 今天不在集合：从昨天 01-04 起数 01-04、01-03
        self.assertEqual(stats["pomos_today"], 0)
        with tempfile.TemporaryDirectory() as tmp:
            empty = gamify.gamify_stats(Path(tmp) / "无", Path(tmp) / "无日志", date(2026, 1, 4))
            self.assertEqual(empty, {"xp": 0, "level": 1, "title": "新手村居民", "next_at": 100,
                                     "streak": 0, "graded": 0, "pomos_today": 0, "pomos_total": 0})


class CalendarNoteTest(unittest.TestCase):
    """calendar_activity（首页月历）与 resolve_note（wikilink 解析）。"""

    def setUp(self):
        self.zone = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.zone, ignore_errors=True)

    def _write(self, rel, text):
        p = Path(self.zone) / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def test_calendar_activity_counts(self):
        import os
        from datetime import date, timedelta
        today = date.today()
        d1 = today.isoformat()
        d2 = (today - timedelta(days=1)).isoformat()
        old = (today - timedelta(days=100)).isoformat()  # 超出回看窗口，不该出现
        self._write("学习日志/%s.md" % d1,
                    "# 日\n\n## 番茄钟\n\n- 09:00–09:25 · 25 min · 读\n- 10:00–10:25 · 25 min · 写\n")
        self._write("学习日志/%s.md" % old, "# 旧\n\n## 番茄钟\n\n- 09:00–09:25 · 25 min · x\n")
        # 已答待批：mtime=今天（刚写入）；已批改：把 mtime 改到昨天
        ans = self._write("已答待批/a.md", "---\nstatus: answered\n---\n")
        gra = self._write("已批改/b.md", "---\nstatus: graded\n---\n")
        y2 = (today - timedelta(days=1)).toordinal() - date(1970, 1, 1).toordinal()
        y2 *= 86400
        os.utime(gra, (y2, y2))
        q = self._write("复习队列.md",
                        "| 主题 | 链接 | 间隔 | 难易 | 下次复习 | 连对 | 状态 |\n"
                        "|---|---|---|---|---|---|---|\n"
                        "| 卡A | [[]] | 1 | 2.5 | %s | 0 | 进行中 |\n"
                        "| 卡B | [[]] | 1 | 2.5 | %s | 0 | 进行中 |\n"
                        "| 卡C | [[]] | 1 | 2.5 | %s | 0 | 毕业 |\n"
                        % (today.isoformat(), (today + timedelta(days=3)).isoformat(),
                           (today + timedelta(days=5)).isoformat()))
        out = zonefs.calendar_activity(self.zone, q)
        self.assertEqual(out["days"][d1]["pomo"], 2)
        self.assertEqual(out["days"][d1]["answered"], 1)
        self.assertEqual(out["days"][d2]["graded"], 1)
        self.assertIn(old, out["days"])  # 默认全量历史：任意年月可切
        self.assertEqual(out["due_ahead"][today.isoformat()], 1)
        self.assertEqual(out["due_ahead"][(today + timedelta(days=3)).isoformat()], 1)
        self.assertNotIn((today + timedelta(days=5)).isoformat(), out["due_ahead"])  # 已毕业
        # 传窗口参数时旧行为不变（back_days 截断）
        win = zonefs.calendar_activity(self.zone, q, ahead_days=1, back_days=1)
        self.assertNotIn(old, win["days"])
        self.assertNotIn((today + timedelta(days=3)).isoformat(), win["due_ahead"])

    def test_day_activity_detail(self):
        from datetime import date, timedelta
        today = date.today()
        d1 = today.isoformat()
        self._write("学习日志/%s.md" % d1,
                    "# 日\n\n## 番茄钟\n\n- 09:00–09:25 · 25 min · 精读\n- 10:00–10:25 · 25 min · 变式题\n")
        self._write("已答待批/a.md", "---\ntitle: A 包\ntype: material\n---\n")
        self._write("复习队列.md",
                    "| 主题 | 链接 | 间隔 | 难易 | 下次复习 | 连对 | 状态 |\n"
                    "|---|---|---|---|---|---|---|\n"
                    "| 卡A | [[]] | 1 | 2.5 | %s | 0 | 进行中 |\n" % d1)
        out = zonefs.day_activity(self.zone, self.zone + "/复习队列.md", d1)
        self.assertTrue(out["log"])
        self.assertEqual([p["label"] for p in out["pomo"]], ["精读", "变式题"])
        self.assertEqual(out["pomo"][0]["min"], 25)
        self.assertEqual([(a["title"], a["type"], a["dir"]) for a in out["submitted"]],
                         [("A 包", "material", "已答待批")])
        self.assertEqual(out["due"], 1)
        self.assertEqual(zonefs.day_activity(self.zone, None, "2025-01-01")["pomo"], [])

    def test_resolve_note(self):
        self._write("07_文献笔记/文献_DPO.md", "# DPO\n")
        self._write("notes/deep/文献_DPO.md", "# 同名深层\n")
        self._write("错题本/后训练范式.md", "# 范式\n")
        self.assertEqual(zonefs.resolve_note(self.zone, "07_文献笔记/文献_DPO"), "07_文献笔记/文献_DPO.md")
        # 同名按路径最短优先
        self.assertEqual(zonefs.resolve_note(self.zone, "文献_DPO"), "07_文献笔记/文献_DPO.md")
        self.assertEqual(zonefs.resolve_note(self.zone, "后训练范式"), "错题本/后训练范式.md")
        self.assertIsNone(zonefs.resolve_note(self.zone, "不存在"))


class PlanCheckTest(unittest.TestCase):
    def test_arithmetic_lag_four_days(self):
        r = scheduler.plan_check(FIXTURES / "学习计划.md", hours_per_block=1.5, today=date(2026, 3, 1))
        self.assertEqual(r["done_blocks"], 4)
        self.assertEqual(r["total_blocks"], 12)
        self.assertEqual(r["blocks_left"], 8)
        self.assertEqual(r["est_hours"], 12)            # 8 块 × 1.5 h
        self.assertEqual(r["weekly_hours"], 8.0)
        self.assertEqual(r["eta_days"], 14)             # ceil(12/8)=2 → 2 周
        self.assertEqual(r["eta_date"], "2026-03-15")
        self.assertEqual(r["deadline"], "2026-03-11")
        self.assertEqual(r["days_left"], 10)
        self.assertEqual(r["lag_days"], 4)              # 03-15 比 03-11 晚 4 天

    def test_no_deadline_and_weekly_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "计划.md"
            p.write_text("---\ntitle: 无期限\n---\n\n### L1\n\n- [ ] 块A\n", encoding="utf-8")
            r = scheduler.plan_check(p, today=date(2026, 3, 1))
            self.assertIsNone(r["deadline"])
            self.assertIsNone(r["days_left"])
            self.assertEqual(r["lag_days"], 0)
            self.assertEqual(r["weekly_hours"], 8.0)    # 缺省每周 8 小时
            self.assertEqual(r["eta_days"], 7)          # ceil(1.5/8)=1 周


if __name__ == "__main__":
    unittest.main()
