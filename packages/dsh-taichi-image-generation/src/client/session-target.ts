import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/** The fields needed to present explicit conversation targets. */
export type SessionTargetSnapshot = Pick<ReturnType<ISessions['list']['getSnapshot']>, 'ids' | 'byId'>

/** A session the user can explicitly choose as the destination for an image. */
export interface ConversationSessionTarget {
  id: SessionId
  title: string
}

/**
 * The session the conversation column is showing.
 *
 * 列表快照没有 `current`。正在打开的会话由主视图 retain，引用计数投影在
 * 该行的 `retainedBy.mainView` 上（与 `dsh-client-ui-session` 判定主视图的
 * 方式相同）。`ids` 只是展示顺序，不能拿第一项代替用户正在看的会话。
 */
export function currentConversationSessionId(sessions: Pick<ISessions, 'list'> | undefined): SessionId | undefined {
  const snapshot = sessions?.list.getSnapshot()
  if (snapshot?.byId === undefined) return undefined
  const byId = snapshot.byId
  const ids = Array.isArray(snapshot.ids) ? snapshot.ids : []
  for (const id of ids) {
    if (mainViewCount(byId[id]?.retainedBy) > 0) return id
  }
  for (const row of Object.values(byId)) {
    if (row !== undefined && mainViewCount(row.retainedBy) > 0) return row.id
  }
  return undefined
}

/**
 * Main-view retain count projected onto a list row.
 *
 * `mainView` 由界面层声明合并进引用来源，会话控制器自己的类型里没有这个键，
 * 所以按属性名读取，避免为这一处去依赖界面包。
 */
function mainViewCount(retainedBy: object | undefined): number {
  if (retainedBy === undefined || !Object.hasOwn(retainedBy, 'mainView')) return 0
  const value: unknown = Object.getOwnPropertyDescriptor(retainedBy, 'mainView')?.value
  return typeof value === 'number' ? value : 0
}

/**
 * Build explicit targets from the host's listed sessions.
 *
 * @param snapshot - DSH's current session-list snapshot.
 * @returns listed sessions in host order, with the host-projected display title.
 */
export function conversationSessionTargets(snapshot: SessionTargetSnapshot | undefined): ConversationSessionTarget[] {
  // 宿主的列表快照不保证带 `ids`（测试替身与老宿主只给 `current`），
  // 缺了就当作「列不出来」，让调用方报 noSession 而不是崩在渲染里。
  if (snapshot === undefined || !Array.isArray(snapshot.ids)) return []
  return snapshot.ids.map(id => ({
    // displayTitle 是宿主按当前语言投影过的标题；只有老宿主没有它时才退回原始 title。
    id,
    title: snapshot.byId?.[id]?.displayTitle || snapshot.byId?.[id]?.title || String(id),
  }))
}
