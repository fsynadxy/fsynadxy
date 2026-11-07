# 桜川町 · 交接文档

给接手这个项目的新会话。读完这一页即可继续工作，不需要翻旧对话。

## 1. 现状一句话

一个可玩的日系樱花小镇 3D 开放世界漫游游戏，已完成并发布。用户的原始需求是：「完全以你的个人审美构建一个主题为日系樱花小镇的 3D 建模大世界游戏，自选引擎，无限制」。目前没有待办的硬性需求，后续工作是用户提出的改进或扩展。

- 仓库：`fsynadxy/fsynadxy`，分支 `claude/admiring-wright-qnf7ed`（已推送；未开 PR，用户没要求）
- 在线可玩页（Artifact，私有）：https://claude.ai/artifact/Feqd4JTi7B2QZPcxJsR5Az （当前 Version 3）
- 技术栈：Three.js **0.180.0**（WebGL2）+ Vite **7.3.7**，纯 JavaScript，无其它依赖
- 所有画面与声音都是代码实时生成，没有图片、模型或音频素材

## 2. 用户偏好

- 用中文交流；礼貌、体贴、知性，语气克制
- 不要问太多问题，能合理决定的就直接做；考虑周全
- 美术方向由 Claude 决定：花曇り式的柔和春日，粉白樱花、深灰瓦、朱红点缀，暗部偏薰衣草、高光偏暖

## 3. 运行、构建、测试

```bash
npm install
npx vite --port 5173          # 开发服务器（测试脚本默认连这个端口）
npm run build                 # 产物在 dist/（base: './'，相对路径）
```

URL 参数：`?q=low|medium|high` 画质，`?t=19.5` 开始时刻，`?fresh` 忽略存档，`?play` 跳过标题，`?timing` 打印生成耗时与统计，`?freeze` 冻结时间，`?cam=x,y,z&look=x,y,z` 固定调试相机，`?shot` 截图模式（不跑动画循环，暴露 `window.__renderOnce(n)` 返回 PNG dataURL）。

调试钩子：`window.__game`（Game 实例）；`window.__noRender = true` 时 `frame()` 只跑逻辑不渲染（逻辑测试快得多）。

### 测试脚本（`tools/`）

无头 Chromium + SwiftShader 软件渲染，需要先开 vite 开发服务器，运行时加 `NODE_PATH=/opt/node-tools/node_modules`。截图输出到当前目录的 `shots/`（先 `mkdir shots`）。

| 脚本 | 用途 |
| --- | --- |
| `multi.cjs <query> <prefix> <views.json>` | 一次加载、按 JSON 渲染多个视角；视角项可带 `cam/look/t/eval/frames`，`"page": true` 时连 HTML 界面一起截图 |
| `functest.cjs` | 玩法回归：走路、八个御朱印、七只猫、所有 NPC 对话（关闭渲染，几十秒） |
| `perf.cjs <low\|medium\|high>` | 统计每帧 draw call、三角形数、JS 帧耗时 |
| `prodtest.cjs <dir>` | 用静态服务器加载发布用页面片段 + `assets/game.js`，模拟 Artifact 骨架，确认生产包能启动 |
| `phone.cjs` | iPhone 13 尺寸的标题页与 HUD 截图 |

注意：软件渲染一帧要 1–7 秒，别在测试里跑几百帧渲染；逻辑测试用 `__noRender`。软件渲染下的耗时不代表真实 GPU 帧率。测试环境里谷歌字体常常加载不到，中文会回退到文泉驿，字形差异不是 bug。

## 4. 如何更新在线页面（Artifact）

发布用的是一个**页面片段**加两个固定名字的资源文件（不要带 `<!doctype>/<html>/<head>/<body>`，发布时会自动包骨架）：

```html
<title>桜川町</title>
<meta name="theme-color" content="#f6efe9">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Shippori+Mincho:wght@500;700&family=Yuji+Syuku&display=swap">
<link rel="stylesheet" href="assets/game.css">
<div id="app">
  <canvas id="view"></canvas>
  <div id="ui"></div>
</div>
<script type="module" src="assets/game.js"></script>
```

