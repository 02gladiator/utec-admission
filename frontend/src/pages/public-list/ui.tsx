import { useEffect, useRef, useState } from 'react'
import logo from '../../shared/assets/utec-logo.png'
import './mobile.css'

type Program = { code: string; name: string; budgetSeats: number; paidSeats: number }
type Row = { name: string; averageScore: number; originalGiven: boolean; overallRank: number; originalRank?: number; budgetOverall: boolean; budgetOriginal: boolean; matched: boolean }
type ListResponse = { program: Program; applications: Row[] }
const publicStateKey = 'utec-public-list-state'

function loadPublicState() {
  try { return JSON.parse(localStorage.getItem(publicStateKey) || '{}') } catch { return {} }
}

export default function App() {
  const savedState = loadPublicState()
  const [programs, setPrograms] = useState<Program[]>([])
  const [programCode, setProgramCode] = useState(savedState.programCode || '21.02.19')
  const [onlyOriginal, setOnlyOriginal] = useState(Boolean(savedState.onlyOriginal))
  const [fio, setFio] = useState(savedState.fio || '')
  const [searchFio, setSearchFio] = useState(savedState.fio || '')
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const matchedRowRef = useRef<HTMLTableRowElement | null>(null)

  useEffect(() => { fetch('/api/public/programs').then(r => r.json()).then(setPrograms) }, [])
  useEffect(() => {
    const delay = window.setTimeout(() => setSearchFio(fio), 350)
    return () => window.clearTimeout(delay)
  }, [fio])
  useEffect(() => { localStorage.setItem(publicStateKey, JSON.stringify({ programCode, onlyOriginal, fio })) }, [programCode, onlyOriginal, fio])
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ program: programCode, original: String(onlyOriginal), fio: searchFio })
    fetch(`/api/public/applications?${params}`).then(r => r.json()).then(setData).finally(() => setLoading(false))
  }, [programCode, onlyOriginal, searchFio])
  useEffect(() => {
    if (searchFio.trim() && matchedRowRef.current) {
      matchedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    }
  }, [data, searchFio])

  return <main className="public-list">
    <header className="header"><img src={logo} alt="Уфимский торгово-экономический колледж" /><a href="#lists">Конкурсные списки</a></header>
    <section className="hero"><div><p className="eyebrow">ПРИЁМНАЯ КОМИССИЯ</p><h1>Конкурсные списки</h1><p className="subtitle">Проверьте своё место в рейтинге и наличие оригинала документа.</p></div></section>
    <section id="lists" className="content">
      <div className="notice"><span>i</span><p>ФИО скрыты для защиты персональных данных. Введите полное ФИО, чтобы увидеть свою строку.</p></div>
      <div className="filters">
        <label>Специальность<select value={programCode} onChange={e => setProgramCode(e.target.value)}>{programs.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</select></label>
        <label className="search">Ваше ФИО<input value={fio} onChange={e => setFio(e.target.value)} placeholder="Например, Иванов Иван Иванович" autoComplete="name" /></label>
        <label className="toggle"><input type="checkbox" checked={onlyOriginal} onChange={e => setOnlyOriginal(e.target.checked)} /><span>Только с оригиналом</span></label>
      </div>
      {data && <><div className="summary"><div><b>{data.program.budgetSeats}</b><span>бюджетных мест</span></div><div><b>{data.program.paidSeats}</b><span>коммерческих мест</span></div><p>Рейтинг обновляется после публикации приёмной комиссией.</p></div>
      <div className="legend"><span className="dot green" />В пределах бюджетных мест <span className="dot blue" />Оригинал документа</div>
      <div className="table-wrap"><table><thead><tr><th>ФИО</th><th>Средний балл</th><th>Оригинал</th><th>Общий рейтинг</th><th>Рейтинг с оригиналом</th></tr></thead><tbody>{data.applications.length === 0 ? <tr><td colSpan={5}>Заявлений пока нет.</td></tr> : data.applications.map(row => <tr ref={row.matched ? matchedRowRef : undefined} key={`${row.name}-${row.overallRank}`} className={`${row.budgetOverall ? 'budget' : ''} ${row.matched ? 'matched' : ''}`}><td>{row.name}</td><td className="score">{row.averageScore.toFixed(3).replace('.', ',')}</td><td><span className={row.originalGiven ? 'check' : 'empty'}>{row.originalGiven ? '✓ Есть' : '—'}</span></td><td>{row.overallRank}</td><td>{row.originalRank ?? '—'}</td></tr>)}</tbody></table></div>{loading && <p className="updating">Обновляем результат поиска…</p>}</>}
    </section>
    <footer>© Уфимский торгово-экономический колледж · Приёмная комиссия</footer>
  </main>
}
