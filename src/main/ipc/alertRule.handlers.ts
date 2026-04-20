/**
 * Alert Rule IPC Handlers (Phase 5A)
 *
 * Bridges renderer ↔ main process for custom alert rule CRUD.
 */

import { ipcMain } from 'electron'
import { listRules, createRule, updateRule, deleteRule, toggleRule } from '../services/alerts/ruleEngine'

const CHANNELS = {
  LIST: 'alert-rules:list',
  CREATE: 'alert-rules:create',
  UPDATE: 'alert-rules:update',
  DELETE: 'alert-rules:delete',
  TOGGLE: 'alert-rules:toggle'
} as const

export function registerAlertRuleHandlers(): void {
  console.log('[AlertRules] Registering IPC handlers')

  ipcMain.handle(CHANNELS.LIST, async () => {
    return listRules()
  })

  ipcMain.handle(CHANNELS.CREATE, async (_event, rule: Record<string, unknown>) => {
    const id = createRule({
      name: rule.name as string,
      enabled: rule.enabled !== false,
      entity_type: rule.entity_type as 'ship' | 'aircraft' | 'csg',
      filters: (rule.filters as Array<{ field: string; operator: string; value: string | number }>) ?? [],
      trigger: (rule.trigger as { count_threshold: number; count_operator: string; time_window_minutes: number })
        ?? { count_threshold: 1, count_operator: '>', time_window_minutes: 0 },
      area: rule.area as { region: string } | { point: [number, number]; radius: number },
      severity: (rule.severity as 'ALERT' | 'WATCH' | 'CONTEXT') ?? 'WATCH',
      label: rule.label as string,
      cooldown_minutes: (rule.cooldown_minutes as number) ?? 30
    })
    return { id }
  })

  ipcMain.handle(CHANNELS.UPDATE, async (_event, id: string, updates: Record<string, unknown>) => {
    return updateRule(id, updates as Parameters<typeof updateRule>[1])
  })

  ipcMain.handle(CHANNELS.DELETE, async (_event, id: string) => {
    return deleteRule(id)
  })

  ipcMain.handle(CHANNELS.TOGGLE, async (_event, id: string) => {
    return toggleRule(id)
  })
}