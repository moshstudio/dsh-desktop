import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationSessionTarget } from './session-target.ts'
import { Select } from './Select.tsx'

export interface ConversationSessionPickerLabels {
  title: string
  hint: string
  target: string
  placeholder: string
  confirm: string
  cancel: string
}

/**
 * Require a deliberate target choice when DSH has no current session id.
 *
 * 这里刻意不预选任何一项：空值是唯一初始状态，确认按钮在用户真正选过之前
 * 保持 disabled。一旦预选「最近的那个会话」，用户点确认就等于让程序替他
 * 决定了目的地。
 */
export function ConversationSessionPicker(props: {
  options: readonly ConversationSessionTarget[]
  labels: ConversationSessionPickerLabels
  onSelect: (sessionId: SessionId) => void
  onCancel: () => void
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<SessionId | ''>('')
  return (
    <Modal
      open
      onClose={props.onCancel}
      title={props.labels.title}
      description={props.labels.hint}
      closeLabel={props.labels.cancel}
      footer={<>
        <Button type="button" variant="ghost" onClick={props.onCancel}>{props.labels.cancel}</Button>
        <Button type="button" variant="primary" disabled={selectedId === ''} onClick={() => { if (selectedId !== '') props.onSelect(selectedId) }}>{props.labels.confirm}</Button>
      </>}
    >
      <Select
        variant="field"
        aria-label={props.labels.target}
        value={selectedId}
        options={[
          { value: '', label: props.labels.placeholder },
          ...props.options.map(option => ({ value: option.id, label: option.title })),
        ]}
        onChange={value => { setSelectedId(value as SessionId | '') }}
      />
    </Modal>
  )
}
