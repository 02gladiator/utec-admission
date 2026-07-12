import type { Application } from '../../entities/application/model/types'
import type { Program } from '../../entities/program/model/types'

export const adminApi = {
  programs: () => fetch('/api/admin/programs').then(r => r.json() as Promise<Program[]>),
  applications: () => fetch('/api/admin/applications').then(r => r.json() as Promise<Application[]>),
  remove: (id: number) => fetch(`/api/admin/applications/${id}`, { method: 'DELETE' }),
}
