import type { Application } from '../../entities/application/model/types'
import type { Program } from '../../entities/program/model/types'

export type PublicationLabels = { budgetLabel: string; paidLabel: string }

export const adminApi = {
  programs: () => fetch('/api/admin/programs').then(r => r.json() as Promise<Program[]>),
  updateProgramPublication: (programCode: string, publicOriginalOnly: boolean) => fetch(`/api/admin/programs/${encodeURIComponent(programCode)}/publication`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicOriginalOnly }) }),
  settings: () => fetch('/api/admin/settings').then(r => r.json() as Promise<PublicationLabels>),
  updateSettings: (labels: PublicationLabels) => fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(labels) }),
  applications: () => fetch('/api/admin/applications').then(r => r.json() as Promise<Application[]>),
  remove: (id: number) => fetch(`/api/admin/applications/${id}`, { method: 'DELETE' }),
  removeByProgram: (programCode: string) => fetch(`/api/admin/applications?program=${encodeURIComponent(programCode)}`, { method: 'DELETE' }),
}
