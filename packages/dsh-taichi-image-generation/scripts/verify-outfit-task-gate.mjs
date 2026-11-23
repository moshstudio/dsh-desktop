// 门禁：服饰穿戴提交必须走宿主异步任务队列，并能从任务卡恢复状态。
// 反向验证用它做基线：把 taskSubmit 改回阻塞式 generate 会令下列断言变红。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const source = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'src/client/OutfitWorkspace.tsx'), 'utf8')

// 每个缺失模式 = 一个会复现用户反馈的缺陷：
//   - 不用 taskSubmit：提交阻塞在请求里，切页后无任务记录可恢复；
//   - 不轮询 taskList：回到面板看不到进行中/失败任务；
//   - 不渲染 taskCard：等待中没有提示。
const required = [
  ['api.taskSubmit(', '提交走异步任务队列'],
  ['api.taskList()', '进面板恢复任务'],
  ['css.taskCard', '任务卡显示等待/结果'],
]

// 跟拍必须写在 refreshTasks 里。挂载时列表通常是空的，只在 effect 里看到
// 「没有进行中任务」就停，提交之后那一次刷新会把卡片停在「正在生成」，
// 而左侧历史已经由宿主轮询写上了结果。
const refreshStart = source.indexOf('const refreshTasks = async')
const refreshEnd = refreshStart < 0 ? -1 : source.indexOf('useEffect', refreshStart)
const refreshBody = refreshStart >= 0 && refreshEnd > refreshStart ? source.slice(refreshStart, refreshEnd) : ''
const followsActiveTask = refreshBody.includes('setTimeout')
  && refreshBody.includes("task.status === 'queued'")
  && refreshBody.includes("task.status === 'running'")
if (!followsActiveTask) {
  console.error('MISSING follow-up poll：进行中的服饰任务必须在 refreshTasks 里继续轮询，不能只在挂载那一轮排计时器')
  process.exit(1)
}

// 反向：面板里不得再自带一份历史列表。宿主的左侧历史已经列出每次生成，
// 面板里重复一份只是把同一批图渲染两遍，还让「这条结果属于哪次提交」更难看清。
// 这两条一旦回退（又把 historyList 拉回来、或重新渲染 history 区块）必须变红。
const forbidden = [
  ['api.historyList()', '历史由宿主左侧列表承担，面板不再自行拉取'],
  ['css.historyGrid', '面板不再渲染历史缩略图网格'],
]

const missing = required.filter(([needle]) => !source.includes(needle))
if (missing.length > 0) {
  for (const [, label] of missing) console.error(`MISSING ${label}`)
  console.error(`MISSING ${missing.map(([needle]) => needle).join(' | ')}`)
  process.exit(1)
}
const present = forbidden.filter(([needle]) => source.includes(needle))
if (present.length > 0) {
  for (const [, label] of present) console.error(`FORBIDDEN ${label}`)
  console.error(`FORBIDDEN ${present.map(([needle]) => needle).join(' | ')}`)
  process.exit(1)
}
console.log('PASS 服饰穿戴任务队列链路存在，且面板不再重复宿主历史')
