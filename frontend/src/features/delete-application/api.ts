import { adminApi } from '../../shared/api/admin'
export const deleteApplication = (id: number) => adminApi.remove(id)
