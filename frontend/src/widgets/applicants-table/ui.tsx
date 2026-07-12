import type { Application } from '../../entities/application/model/types'

type Props = { items: Application[]; title: string; onEdit: (item: Application) => void; onDelete: (item: Application) => void }

export function ApplicantsTable({ items, title, onEdit, onDelete }: Props) {
  return <section className="draft-list"><h2>{title} <span>{items.length} заявлений</span></h2><table><thead><tr><th>СНИЛС</th><th>ФИО</th><th>Балл</th><th>Оригинал</th><th>Льгота</th><th>Действия</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.snils}</td><td>{item.fullName}</td><td>{item.averageScore.toFixed(3)}</td><td>{item.originalGiven?'✓':'—'}</td><td>{item.benefit?'✓':'—'}</td><td><button onClick={()=>onEdit(item)}>Изм.</button><button onClick={()=>onDelete(item)}>Удалить</button></td></tr>)}</tbody></table></section>
}