步骤：`npm run build` → 把 `dist/assets/index-*.js` 复制为 `assets/game.js`、`dist/assets/index-*.css` 复制为 `assets/game.css`（放在 scratchpad 里，和上面的片段文件 `sakuragawa.html` 同目录）→ 用 Artifact 工具发布。

**新会话里必须先 `action: "read"` 这个 URL，再带 `url` 参数发布**，否则会新建一个链接。发布时 `files` 映射 `assets/game.js`、`assets/game.css`；`icon` 不要再传（已是 `game`）；description 沿用：「一座樱花盛开的日式小镇：沿着花筏流淌的桜川散步，收集八处御朱印，与七只猫和镇上的人相遇——全部画面与声音均为实时程序生成。」

Artifact 环境的限制（已处理，改代码时别破坏）：下载链接无效（拍照模式在 iframe 里改为提示长按/右键保存）；`alert/confirm` 无效（清除进度用页内二次确认）；声音必须由点击启动（标题页按钮里 `audio.init()`）；指针锁定可能被拒（默认关，用拖动转视角）；localStorage 可能抛错（`settings.js` 已全部 try/catch）。

## 5. 代码结构

```
index.html                  开发用入口
src/main.js                 引入样式、启动 Game、显示加载错误
src/core/
  math.js                   RNG、Simplex/fbm、多段线、SegmentGrid、OBB 工具
  input.js                  键鼠/指针锁定/触屏/手柄统一输入（动作名 → 键位表 ACTIONS）
  audio.js                  Web Audio 合成：环境声、鸟蛙、生成式筝与尺八、各种音效
  settings.js               画质档位 QUALITY、设置与存档（localStorage）
src/render/
  shaders.js                全局共享 uniform `U`、自定义雾（全局覆盖 fog 四个 chunk）、patchMaterial
  materials.js              世界材质（程序化图案 PAT）、招牌、树干、樱花树冠、灯笼等材质
  builder.js                GeoBuilder 合批几何构建器、ChunkMap 分块、颜色工具 C()/vary()
  postfx.js                 EffectComposer：Render → Bloom → Output(NeutralToneMapping) → 调色/滤镜
src/world/
  layout.js                 总体规划：河流、道路、铁路、地标坐标、排除区、区域名、出生点
  terrain.js                扭曲网格地形、高度合成、地面着色、草地用高度/颜色纹理
  world.js                  按步骤生成整个世界（见第 7 节）；电车、船、鲤鱼旗的每帧更新
  buildings.js / roofs.js   町屋、民居、古民家、土蔵生成器；切妻/寄棟/入母屋/庇屋顶；沿路布置
  landmarks.js              神社、花雲寺与五重塔、朱橋/石橋/木桥、车站、学校、公园、湖畔栈桥、千年桜
  props.js                  鸟居、石灯笼、狛犬、长椅、售货机、御朱印台、路牌、电线杆与电线等
  roads.js                  道路丝带、运河护岸与护栏、河边灯笼串、田埂
  trees.js                  樱树骨架与花簇树冠、千年垂樱、杉/阔叶/山樱/松/灌木/竹，实例化分组
  petals.js / vegetation.js 飘落花瓣（GPU）与樱花密度图；GPU 草地、野花、地面花瓣
  water.js                  河、湖、水田水面着色（含花筏）
  railway.js                轨道、接触网、铁桥、隧道口、平交道口、两节电车与时刻逻辑
  sky.js                    天空穹顶（云、星、朧月）、远方雪峰「桜嶺」
  colliders.js              碰撞：圆、OBB、墙、可行走表面（桥面/站台/栈桥）、动态碰撞体
  textures.js               画布贴图：樱花簇、竹叶、招牌图集 SignAtlas
src/entities/
  character.js              基本体 + 骨骼蒙皮的角色，外观表 LOOKS，程序化动画
  player.js                 玩家控制器（碰撞、坡度、深水、运河边、地图边界、坐下）
  npcs.js                   镇民站位与巡游路线、行为（扫地/钓鱼/作画/坐/走）
  cats.js                   七只猫、爱心粒子、集齐后跟随的小猫
src/game/
  game.js                   主类：启动、模式切换、交互、事件、HUD、音频环境参数、存档、自适应分辨率
  daynight.js               太阳/月亮位置（北纬 35°、四月），按太阳高度插值的色板关键帧
  camera.js                 跟随相机、电影镜头、拍照自由飞行
  content.js                全部文字：御朱印、猫、御神签、绘马、饮料、商店、NPC 对白、俳句
src/ui/
  ui.js / style.css         加载页、标题、HUD、对话、面板（御朱印帐/地图/菜单）、御神签、拍照、触屏
  minimap.js                由世界数据绘制带山影的底图；小地图随镜头旋转、大地图朝北
  art.js                    御朱印与猫咪小像的画布手绘
tools/                      测试脚本（见第 3 节）
```

