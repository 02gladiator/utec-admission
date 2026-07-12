import { useState } from "react";
import { parseXlsx, type ExcelPreview } from "./lib/parse-xlsx";

type Field = "snils" | "fullName" | "averageScore" | "originalGiven" | "benefit";
type Mapping = Record<Field, string>;
type ImportError = { row: number; fullName: string; error: string };
type ImportResult = { created: number; updated: number; errors: ImportError[] };

const labels: Record<Field, string> = {
  snils: "СНИЛС",
  fullName: "ФИО",
  averageScore: "Средний балл",
  originalGiven: "Оригинал",
  benefit: "Льгота",
};

function guess(headers: string[]): Mapping {
  const find = (words: string[]) => headers.find((header) => words.some((word) => header.toLowerCase().includes(word))) || "";
  return {
    snils: find(["снилс"]),
    fullName: find(["фио", "фамил"]),
    averageScore: find(["балл", "средн"]),
    originalGiven: find(["оригин"]),
    benefit: find(["льгот"]),
  };
}

function validateRow(row: Record<string, unknown>, mapping: Mapping) {
  const snils = String(row[mapping.snils] ?? "").replace(/\D/g, "");
  const name = String(row[mapping.fullName] ?? "").trim().split(/\s+/);
  const rawScore = String(row[mapping.averageScore] ?? "").trim();
  const score = Number(rawScore.replace(",", "."));
  if (snils.length !== 11) return "СНИЛС";
  if (name.length < 3) return "ФИО";
  if (!/^(?:[0-4](?:[.,]\d{1,3})?|5(?:[.,]0{1,3})?)$/.test(rawScore) || !Number.isFinite(score)) return "средний балл";
  return "";
}

function isTrue(value: unknown) {
  return ["да", "yes", "true", "1"].includes(String(value ?? "").trim().toLowerCase());
}

export function ExcelImport({ programCode, onImported }: { programCode: string; onImported: () => void }) {
  const [preview, setPreview] = useState<ExcelPreview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ snils: "", fullName: "", averageScore: "", originalGiven: "", benefit: "" });
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  async function importRows() {
    if (!preview || !mapping.snils || !mapping.fullName || !mapping.averageScore) return;
    const invalid = preview.rows
      .map((row, index) => ({ row, rowNumber: index + 2, error: validateRow(row, mapping) }))
      .filter((item) => item.error);
    const applications = preview.rows
      .map((row, index) => ({ row, rowNumber: index + 2, error: validateRow(row, mapping) }))
      .filter((item) => !item.error)
      .map(({ row, rowNumber }) => ({
        row: rowNumber,
        snils: String(row[mapping.snils]),
        fullName: String(row[mapping.fullName]),
        averageScore: Number(String(row[mapping.averageScore]).replace(",", ".")),
        originalGiven: isTrue(row[mapping.originalGiven]),
        benefit: isTrue(row[mapping.benefit]),
      }));
    if (!applications.length) return;

    setImporting(true);
    setResult("");
    try {
      const response = await fetch("/api/admin/applications/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programCode, applications }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "Не удалось импортировать файл.");
        return;
      }
      const imported = body as ImportResult;
      const allErrors = [
        ...invalid.map((item) => `Строка ${item.rowNumber}: неверно заполнено поле «${item.error}».`),
        ...imported.errors.map((item) => `Строка ${item.row}${item.fullName ? ` (${item.fullName})` : ""}: ${item.error}`),
      ];
      setImportErrors(allErrors);
      setResult(`Создано: ${imported.created}. Обновлено: ${imported.updated}. Не импортировано: ${allErrors.length}.`);
      if (imported.created + imported.updated > 0) onImported();
    } catch {
      setError("Не удалось связаться с сервером импорта.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="excel-import">
      <label>
        Excel-файл
        <input
          key={fileInputKey}
          type="file"
          accept=".xlsx,.xls"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setPreview(null); setError(""); setResult(""); setImportErrors([]);
            try {
              const parsed = await parseXlsx(file);
              setPreview(parsed);
              setMapping(guess(parsed.headers));
            } catch {
              setError("Не удалось прочитать Excel-файл.");
            } finally {
              setFileInputKey((key) => key + 1);
            }
          }}
        />
      </label>
      {error && <p>{error}</p>}
      {preview && (
        <>
          <p>Лист: <b>{preview.activeSheet}</b> · строк: {preview.rows.length}</p>
          <div className="excel-mapping">
            {(Object.keys(labels) as Field[]).map((field) => (
              <label key={field}>{labels[field]}
                <select value={mapping[field]} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })}>
                  <option value="">Не выбрано</option>
                  {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="excel-preview">
            {preview.rows.slice(0, 5).map((row, index) => (
              <p key={index}>{(Object.keys(labels) as Field[]).map((field) => mapping[field] ? String(row[mapping[field]] ?? "—") : "—").join(" · ")}</p>
            ))}
          </div>
          {mapping.snils && mapping.fullName && mapping.averageScore && <div className="excel-validation">{(() => {
            const invalid = preview.rows.map((row, index) => ({ index: index + 2, error: validateRow(row, mapping) })).filter((item) => item.error);
            return <><p>Проверка: <b>{preview.rows.length - invalid.length}</b> корректных строк, <b>{invalid.length}</b> с ошибками.</p>{invalid.slice(0, 10).map((item) => <p key={item.index}>Строка {item.index}: неверно заполнено поле «{item.error}».</p>)}</>;
          })()}</div>}
          <button type="button" disabled={importing} onClick={importRows}>{importing ? "Импортируем…" : "Импортировать корректные строки"}</button>
          {result && <p>{result}</p>}
          {importErrors.length > 0 && <div className="excel-errors">{importErrors.slice(0, 10).map((item) => <p key={item}>{item}</p>)}</div>}
        </>
      )}
    </div>
  );
}
