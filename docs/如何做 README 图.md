# 怎么做这个仓的 README 图

写给以后（包括我自己）。目标只有三条：**一屏看懂、总量别压人、图必须是真的**。

- **一屏看懂**：读者 5 秒内要知道「这插件解决什么问题」。所以第一屏是标题 + 一句话 + 一张横幅 + 四个镜头。
- **总量别压人**：README 里的媒体总量控制在 **1 MB 以内**（本仓现在 ≈ 600 KB）。GitHub 会**预加载** README 里的图，
  一个 1.78 MB 的 GIF 能让人在地铁上看半天空白 —— 这就是"插件没反馈"的头号非代码原因。
- **图必须是真的**：真机截图 > 手绘示意图。示意图读者一眼就知道是画的，可信度立刻打折。

## 工具链（本机都有）

| 用途 | 用什么 |
|---|---|
| 拍图 | Playwright（本机 `dev-browser` 自带：`<本地路径>`） |
| 裁剪 / 压缩 / 取帧 | ImageMagick：`<本地路径>` |
| 宿主 | `dsh --profile demo --port 3081 --no-open`（**不要碰 3080**），拿到它打印的 `?token=` |

## 拍静态图（本仓 `docs/shots/*.png` 就是这么来的）

要点，一条都不能省：

1. `newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 })` —— 2 倍缩放，文字在高分屏才不糊。
2. **裁剪到输入框周边**，不要把整页浏览器（含侧栏、顶部导航）拍进去：
   `clip = { x: box.x - 60, y: box.y - 70, width: box.width + 120, height: box.height + 260 }`。
3. **每个场景开始前先 `Escape` 再清空输入框** —— 否则上一场景的弹层会跟着进下一张（我第一版就这么拍坏过）。
4. 弹层/菜单**向上展开**的场合（比如 `/` 菜单），裁不出来就**拍全页再裁**：
   `magick 02-slash-menu.png -crop 1650x620+470+110 +repage out.png`。
5. 一张图只讲一件事：标红就只留标红（按 `Escape` 收掉补全弹层再拍）。

体积：单张 PNG 控制在 **30–130 KB**（1656×624、2 倍缩放，实测 32–124 KB）。

## 压动图（GIF）

本仓动图从 **1.78 MB 压到 349 KB（−80%）**，就这一条命令：

```bash
magick docs/demo.gif -coalesce -resize 560x -fuzz 3% -colors 64 -layers Optimize docs/demo-small.gif
```

两个必须知道的坑：

- **直接 `-layers Optimize` 会把每帧裁成"与上一帧的差异区"**，之后单独取帧会得到 1×1 的小图。
  要取帧校验可读性，必须带 `-coalesce`：
  ```bash
  magick docs/demo-small.gif -coalesce -delete 0-59 -delete 1--1 frame60.png
  ```
- **先 `-coalesce` 再 `-resize` 反而会变大**（实测 2055 KB）：因为 coalesce 把每帧展开成整图，
  后续 Optimize 只能靠颜色量化省。所以顺序是 `-coalesce`（仅为正确性）→ `-resize` → `-fuzz`/`-colors` → `-layers Optimize`，
  并且**必须带颜色量化**才真的变小。

## 写作约定

- 每张图都写 alt 文本（`![补全弹层](docs/shots/01-completion.png)`），别留空 —— 无障碍与弱网都靠它。
- README 里图用**两列表格**排，窄屏也读得下；表格里每格配一句"这张在讲什么"。
- **不要用 shield 版本徽章**：它不会跟着 `package.json` 走，迟早显示错版本（本仓宁可少一个徽章）。
- 图文件放 `docs/shots/`（截图）与 `docs/`（横幅/动图），不要塞进 `lib/`。

## 拍完怎么验

```bash
node tools/check-docs.mjs       # 相对链接必须存在 + 行数预算（不查图片体积）
magick identify docs/shots/*.png docs/*.gif | awk '{print $3, $7}'   # 看尺寸与体积
```

