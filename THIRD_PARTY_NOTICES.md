# THIRD_PARTY_NOTICES

本仓库捆绑的第三方组件与其许可协议：

| 组件 | 用途 | 来源 | 许可 |
|---|---|---|---|
| Fusion Pixel 12px（zh_hans proportional） | 像素装饰字体（站名/大数字点缀） | TakWolf/fusion-pixel-font（releases） | OFL-1.1（`static/fonts/OFL.txt`） |
| mermaid.min.js | mermaid 图渲染（阅读器/讲义） | mermaid-js/mermaid | MIT |
| KaTeX 0.16.11（katex.min.js / auto-render.min.js / katex.min.css / fonts） | LaTeX 数学公式渲染（$行内 / $$展示，懒加载） | KaTeX/KaTeX | MIT |

以上组件均为本地 vendor 化（`app/static/vendor/`、`app/static/fonts/`），运行时不请求外部 CDN，学习数据不出本机。
