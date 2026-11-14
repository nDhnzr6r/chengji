# 成迹

纯前端的成绩看板，没有构建步骤：改完 `assets/` 里的文件，刷新浏览器就生效。功能说明和文件结构见 `README.md`。

```bash
npm test    # node --test，61 项
```

动手前先确认 `npm test` 全部通过。改完界面要在浅色、深色、纸与墨三种外观下都看过。

## 两条规矩

### 一、不写死数量与取值

- 科目数量、示例场次、满分上限、类型名长度、图表断点，从 `state.config` 或 `Store` 上的常量取。文案里不写「六科」「四个数」「15 场」这类固定数量，跟着配置走。
- 类型取不到时用 `Store.DEFAULT_TYPE`，不写 `'月考'`。
- 颜色只写在 `assets/app.css` 的变量块里，尺寸也只引用变量。脚本里不出现十六进制颜色；配色缩略图要同时展示两套，颜色放在 `.palette-shot.is-*` 那组变量里，不写进 HTML。
- 版本号只写在 `index.html` 的资源引用上（`?v=`），脚本从自己的 `src` 读，页脚取 `Store.VERSION`。
- 深浅色与配色的读写走 `Store.themeMode()`、`Store.paletteName()`、`Store.writeKey()`、`Store.themeToggleOn()`，不在其他文件里直接操作 localStorage 的那几个键。

### 二、有现成的就用现成的

`assets/store.js` 末尾的导出表是数据层的公共接口。`views.js`、`app.js`、`charts.js` 需要同样的能力时从那里取，不要各写一份：

| 要做什么 | 用哪个 |
| --- | --- |
| 转义 HTML | `Store.esc` |
| 补零、日期与文字互转、月份、时间戳 | `Store.pad2`、`toISO`、`parseISO`、`cnDate`、`monthOf`、`dateTs` |
| 带正负号的数字、百分数 | `Store.signed`、`pctText` |
| 平均、标准差、线性拟合 | `Store.mean`、`stdev`、`indexSlope`、`slopeOf` |
| 找前一场考试 | `Store.prevExamOf` |
| 导出的表头与数据行 | `Store.examHeader`、`examRows` |
| 及格线与优秀线的默认值 | `Store.PASS_RATE_DEFAULT`、`GOOD_RATE_DEFAULT` |
| 科目满分的上限 | `Store.SUBJECT_FULL_MAX` |

同一个文件内部也要复用：`views.js` 里的 `kpiCell`、`kpiStrip`、`deltaClass`、`setField`，`app.js` 里的 `confirmDialog`，`charts.js` 里的 `LAYOUT`。新加页面或卡片时用这些拼，不要另写一份长得差不多的。

样式同理：卡片用 `.card`，输入框用 `.input`，进度条用共用的那组轨道类，表头和数据行共用同一组列宽类。同一个外形不写第二份。
