import { FormEvent, useEffect, useState } from "react";
import "../../pages/admin/admin.css";
import "../../pages/admin/layout.css";
import "../applicants-table/table.css";
import "../applicants-table/desktop.css";
import type { Program } from "../../entities/program/model/types";
import type { Application as DraftApplication } from "../../entities/application/model/types";
import { adminApi } from "../../shared/api/admin";
import { addApplication } from "../../features/add-application/api";
import { editApplication } from "../../features/edit-application/api";
import { deleteApplication } from "../../features/delete-application/api";
import { ExcelImport } from "../../features/import-applications/ui";
import { downloadAdmissionsReport } from "../../features/export-report/lib/download-report";

type Draft = {
  snils: string;
  fullName: string;
  programCode: string;
  averageScore: string;
  originalGiven: boolean;
  benefit: boolean;
};
const storageKey = "utec-admin-application-draft";
const workspaceStorageKey = "utec-admin-workspace-state";
const emptyDraft: Draft = {
  snils: "",
  fullName: "",
  programCode: "21.02.19",
  averageScore: "",
  originalGiven: false,
  benefit: false,
};
const namePart = /^[\p{L}-]+$/u;
function formatSNILS(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  return (
    [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join("-") +
    (d.length > 9 ? ` ${d.slice(9)}` : "")
  );
}
function validName(value: string) {
  const parts = value.trim().split(/\s+/);
  return parts.length >= 3 && parts.every((part) => namePart.test(part));
}
function validScore(value: string) {
  return /^(?:[0-4](?:[.,]\d{1,3})?|5(?:[.,]0{1,3})?)$/.test(value.trim());
}
function sanitizeScoreInput(value: string) {
  const normalized = value.replace(/\./g, ",").replace(/[^\d,]/g, "");
  const [whole, ...fractionParts] = normalized.split(",");
  if (!whole || !/^[0-5]$/.test(whole)) return "";
  const fraction = fractionParts.join("").slice(0, 3);
  return fractionParts.length ? `${whole},${fraction}` : whole;
}
function loadDraft(): Draft {
  try {
    return {
      ...emptyDraft,
      ...JSON.parse(localStorage.getItem(storageKey) || "{}"),
    };
  } catch {
    return emptyDraft;
  }
}
function loadWorkspace() {
  try {
    return JSON.parse(localStorage.getItem(workspaceStorageKey) || "{}");
  } catch {
    return {};
  }
}
function normalizeName(value: string) {
  return value.toLowerCase().replaceAll("ё", "е").trim().replace(/\s+/g, " ");
}

export function AdminWorkspace() {
  const [authenticated, setAuthenticated] = useState(false),
    [programs, setPrograms] = useState<Program[]>([]),
    [items, setItems] = useState<DraftApplication[]>([]),
    [message, setMessage] = useState(""),
    [reportLoading, setReportLoading] = useState(false),
    [publicationUpdating, setPublicationUpdating] = useState(false);
  const savedWorkspace = loadWorkspace();
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [draft, setDraft] = useState<Draft>(loadDraft),
    [selectedProgram, setSelectedProgram] = useState(
      savedWorkspace.selectedProgram || "21.02.19",
    ),
    [adminSearch, setAdminSearch] = useState(savedWorkspace.adminSearch || ""),
    [reportOriginalOnly, setReportOriginalOnly] = useState(Boolean(savedWorkspace.reportOriginalOnly)),
    [reportBenefitOnly, setReportBenefitOnly] = useState(Boolean(savedWorkspace.reportBenefitOnly)),
    [mode, setMode] = useState<"manual" | "excel">(
      savedWorkspace.mode === "excel" ? "excel" : "manual",
    );
  const [editing, setEditing] = useState<DraftApplication | null>(
    savedWorkspace.editing || null,
  );
  const [editingScore, setEditingScore] = useState(
    savedWorkspace.editingScore ||
      (savedWorkspace.editing ? Number(savedWorkspace.editing.averageScore).toFixed(3).replace(".", ",") : ""),
  );
  useEffect(() => {
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((x) => setAuthenticated(x.authenticated));
  }, []);
  useEffect(() => {
    if (draft !== emptyDraft)
      localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft]);
  useEffect(() => {
    localStorage.setItem(
      workspaceStorageKey,
      JSON.stringify({ selectedProgram, adminSearch, reportOriginalOnly, reportBenefitOnly, mode, editing, editingScore }),
    );
  }, [selectedProgram, adminSearch, reportOriginalOnly, reportBenefitOnly, mode, editing, editingScore]);
  function refreshItems() {
    adminApi.applications().then(setItems);
  }
  async function exportReport(program: Program, applications: DraftApplication[]) {
    setReportLoading(true);
    setMessage("");
    try {
      await downloadAdmissionsReport(program, applications, { originalOnly: reportOriginalOnly, benefitOnly: reportBenefitOnly });
      setMessage("PDF-отчёт сформирован.");
    } catch {
      setMessage("Не удалось сформировать PDF-отчёт. Попробуйте ещё раз.");
    } finally {
      setReportLoading(false);
    }
  }
  useEffect(() => {
    if (authenticated) {
      adminApi.programs().then(setPrograms);
      refreshItems();
    }
  }, [authenticated]);
  const update = (values: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...values }));
  const clear = () => {
    setDraft(emptyDraft);
    localStorage.removeItem(storageKey);
    setMessage("Форма очищена.");
  };
  async function signIn(e: FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    if (r.ok) setAuthenticated(true);
    else setMessage("Неверный логин или пароль.");
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!validName(draft.fullName)) {
      setMessage(
        "ФИО: укажите минимум фамилию, имя и отчество — только буквами.",
      );
      return;
    }
    if (!validScore(draft.averageScore)) {
      setMessage(
        "Средний балл: число от 0 до 5, максимум 3 знака после запятой.",
      );
      return;
    }
    const r = await addApplication({
      ...draft,
      averageScore: Number(draft.averageScore.replace(",", ".")),
    });
    if (r.ok) {
      setDraft(emptyDraft);
      localStorage.removeItem(storageKey);
      setMessage("Заявление добавлено в список.");
      refreshItems();
    } else setMessage("Ошибка: проверь данные, лимит заявлений и оригинал.");
  }
  async function remove(item: DraftApplication) {
    if (!window.confirm(`Удалить заявление: ${item.fullName}?`)) return;
    const r = await deleteApplication(item.id);
    if (r.ok) {
      setMessage("Заявление удалено из списка.");
      refreshItems();
    } else setMessage("Не удалось удалить заявление.");
  }
  async function removeProgramApplications() {
    if (!program || programItems.length === 0) return;
    const confirmed = window.confirm(
      `Удалить все заявления (${programItems.length}) по специальности «${program.name}»? Это действие нельзя отменить.`,
    );
    if (!confirmed) return;
    const response = await adminApi.removeByProgram(selectedProgram);
    if (response.ok) {
      setEditing(null);
      setEditingScore("");
      setMessage(`Удалено заявлений: ${programItems.length}.`);
      refreshItems();
    } else setMessage("Не удалось удалить заявления по специальности.");
  }
  async function updatePublication(value: boolean) {
    if (!program) return;
    const action = value ? "показывать только заявления с оригиналами" : "снова показывать все заявления";
    if (!window.confirm(`Для специальности «${program.name}» публичный список будет ${action}. Продолжить?`)) return;
    setPublicationUpdating(true);
    const response = await adminApi.updateProgramPublication(program.code, value);
    if (response.ok) {
      setPrograms((current) => current.map((item) => item.code === program.code ? { ...item, publicOriginalOnly: value } : item));
      setMessage(value ? "Публично отображаются только заявления с оригиналами." : "Публично снова отображаются все заявления.");
    } else setMessage("Не удалось изменить режим публикации.");
    setPublicationUpdating(false);
  }
  async function save(item: DraftApplication) {
    if (!validName(item.fullName) || !validScore(editingScore)) {
      setMessage(
        "Проверь ФИО и средний балл: от 0 до 5, до 3 знаков после запятой.",
      );
      return;
    }
    const r = await editApplication(item.id, {
      ...item,
      averageScore: Number(editingScore.replace(",", ".")),
    });
    if (r.ok) {
      setEditing(null);
      setEditingScore("");
      setMessage("Изменения сохранены.");
      refreshItems();
    } else setMessage("Не удалось сохранить строку.");
  }
  if (!authenticated)
    return (
      <main className="admin-login-page">
        <section className="admin admin-login-card">
          <h1>Вход администратора</h1>
          <form onSubmit={signIn}>
            <label>
              Логин
              <input value={login} onChange={(e) => setLogin(e.target.value)} />
            </label>
            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button>Войти</button>
          </form>
          <p>{message}</p>
        </section>
      </main>
    );
  const program = programs.find((x) => x.code === selectedProgram);
  const programItems = items.filter((x) => x.programCode === selectedProgram);
  const normalizedSearch = normalizeName(adminSearch);
  const visible = normalizedSearch
    ? programItems.filter((x) => normalizeName(x.fullName).includes(normalizedSearch))
    : programItems;
  const reportItems = programItems.filter(
    (item) =>
      (!reportOriginalOnly || item.originalGiven) &&
      (!reportBenefitOnly || item.benefit),
  );
  return (
    <main className="admin wide">
      <a href="/">← К спискам</a>
      <h1>Приёмная комиссия</h1>
      <label className="program-filter">
        Специальность
        <select
          value={selectedProgram}
          onChange={(e) => {
            setSelectedProgram(e.target.value);
            update({ programCode: e.target.value });
          }}
        >
          {programs.map((x) => (
            <option key={x.code} value={x.code}>
              {x.code} — {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="publication-toggle">
        <input
          type="checkbox"
          checked={Boolean(program?.publicOriginalOnly)}
          disabled={!program || publicationUpdating}
          onChange={(e) => updatePublication(e.target.checked)}
        />
        Показывать публично только заявления с оригиналами
      </label>
      <label className="admin-search">
        Поиск по ФИО
        <input
          value={adminSearch}
          onChange={(e) => setAdminSearch(e.target.value)}
          placeholder="Начните вводить ФИО"
        />
      </label>
      {program && (
        <>
        <section className="report-controls">
          <div className="report-filters">
            <label>
              <input type="checkbox" checked={reportOriginalOnly} onChange={(e) => setReportOriginalOnly(e.target.checked)} />
              Только с оригиналом
            </label>
            <label>
              <input type="checkbox" checked={reportBenefitOnly} onChange={(e) => setReportBenefitOnly(e.target.checked)} />
              Только льготники
            </label>
          </div>
          <button
            type="button"
            className="report-button"
            disabled={reportLoading || reportItems.length === 0}
            onClick={() => exportReport(program, programItems)}
          >
            {reportLoading ? "Формируем PDF…" : "Скачать PDF-отчёт"}
          </button>
          <span className="report-count">В отчёте: {reportItems.length}</span>
        </section>
          <button
            type="button"
            className="delete-program"
            disabled={programItems.length === 0}
            onClick={removeProgramApplications}
          >
            Удалить все заявления по специальности
          </button>
        </>
      )}
      <div className="admin-workspace">
        <section className="draft-list">
          <h2>
            {program?.name} <span>{visible.length}{normalizedSearch ? ` из ${programItems.length}` : ""} заявлений</span>
          </h2>
          <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>СНИЛС</th>
                <th>ФИО</th>
                <th>Балл</th>
                <th>Оригинал</th>
                <th>Льгота</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const e = editing?.id === item.id;
                const v = e ? editing : item;
                return (
                  <tr key={item.id}>
                    <td>
                      {e ? (
                        <input
                          value={v.snils}
                          onChange={(x) =>
                            setEditing({
                              ...v,
                              snils: formatSNILS(x.target.value),
                            })
                          }
                        />
                      ) : (
                        v.snils
                      )}
                    </td>
                    <td>
                      {e ? (
                        <input
                          value={v.fullName}
                          onChange={(x) =>
                            setEditing({ ...v, fullName: x.target.value })
                          }
                        />
                      ) : (
                        v.fullName
                      )}
                    </td>
                    <td>
                      {e ? (
                        <input
                          value={editingScore}
                          inputMode="decimal"
                          onChange={(x) => setEditingScore(sanitizeScoreInput(x.target.value))}
                        />
                      ) : (
                        v.averageScore.toFixed(3)
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={v.originalGiven}
                        disabled={!e}
                        onChange={(x) =>
                          setEditing({ ...v, originalGiven: x.target.checked })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={v.benefit}
                        disabled={!e}
                        onChange={(x) =>
                          setEditing({ ...v, benefit: x.target.checked })
                        }
                      />
                    </td>
                    <td>
                      {e ? (
                        <>
                          <button onClick={() => save(v)}>Сохранить</button>
                          <button onClick={() => { setEditing(null); setEditingScore(""); }}>
                            Отмена
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditing(item); setEditingScore(item.averageScore.toFixed(3).replace(".", ",")); }}>Изм.</button>
                          <button onClick={() => remove(item)}>Удалить</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>
        <aside className="side-panel">
          <div className="tabs">
            <button
              className={mode === "manual" ? "active" : ""}
              onClick={() => setMode("manual")}
            >
              Вручную
            </button>
            <button
              className={mode === "excel" ? "active" : ""}
              onClick={() => setMode("excel")}
            >
              Excel
            </button>
          </div>
          {mode === "manual" ? (
            <>
              <form onSubmit={add}>
                <label>
                  СНИЛС
                  <input
                    value={draft.snils}
                    onChange={(e) =>
                      update({ snils: formatSNILS(e.target.value) })
                    }
                    required
                  />
                </label>
                <label>
                  ФИО
                  <input
                    value={draft.fullName}
                    onChange={(e) => update({ fullName: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Средний балл
                  <input
                    value={draft.averageScore}
                    inputMode="decimal"
                    onChange={(e) => update({ averageScore: sanitizeScoreInput(e.target.value) })}
                    required
                  />
                </label>
                <label>
                  <input
                    checked={draft.originalGiven}
                    onChange={(e) =>
                      update({ originalGiven: e.target.checked })
                    }
                    type="checkbox"
                  />{" "}
                  Оригинал
                </label>
                <label>
                  <input
                    checked={draft.benefit}
                    onChange={(e) => update({ benefit: e.target.checked })}
                    type="checkbox"
                  />{" "}
                  Льгота
                </label>
                <button>Добавить</button>
              </form>
              <section className="preview">
                <span>ПРЕДПРОСМОТР</span>
                <strong>{draft.fullName || "Фамилия Имя Отчество"}</strong>
                <p>
                  {draft.snils || "СНИЛС"} · {draft.averageScore || "—"}
                </p>
              </section>
            </>
          ) : (
            <ExcelImport programCode={selectedProgram} onImported={refreshItems} />
          )}
        </aside>
      </div>
      <p>{message}</p>
    </main>
  );
}
