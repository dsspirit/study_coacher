# 像素视觉规范（工作台改皮肤只读这份）

> 代码位置：`app/static/pix.css`（全部 token 与组件类）。改皮肤 = 改这份文件里的 token，不动 JS。

## 调色板：PICO-8 16 色（只许取这些色值）

`#000000 #1D2B53 #7E2553 #008751 #AB5236 #5F574F #C2C3C7 #FFF1E8 #FF004D #FFA300 #FFEC27 #00E436 #29ADFF #83769C #FF77A8 #FFCCAA`

## 语义 token

| token | 浅色 | 深色 |
|---|---|---|
| --bg | #FFCCAA | #1D2B53 |
| --card | #FFF1E8 | #000000 |
| --ink / --muted | #1D2B53 / #83769C | #FFF1E8 / #83769C |
| --border / --shadow | #1D2B53 / #1D2B53 | #5F574F / #000000 |
| --accent / --link | #FFA300 / #29ADFF | #FFEC27 / #29ADFF |
| --ok / --warn / --danger | #008751 / #FFA300 / #FF004D | #00E436 / #FFA300 / #FF004D |
| --highlight(mark) | 底 #FFEC27 字 #1D2B53 | 同左 |

深浅主题：`html[data-theme=dark|light]` 切 token；localStorage 键 `lz-theme`（沿用旧版），URL `?theme=` 可带初值，首次跟随系统 `prefers-color-scheme`。

## 硬规则（像素风的骨架，字体缺失也必须成立）

- 全局 `border-radius: 0`，一切直角。
- 阴影只用硬阴影：`box-shadow: Npx Npx 0 var(--shadow)`（卡片 4px、按钮 3px），禁模糊阴影、禁渐变发光。
- 边框 2px solid；可点卡片 hover 用 `outline: 2px dashed var(--accent)`，不浮起不缩放。
- 按钮按压：`:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--shadow); }`
- 图标 8×8 内联 SVG，`shape-rendering="crispEdges"`，`fill="currentColor"`。
- 进度条阶梯化：外框 2px + 内部等宽格子（flex span，格间距 2px），禁止平滑圆角条。

## 字号阶梯（px 整数）

12 meta/badge · 14 辅助 · 16 正文 · 20 节标题 · 28 页标题 · 40 XP 大数字。正文行高 1.7。

## 字体链（2026-09-29 用户反馈定版：像素风只做装饰，正文必须可读）

- `--font-ui`（正文/按钮/表格/一切阅读文字）：`"PingFang SC", -apple-system, "Hiragino Sans GB", "Source Han Sans SC", "Microsoft YaHei", sans-serif`；`-webkit-font-smoothing: antialiased`。
- `--font-pixel`（点缀专用：仅 `.px-brand` 站名、`.xp-big` 大数字）：`"Fusion Pixel 12px","Zpix",var(--font-ui)`。woff2 在 `static/fonts/`（651K，OFL），`font-display: swap`；缺失自然回退系统字。
- `--font-mono`（代码块/行内 code/作答框）：`ui-monospace,"SF Mono",Menlo,Consolas,monospace`。
- 红线：**任何承载阅读内容的元素不得用像素字体**——用户实测"像素字看着很累"，像素感只许来自边框/阴影/配色/进度条/图标。
- 下载：`scripts/fetch_pixel_font.sh`（来源 TakWolf/fusion-pixel-font releases，OFL 协议）。

## 组件清单（类名契约，JS 侧只依赖这些名字）

`.px-btn`（.danger 变体红底）· `.px-card` · `.px-progress`（data-value 驱动格子）· `.px-badge`（.ok/.warn 语义色）· `.px-tab`（激活 = 底部 3px accent）· `.px-input/.px-textarea`（2px 边框无圆角，focus 换 accent 边）· `mark.px-hl`（高亮黄底 + 2px 虚线同色边）· `.px-toast`（右下角滑入卡片）· `.px-empty`（空态引导）· `header.px-topbar`（导航条）。

