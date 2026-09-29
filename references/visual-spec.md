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
