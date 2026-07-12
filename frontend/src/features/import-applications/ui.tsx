import { useState } from "react";
import { parseXlsx, type ExcelPreview } from "./lib/parse-xlsx";

type Field = "snils" | "fullName" | "averageScore" | "originalGiven" | "benefit";
type Mapping = Record<Field, string>;
const labels: Record<Field, string> = { snils: "СНИЛС", fullName: "ФИО", averageScore: "Средний балл", originalGiven: "Оригинал", benefit: "Льгота" };
function guess(headers: string[]): Mapping { const find = (words: string[]) => headers.find(h => words.some(w => h.toLowerCase().includes(w))) || ""; return { snils: find(["снилс"]), fullName: find(["фио", "фамил"]), averageScore: find(["балл", "средн"]), originalGiven: find(["оригин"]), benefit: find(["льгот"]) } }
function validateRow(row: Record<string, unknown>, mapping: Mapping) { const snils = String(row[mapping.snils] ?? "").replace(/\D/g, ""); const name = String(row[mapping.fullName] ?? "").trim().split(/\s+/); const rawScore = String(row[mapping.averageScore] ?? "").trim(); const score = Number(rawScore.replace(",", ".")); if (snils.length !== 11) return "СНИЛС"; if (name.length < 3) return "ФИО"; if (!/^(?:[0-4](?:[.,]\d{1,3})?|5(?:[.,]0{1,3})?)$/.test(rawScore) || !Number.isFinite(score)) return "средний балл"; return "" }

export function ExcelImport({ programCode, existingSnils, onImported }: { programCode: string; existingSnils: string[]; onImported: () => void }) {
  const [preview, setPreview] = useState<ExcelPreview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ snils:"", fullName:"", averageScore:"", originalGiven:"", benefit:"" });
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const normalized = (value: unknown) => String(value ?? '').replace(/\D/g, '')
  const duplicates = preview ? preview.rows.filter(row => existingSnils.map(normalized).includes(normalized(row[mapping.snils]))) : []
  async function importRows() { if (!preview || !mapping.snils || !mapping.fullName || !mapping.averageScore) return; const valid = preview.rows.filter(row => !validateRow(row, mapping) && !existingSnils.map(normalized).includes(normalized(row[mapping.snils]))); const responses = await Promise.all(valid.map(async row => { const response = await fetch('/api/admin/applications', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({snils:String(row[mapping.snils]),fullName:String(row[mapping.fullName]),programCode,averageScore:Number(String(row[mapping.averageScore]).replace(',','.')),originalGiven:['да','yes','true','1'].includes(String(row[mapping.originalGiven]).toLowerCase()),benefit:['да','yes','true','1'].includes(String(row[mapping.benefit]).toLowerCase())}) }); const body = await response.json().catch(()=>({})); return { row, response, reason: body.error || 'неизвестная ошибка' } })); const failed = responses.filter(x=>!x.response.ok); setImportErrors(failed.map(x => `${String(x.row[mapping.fullName])}: ${x.reason}`)); setResult(`Добавлено: ${responses.length - failed.length}. Уже были в списке: ${duplicates.length}. Не добавлено: ${failed.length}.`); onImported() }
  return (
    <div className="excel-import">
      <label>
        Excel-файл
        <input
          key={fileInputKey}
          type="file"
          accept=".xlsx,.xls"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPreview(null); setError(""); setResult(""); setImportErrors([]);
            try {
              const parsed = await parseXlsx(file); setPreview(parsed); setMapping(guess(parsed.headers));
              setError("");
            } catch {
              setError("Не удалось прочитать Excel-файл.");
            } finally { setFileInputKey(key => key + 1); }
          }}
        />
      </label>
      {error && <p>{error}</p>}
      {preview && (
        <>
          <p>
            Лист: <b>{preview.activeSheet}</b> · строк: {preview.rows.length}
          </p>
          <div className="excel-mapping">{(Object.keys(labels) as Field[]).map(field=><label key={field}>{labels[field]}<select value={mapping[field]} onChange={e=>setMapping({...mapping,[field]:e.target.value})}><option value="">Не выбрано</option>{preview.headers.map(header=><option key={header} value={header}>{header}</option>)}</select></label>)}</div>
          <div className="excel-preview">
            {preview.rows.slice(0, 5).map((row, i) => (
              <p key={i}>{(Object.keys(labels) as Field[]).map(field=>mapping[field] ? String(row[mapping[field]] ?? "—") : "—").join(" · ")}</p>
            ))}
          </div>
          {mapping.snils && mapping.fullName && mapping.averageScore && <div className="excel-validation">{(() => { const invalid = preview.rows.map((row, index) => ({ index: index + 2, error: validateRow(row, mapping) })).filter(item => item.error); return <><p>Проверка: <b>{preview.rows.length - invalid.length}</b> корректных строк, <b>{invalid.length}</b> с ошибками.</p>{invalid.slice(0, 10).map(item => <p key={item.index}>Строка {item.index}: неверно заполнено поле «{item.error}».</p>)}</> })()}</div>}
          {duplicates.length > 0 && <p>Уже есть в этой специальности: {duplicates.length}. Эти строки будут пропущены.</p>}
          <button type="button" onClick={importRows}>Импортировать корректные строки</button>{result && <p>{result}</p>}
          {importErrors.length > 0 && <div className="excel-errors">{importErrors.slice(0,10).map(error => <p key={error}>{error}</p>)}</div>}
        </>
      )}
    </div>
  );
}