## 6. 约定与容易踩的坑

- **坐标**：单位米，+x 东、+z 南、北为 -z。`rot` 一律等于 three.js 的 `rotation.y`：局部 +z 指向世界 `(sin r, cos r)`，局部 +x 指向 `(cos r, -sin r)`。`math.js` 的 `toLocal/toWorld/obbOverlap` 和 `colliders.js` 都用这个约定。
- **角色朝向**：`player.yaw` 是朝向角，朝向向量 `(sin yaw, cos yaw)`，`π` 朝北。相机 `rig.yaw` 表示相机在目标的 `(sin, cos)` 方向，所以「在玩家身后」是 `player.yaw + π`。出生点 `SPAWN.yaw = π + 0.1`（面向北方的并木与雪峰）。
- **颜色**：十六进制按 sRGB 写，`C()` 会转成线性 `THREE.Color`；着色器里的颜色常量是线性值。
- **材质补丁**：每个 `patchMaterial` 必须给唯一 `key`（它就是 `customProgramCacheKey`），否则不同补丁的材质会共用错误的着色器程序。
- **雾**：`shaders.js` 全局覆盖了 three 的 fog chunk，雾的 uniform 由 `patchMaterial` 注入；自写的 ShaderMaterial 用 `petals.js` 里的 `FOG_GLSL/applyFog2` 手动加雾。场景里的 `THREE.Fog` 只为开启 `USE_FOG`。
- **GLSL**：`fwidth/gridLine` 只能在片元着色器（放在 `GLSL_FRAG`）；着色器字符串里不要写中文注释。
- **GeoBuilder 绕向**：`quad(a,b,c,d)` 的法线是 `(b-a)×(d-a)`；`surface` 的法线是 `∂u×∂v`，需要时用 `flip`。新写几何时先想清楚朝向，背面会被剔除看不见。
- **几何体 uv**：世界材质的图案坐标来自 `aPat.xy`（多为米制）；窗户 `PAT.WINDOW`、售货机 `PAT.VENDING` 用 0..1 归一化 uv。夜间自发光强度在 `aPat.w`（`b.pattern(id, emis)`）。
- **地形高度**：碰撞与摆放一律用 `terrain.heightAt`（与渲染网格同一三角剖分）；地形网格在 ±320m 内是 2m 间距，向外几何放大。
- **生成顺序有依赖**：建筑放置要在地形高度之后、地基压平之前；樱树位置要在地面着色之前（地面花瓣色依赖它）；见下一节。
- **ChunkMap.at()** 会把该块构建器的矩阵重置为单位矩阵，同一块里交错建物体时，每次使用前都要重新 `place()`。
- **InstancedMesh**：three r180 不做逐实例剔除，所以樱树与森林按网格拆成多组（樱花 150m、近处森林 170m、远山 650m 且不投影）。改树的数量时注意 draw call 与三角形数。
- **时间测试**：`setTimeout` 驱动的界面（盖章后 0.5 秒打开御朱印帐等）在快速逻辑测试里会在随后的步骤中触发，造成假阳性，不是 bug。

