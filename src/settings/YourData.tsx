import { useCallback, useEffect, useState } from 'react'
import { FORGET_AGES, INVENTORY_SOURCE_LABEL, isErasableSource, type DataInventory } from '@shared/privacy'
import { KEEP_EXAMPLES, KEEP_PROCESSED_DAYS, KEEP_TOMBSTONE_DAYS } from '@shared/retention'
import { Button } from '@/ui/Button'
import { cn } from '@/ui/cn'
import { clientOs, THIS_DEVICE } from '@/ui/device'
import { fieldClass, Group, Page, Pill, Row, Select } from './controls'
import type { SettingsActions, SettingsData } from './pages'

interface PageProps {
  data: SettingsData
  actions: SettingsActions
}

function n(value: number): string {
  return value.toLocaleString()
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

function forgotten(result: { canceled: boolean; removed: number }): string | undefined {
  if (result.canceled) return undefined
  return result.removed === 0 ? 'Nothing to forget' : `Forgot ${n(result.removed)} item${result.removed === 1 ? '' : 's'}`
}

function Backup({ actions: { run, busy } }: Pick<PageProps, 'actions'>) {
  const [passphrase, setPassphrase] = useState('')
  const ready = passphrase.length >= 8
  return (
    <Group
      title="Backup"
      footer={`An encrypted copy of the database: tasks, recurring rules, decisions and learned examples. Without the passphrase nobody can open it. Settings and your Google sign-in stay on ${THIS_DEVICE}.`}
    >
      <Row label="Passphrase" htmlFor="backup-passphrase">
        <input
          id="backup-passphrase"
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="At least 8 characters"
          className={cn(fieldClass, 'w-48')}
        />
      </Row>
      <Row label="Save or restore" description="Restoring replaces what’s here and restarts AmbientMind; the current database is kept beside it.">
        <Button
          size="sm"
          disabled={!!busy || !ready}
          onClick={() =>
            void run('Writing backup…', async () => {
              const result = await window.ambient.exportBackup(passphrase)
              if (result.canceled) return
              setPassphrase('')
              return `Backup saved to ${result.path}`
            })
          }
        >
          Save backup…
        </Button>
        <Button
          size="sm"
          disabled={!!busy || !ready}
          onClick={() =>
            void run('Restoring…', async () => {
              await window.ambient.restoreBackup(passphrase)
            })
          }
        >
          Restore…
        </Button>
      </Row>
    </Group>
  )
}

export function YourData({ data: { appInfo }, actions }: PageProps) {
  const { run, busy } = actions
  const [inventory, setInventory] = useState<DataInventory | null>(null)
  const [age, setAge] = useState<number>(FORGET_AGES[1].days)
  const load = useCallback(async () => setInventory(await window.ambient.privacy.inventory()), [])

  useEffect(() => {
    void load()
  }, [load])

  const forget = (label: string, task: () => Promise<{ canceled: boolean; removed: number }>) =>
    void run(label, async () => {
      const result = await task()
      await load()
      return forgotten(result)
    })

  return (
    <Page title="Your data" description={`Everything AmbientMind keeps, all of it on ${THIS_DEVICE}, and the ways to take it back.`}>
      {inventory && (
        <>
          <Group
            title="Tasks, by where they came from"
            footer="Forgetting a source removes its tasks and the decisions made about them. A connected source is still read from now on; disconnect it in Sources to stop that."
          >
            {inventory.tasks.length === 0 ? (
              <Row label="No tasks yet" />
            ) : (
              inventory.tasks.map((row) => (
                <Row
                  key={row.source}
                  label={INVENTORY_SOURCE_LABEL[row.source]}
                  description={`${n(row.open)} open · ${n(row.finished)} finished`}
                >
                  {isErasableSource(row.source) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() => {
                        const source = row.source
                        if (isErasableSource(source)) forget('Forgetting…', () => window.ambient.privacy.forgetSource(source))
                      }}
                    >
                      Forget…
                    </Button>
                  )}
                </Row>
              ))
            )}
          </Group>

          <Group
            title="Also kept"
            footer={
              inventory.oldest
                ? `The oldest thing kept is from ${day(inventory.oldest)}. Old entries are cleared on their own as they pass the limits above.`
                : 'Old entries are cleared on their own as they pass the limits above.'
            }
          >
            <Row label="Past mail, to guide the model" description={`Mail and what was found in it, so the next one is read better. Up to ${n(KEEP_EXAMPLES)}.`}>
              <Pill tone="quiet">{n(inventory.examples)}</Pill>
            </Row>
            <Row label="Mail and events already read" description={`Ids only, so nothing is read twice. Kept ${KEEP_PROCESSED_DAYS} days.`}>
              <Pill tone="quiet">{n(inventory.itemsRead)}</Pill>
            </Row>
            <Row label="Deleted tasks" description={`Kept without their details for ${KEEP_TOMBSTONE_DAYS} days, so a sync doesn’t add them back.`}>
              <Pill tone="quiet">{n(inventory.tombstones)}</Pill>
            </Row>
            <Row label="Decisions" description="What you did with suggestions: accepted, deleted, snoozed. It’s how AmbientMind learns.">
              <Pill tone="quiet">{n(inventory.decisions)}</Pill>
            </Row>
            <Row label="Recurring rules">
              <Pill tone="quiet">{n(inventory.rules)}</Pill>
            </Row>
            <Row label="Chat history" description="The last 40 messages, so a conversation can carry on.">
              <Pill tone="quiet">{n(inventory.chatTurns)}</Pill>
              <Button size="sm" variant="ghost" disabled={!!busy || inventory.chatTurns === 0} onClick={() => forget('Clearing…', () => window.ambient.privacy.clearChat())}>
                Clear…
              </Button>
            </Row>
            <Row label="AI call log" description="Which engine answered and how long it took. Never what was asked.">
              <Pill tone="quiet">{n(inventory.aiCalls)}</Pill>
              <Button size="sm" variant="ghost" disabled={!!busy || inventory.aiCalls === 0} onClick={() => forget('Clearing…', () => window.ambient.privacy.clearAiLog())}>
                Clear…
              </Button>
            </Row>
          </Group>

          <Group title="Forget by date" footer="Your open tasks and recurring rules always stay.">
            <Row label="Older than" description="Finished and deleted tasks, read-mail records, decisions, past mail and log entries.">
              <Select aria-label="Older than" value={String(age)} onChange={(e) => setAge(Number(e.target.value))}>
                {FORGET_AGES.map((option) => (
                  <option key={option.days} value={option.days}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Button size="sm" disabled={!!busy} onClick={() => forget('Forgetting…', () => window.ambient.privacy.forgetBefore(age))}>
                Forget…
              </Button>
            </Row>
          </Group>
        </>
      )}

      <Group>
        <Row label="Export" description="Tasks, recurring rules, decisions, chat history and settings as JSON. No passwords or sign-in tokens.">
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void run('Exporting…', async () => {
                const result = await window.ambient.privacy.exportData()
                return result.canceled ? undefined : `Exported to ${result.path}`
              })
            }
          >
            Export…
          </Button>
        </Row>
      </Group>

      <Backup actions={actions} />

      <Group>
        <Row label="Data folder" description={<span className="font-mono text-micro break-all">{inventory?.dataFolder ?? appInfo?.userData ?? '…'}</span>}>
          <Button size="sm" onClick={() => void window.ambient.openUserData()}>
            {clientOs === 'mac' ? 'Show in Finder' : 'Show in Explorer'}
          </Button>
        </Row>
      </Group>
    </Page>
  )
}