图片体积没有闸，靠上面那条命令人看一下；哪天总量超 1 MB 就回来压。

## 用专门工具录，而不是手工拼（2026-10-22 补）

本仓现在有一条**可复现**的录制管线：`tools/record-demo.mjs`。

```bash
# 1) 依赖装在一个不进仓的目录里（本机示例）
#    npm i gifenc pngjs
# 2) 起演示宿主
#    dsh --profile demo --port 3081 --no-open     # 拿它打印的 ?token=
# 3) 录
DEMO_DEPS=<本地路径> \
  node tools/record-demo.mjs "http://127.0.0.1:3081/?token=…" \
  --out docs/demo.gif --width 680 --colors 128 --format rgb565 --stride 2
```

- **抓帧**：Playwright 边操作边 `page.screenshot()`，每帧带真实时间戳；
- **编码**：`gifenc`（纯 JS 的 GIF 编码器，专门做调色板量化）用**全局调色板**写帧，`dispose: 2` 让帧间只存差异；
- **两个压缩旋钮**：`--colors`（128 够用；64 会把强调色偏色，实测红色波浪线变橙）、
  `--stride`（抽帧：1/2 约 7fps、1/3 约 4fps；延迟会累加，所以**播放时长不变，只是采样变疏**）。

**为什么不用 ffmpeg**：本机取 `ffmpeg-static` 时被加速代理的 TLS 中间人挡住
（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`），而 `gifenc` 只走 npm registry，装得上；flat UI 上 128 色全局调色板肉眼看不出损失。
哪天代理关掉、能装 ffmpeg，可以换成 `-vf "fps=12,scale=680:-1:flags=lanczos,palettegen/paletteuse"` 两遍调色板，质量更好。

**剧本要避开插件自己的机制**：我第一版剧本用三反引号开围栏，结果反引号被插件自动配对成 `` `` ``，整个剧本跑偏
（录出来输入框只剩一个 `d`）。现在四幕都用普通打字：`def` → ↑↓ → `Tab` → `docum` → 半句引号。

## 改 SVG 一定要渲染出来看（2026-10-22 踩到）

`docs/banner.svg` 之前是**错的**：标题写着 `dsh-composer-pro`（插件叫 `dsh-composer-ease`）、只讲三类候选、
右下角文字溢出卡片、示例还是内部的 `临时目录/attrib-index.diff`。这些在源码里看不出来，**渲出来一眼就看见**。

渲染方式：**用 Chromium，不要用 ImageMagick**——IM 对 `ui-monospace` 与中文回退字体支持差，
直接 `magick banner.svg out.png` 会失败（本机实测 0 字节输出 + font fallback 警告）。

```js
// 简化版：SVG 内联进 HTML 再截（直接截 SVG 文档会卡在"等字体"超时）
const svg = fs.readFileSync(svgPath, 'utf8')
await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">' + svg + '</body>')
await page.waitForTimeout(600)
await page.screenshot({ path: outPath })      // deviceScaleFactor: 2 更清楚
```

判据（改 banner 的最小流程）：

1. 改完先渲染成 PNG，**用视觉看一眼**——名字对不对、有没有溢出、强调色还是不是红色；
2. 再看它在 GitHub 上的呈现：README 里是 `<img src="docs/banner.svg">`，GitHub 会按文件尺寸原样显示，
   所以 **尺寸就用 1200×300**，别指望它自适应；
3. 内容要与当前功能一致（候选几类、菜单几行），**功能变了就回来改 banner**——它就是"首屏广告"。

现在的 banner 结构（可直接沿用）：身份标签（右上）→ 名字 → 一句话 → 四个能力胶囊 → 一行事实（零依赖/不改源码/一条命令）
→ 右侧输入框示意（`docum` + 灰字 `ent`）+ 补全弹层（三行，首行高亮带左侧强调条）+ 左下红色波浪线示例。