## 7. 世界生成流程（`World.steps()`）

研墨备纸（字体、图集、材质）→ 测量山川（地形高度：河岸相对基准 + 山 + 丘 + 湖 + 铁路路基 + 稻田 + 道路压平 + 石阶 + 河道下切）→ 规划街道（`Town.placeAll` 沿路放 214 栋建筑并压平地基）→ 建造地标 → 种树 → 铺设大地（地面着色、地形网格、草地纹理、樱花密度图）→ 盖町屋 → 道具与灯笼 → 铁路 → 合成静态网格与电线 → 水面 → 树/花瓣/地被 → 天空 → 鲤鱼旗与小船 → 道口、电车与夜间光池。

桌面上总耗时约 3 秒。规模参考：建筑 214（町屋 63、民居 122、古民家 18、土蔵 11），樱树 311 + 千年桜，其它树约 5200（含竹 891），NPC 17，猫 7，灯 345 处。

## 8. 性能数据（`perf.cjs`，软件渲染，仅作相对参考）

- 高画质：约 250–290 draw call，150–180 万三角形/帧（含阴影 pass）
- 低画质：约 240–275 draw call，110–140 万三角形
- JS 每帧约 0.3ms
- 已做的优化：树干精简、树实例按网格分组以便视锥剔除、远山森林不投影、夜间点光源池固定 0/4/6 盏、自适应分辨率（持续低于约 26fps 时逐步把像素比降到 0.55 倍）
- 画质默认值：手机 low/medium，桌面 6 核以上 high

## 9. 已知问题与可改进处

未在真实 GPU 上测过帧率，也没有实际听过声音（无头环境里只确认没有报错）。如果用户反馈卡顿，优先方向：降低 high 档 `pixelRatio`、减少草地数量、给樱花树冠做远距离 LOD。

视觉上可以继续打磨的地方：
- 商店街傍晚时店面偏暗；店铺与石板路之间还留着一条窄草带
- 远山的「树冠纹理」近看有些像拼布
- 俯视时民居排布偏整齐、屋顶颜色在雾中相近
- 车站前广场与道路末端高度接近，可能有轻微 z-fighting
- 镇民走路不与静态碰撞体交互（按固定路线走）

可能的扩展方向（用户未提出，仅备选）：夏日祭/季节切换、春雨天气、更多可进入的室内（和果子店、钱汤）、电车可乘坐、钓鱼小游戏、更多镇民支线、照片相册。

## 10. Git 与提交约定