## recall 白纸默写（v2.1 追加）

- `.recall-paper`：白纸书写区（textarea）。**用 `--font-ui`**（长文书写区，同铁律：承载书写内容的元素不用像素/等宽字体），17px / 行高 1.9，min-height 320px，2px 直角边框，focus 换 accent 边。
- `.recall-topic`：主题行（md-body 内），18px。
- `.recall-hint`：挣扎提示条（10 秒没动笔出现，一动笔消失）：muted 字 + 2px accent 虚线边。
- `.recall-locked` / `.recall-locked-text`：已交卷卡只读回显：`--bg` 底 + 2px border 虚线，正文 pre-wrap 15px。
- 复用：卡块用 `.q-block`/`.q-head`，徽章/按钮/计时全部走既有 `.px-badge`/`.px-btn`。

## 数学公式（v2.1.1 追加）

- 渲染：md.js 检测正文含 `$` 时懒加载本地 KaTeX（`static/vendor/katex/`），对 body 跑 auto-render：`$$…$$` 展示（居中）、`$…$` 行内；`ignoredClasses: ['mmd']` 保护 mermaid 源码；`throwOnError: false`（语法错渲染红色错误段不炸页）；加载失败原文保留（天然降级）。
- 主题：KaTeX 文字颜色继承环境（`--ink`），深浅主题自动可读，无需为公式写 token；公式字体是 KaTeX 自带（Computer Modern 系），属数学专业排版，不违反「正文可读字体」铁律。

## reader 易读性（v2.1.2 追加）

- `#read-left` 限行宽 `max-width: 40em` 居中（长文 ≈40 汉字/行，宽屏不拉满）。
- `.outline` / `.outline-list` / `.outline-item.lv2|lv3|lv4`：阅读页大纲条（ghost 按钮「☰ 大纲 N」+ 虚线框可折叠列表，14px，hover dashed outline，缩进 10/26/42px）。
- `.ann-quote` 可点（cursor pointer，hover 变 ink 字 + accent 左边条）→ 反向定位左栏高亮。
- 新图标 `read`（打开的书 8×8）：「阅读」导航项 + 首页最近在读卡。

## 计划与日历 / 批注视图（v2.2 追加）

- **批注视图（doc.js）取代独立阅读器**：导航无「阅读」项；#/doc?path|name 打开任意 md（左内容右批注），#/read 为兼容别名；资料库浏览已删（自由浏览归 Obsidian）。
- **首页计划与日历**：`.cal-wrap`（7:5 双栏，窄屏单列）；`.cal-grid` 7 列月历，`.cal-cell` 40px 直角格；热度条 `.cal-heat`（.h1 #83769C / .h2 accent / .h3 ok，4px 底条，活动分=番茄×2+提交+批改）；`.today` accent 描边、`.dl::after` 截止旗标（danger ⚑）、`.cal-due` 到期角标（link 色 10px 左上）；有番茄的格子为链接（开当天日志）。五问 `.q-list`（dl/dt/dd，dt 加粗 14px）。
- **material 作业详情**：批注视图内嵌（header:false），右栏底部 `.material-note`（虚线上边框 + 一句话笔记 + 提交）。
- **wikilink**：md.js 渲染为 `#/doc?name=` 活链接（支持 [[名|别名]]），样式沿用 `.wikilink` 虚线下划线。

## 日历交互与三箱一行（v2.2.1 追加）

- 月历每天都是 `button.cal-cell`（padding:0、inherit 字体、hover dashed outline）；点选态 `.sel`（accent 实底 + #1D2B53 深字）；月历下 `.cal-detail` 虚线框当日详情条（13px，活动/到期/截止 + ghost 小按钮「打开当天日志」「去复习页」），默认选中今天。
- `.grid-3`：三列栅格（三箱一行），窄屏塌单列。