- 只在 `claude/admiring-wright-qnf7ed` 上开发并推送；不要擅自开 PR
- 提交信息用中文，末尾附：

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NcQToAoZWkBMawNc4Cis28
```

（新会话若收到不同的署名要求，以新会话的为准。）

- 已有提交：`7467cbb` 初版 → `4ce89eb` 打磨 → `bb91750` 修正 → 本交接文档

## 11. 另一个子项目：程序化人物 `figure/`

用户后来的需求：「纯粹用代码构建一个 3D 人物模型，最低三角面 200 万，黑发女高中生」，补充「主题偏向日系二次元」。实现见 README 的「黒髪の少女」一节。要点：

- `figure/model/` 不依赖 three.js，浏览器与 Node 通用；`npm run figure:export` 会打印各部件面数并在不足 200 万时报错（当前约 380 万）。
- 头部有缩放与歪头（`HEAD` in `head.js`），所有头部相关几何都经 `headToWorld/worldToHead`。
- 头发生长 `grow()`：贴着表面时只去掉朝内的分量（滑动）；离开表面后水平分量衰减（自然垂落）；`pushOutTorso` 只沿法线补足距离（之前「投影回表面再外推」会让头发在肩顶上往脖子方向爬）。
- 二次元着色在 `main.js` 的 `toonMaterial`：用主光漫反射反推受光与否（含投影），在固有色与每种材质的阴影色之间切换；皮肤阈值更低且不接收投影，避免脸上出现脏阴影。
- 截图：先开 vite，再 `NODE_PATH=/opt/node-tools/node_modules node tools/figure-shot.cjs shots/x full face`（`PAGE=1` 连界面一起截，`DARK=1` 深色模式）。

### 11.1 人物子项目的当前状态与待办（最新）

- 已推送分支：`claude/optimistic-thompson-k7irvn`（本子项目在这个分支上开发；未开 PR）
- 在线查看页（Artifact，私有）：https://claude.ai/artifact/DDNhQ15YBPdoDBz36qcG93 （Version 2，无导出按钮；含「标准 / 2000万」切换）
  - 更新方法：`npm run figure:build`，把 `dist-figure/assets/index-*.js/.css` 复制为 `assets/figure.js`、`assets/figure.css`，
    页面片段取 `figure/index.html` 的 body（去掉导出按钮，脚本改为 `assets/figure.js`）并加上 `<title>` 与字体、CSS 链接；
    新会话需先 `action: "read"` 该 URL，再带 `url` 发布，`icon` 不再传。
- 当前面数 3,804,322（发束 131 万、制服 98 万、皮肤 57 万、细发丝 43 万……），导出 GLB 约 110 MB。

用户最新反馈（**已完成**，见下方「11.2」；以下保留原始记录）：
1. 「太胖了 / 身子太宽」：收窄肩宽（`torso.js` KEYS 与 `body.js` ARM）、胸腰与上衣松量、裙摆张开度（`clothes.js` SKIRT）、手臂与袖子粗细；
   改躯干后要同步检查：裙子在上衣下摆以上必须在上衣内（留 4–8mm），手不能插进裙子，衣领轮廓点（OUTER/INNER）贴合。
2. 面数要求改为 **2000 万**：计划把模型做成可按档位生成（例如 `buildFigure({ detail })`），
   满档 ≥ 2000 万（主要加在头发：更多更细的发丝；其次脸、衣服细分），导出脚本检查 ≥ 2000 万；
   查看器默认流畅档，另设「2000 万」档按需切换（满档浏览器生成约十几秒、内存约 1 GB、GLB 约 600 MB，手机可能带不动）。
3. 用户正在用提示词生成参考图（三视图、面部特写、背面），收到后按图调整比例、发型、裙长等。

### 11.2 按参考图修改与 2000 万面（已完成）

- 用户给了两张参考图（面部特写 + 三视图）：纤细身形、窄肩、双腿并拢、短款上衣（下摆约 0.955 m）、膝上 A 字百褶裙（下摆 0.615 m）、
  袖口上方蓬起再收进藏青袖口、更深的 V 领（V 点 1.17 m）、胸当上沿两道白线、领缘下露出的红色领巾、及腰黑长直（后发到约 0.82 m）、灰棕色眼睛。
  相关常数：`torso.js` KEYS/NECK、`body.js` ARM/LEG/腿半径、`clothes.js` OUTER/INNER/SKIRT/袖子 R、`hair.js` yStop 与 hangBias。
- 精度档位在 `core.js` 的 `DETAIL/setDetail/RES`：ultra 把网格分段 ×1.6、发束段数与边数加密，并由 `buildHairStrands` 在每束表面铺细发丝
  （`strandsPerLock`，当前 34）。细发丝网格用显式法线（`explicitNormals`）。当前 ultra 22,030,921 面、standard 4,261,038 面。
- 查看器「精度」按钮会释放旧模型并重建；`?detail=ultra` 直接以 2000 万档打开。细发丝不投影。
- `npm run figure:export` 默认导出 ultra（约 635 MB）并检查 ≥ 2000 万；`-- --detail standard` 导出标准档。
- 写文件的 Python 脚本一律先写临时文件再 `os.replace`（曾因脚本报错把 hair.js 截成空文件，已从 git 恢复）。
