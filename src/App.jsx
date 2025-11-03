import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Entry shape (JS-doc til editor autocompletion):
 * { id, dateISO, startISO, endISO|null, durationMs, description, project?, rate? }
 */

const STORAGE_KEY = "timesheet_entries_v1";
const ACTIVE_KEY = "timesheet_active_v1";
const PREFS_KEY = "timesheet_prefs_v1"; // pt. kun defaultRate/currency

// -------- helpers --------
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function msToHMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtMoney(amount, currency = "DKK") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
function download(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function entriesToCSV(entries) {
  const header = ["Dato","Start","Slut","Varighed (timer)","Projekt","Beskrivelse","Timepris","Beløb (DKK)"];
  const rows = entries.map((e) => {
    const durH = (e.durationMs / 3600000).toFixed(2);
    const rate = e.rate ?? 0;
    const amount = (parseFloat(durH) * rate).toFixed(2);
    return [fmtDate(e.startISO), fmtTime(e.startISO), fmtTime(e.endISO), durH, e.project || "", (e.description || "").replaceAll("\n"," "), rate, amount];
  });
  return [header, ...rows]
    .map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(","))
    .join("\n");
}

// -------- App --------
export default function App() {
  const [entries, setEntries] = useState([]);
  const [active, setActive] = useState(null);
  const [desc, setDesc] = useState("");
  const [project, setProject] = useState("");
  const [rate, setRate] = useState(200); // STANDARD: 200 kr/t
  const [nowTick, setNowTick] = useState(Date.now());
  const [showManual, setShowManual] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [prefs, setPrefs] = useState({ defaultRate: 200, currency: "DKK", roundToQuarter: true });
  const descRef = useRef(null);

  // load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEntries(JSON.parse(raw));
      const rawA = localStorage.getItem(ACTIVE_KEY);
      if (rawA) setActive(JSON.parse(rawA));
      const rawP = localStorage.getItem(PREFS_KEY);
      if (rawP) {
        const p = JSON.parse(rawP);
        const merged = { defaultRate: 200, currency: "DKK", roundToQuarter: true, ...p };
        setPrefs(merged);
        if (merged.defaultRate) setRate(merged.defaultRate);
      }
    } catch {}
  }, []);
  // persist
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }, [entries]);
  useEffect(() => {
    if (active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
    else localStorage.removeItem(ACTIVE_KEY);
  }, [active]);
  useEffect(() => { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }, [prefs]);

  // tick timer
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  function roundMs(ms) {
    if (!prefs.roundToQuarter) return ms;
    const quarter = 15 * 60 * 1000;
    return Math.round(ms / quarter) * quarter;
  }

  function startShift() {
    if (active) return;
    const startISO = new Date().toISOString();
    const e = { id: uid(), dateISO: startISO, startISO, endISO: null, durationMs: 0, description: desc.trim(), project: project.trim(), rate: Number(rate) || 0 };
    setActive(e);
    setDesc("");
  }
  function stopShift() {
    if (!active) return;
    const end = new Date();
    const endISO = end.toISOString();
    const durationRaw = end.getTime() - new Date(active.startISO).getTime();
    const durationMs = roundMs(durationRaw);
    const finished = { ...active, endISO, durationMs };
    setEntries(prev => [finished, ...prev]);
    setActive(null);
  }
  function deleteEntry(id) {
    setEntries(prev => prev.filter(e => e.id !== id));
    if (active?.id === id) setActive(null);
  }
  function saveEdit(id, patch) {
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
    setEditingId(null);
  }
  function addManualEntry({ date, start, end, description, project, rate }) {
    const startISO = new Date(`${date}T${start}:00`).toISOString();
    const endISO = new Date(`${date}T${end}:00`).toISOString();
    const durationRaw = new Date(endISO).getTime() - new Date(startISO).getTime();
    const durationMs = roundMs(Math.max(0, durationRaw));
    const e = { id: uid(), dateISO: startISO, startISO, endISO, durationMs, description: description.trim(), project: project.trim(), rate: Number(rate) || prefs.defaultRate || 0 };
    setEntries(prev => [e, ...prev]);
    setShowManual(false);
  }

  const runningMs = active ? nowTick - new Date(active.startISO).getTime() : 0;

  const totals = useMemo(() => {
    const byDate = new Map();
    let weekMs = 0, monthMs = 0;
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // mandag som uge-start
    startOfWeek.setHours(0,0,0,0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    for (const e of entries) {
      const d = new Date(e.startISO);
      const key = fmtDate(e.startISO);
      byDate.set(key, (byDate.get(key) || 0) + e.durationMs);
      if (d >= startOfWeek) weekMs += e.durationMs;
      if (d >= startOfMonth) monthMs += e.durationMs;
    }
    const dayRows = Array.from(byDate.entries()).sort((a,b)=> (a[0] < b[0] ? 1 : -1));
    const latestDayMs = dayRows.length ? dayRows[0][1] : 0;
    return { weekMs, monthMs, latestDayMs };
  }, [entries, nowTick]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Tid & Arbejde</h1>
            <p className="text-slate-600 text-sm">Instempling/udstempling, beskrivelser, timesats og CSV-eksport. Alt gemmes lokalt i din browser.</p>
          </div>
          <button
            onClick={() => download(`tidsregistrering-${new Date().toISOString().slice(0,16).replace(/[:T]/g,"")}.csv`, entriesToCSV(entries))}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-white shadow-sm"
          >
            Eksportér CSV
          </button>
        </header>

        {/* Stempling + Overblik */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 rounded-2xl bg-white shadow p-4 space-y-4">
            <h2 className="font-semibold text-lg">Stempling</h2>

            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="text-sm text-slate-600">Projekt (valgfrit)</label>
                <input className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="Projekt/ordre"
                  value={project} onChange={(e)=>setProject(e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-slate-600">Beskrivelse</label>
                <input ref={descRef} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="Hvad arbejder du på?"
                  value={desc} onChange={(e)=>setDesc(e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-slate-600">Time sats (DKK/time)</label>
                <input type="number" step="0.01" className="mt-1 w-full rounded-lg border px-3 py-2"
                  value={rate} onChange={(e)=>setRate(Number(e.target.value))} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              {!active ? (
                <button className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700" onClick={startShift}>
                  Stem ind
                </button>
              ) : (
                <button className="rounded-lg bg-rose-600 text-white px-4 py-2 hover:bg-rose-700" onClick={stopShift}>
                  Stem ud
                </button>
              )}

              <button className="rounded-lg border px-4 py-2 hover:bg-slate-50" onClick={() => setShowManual(true)}>
                Manuel post
              </button>
            </div>

            <ActiveBanner active={!!active} startISO={active?.startISO || null} runningMs={runningMs} rate={active?.rate ?? prefs.defaultRate ?? 0} />
          </div>

          <div className="rounded-2xl bg-white shadow p-4 space-y-3">
            <h2 className="font-semibold text-lg">Overblik</h2>
            <SummaryRow label="I gang" value={active ? msToHMS(runningMs) : "—"} />
            <SummaryRow label="I gang (beløb)" value={active ? fmtMoney((runningMs/3600000) * (active?.rate ?? prefs.defaultRate ?? 0), "DKK") : "—"} />
            <SummaryRow label="Seneste dag (sum)" value={msToHMS(totals.latestDayMs)} />
            <SummaryRow label="Denne uge (sum)" value={msToHMS(totals.weekMs)} />
            <SummaryRow label="Denne måned (sum)" value={msToHMS(totals.monthMs)} />
          </div>
        </div>

        {/* Tabel */}
        <div className="rounded-2xl bg-white shadow p-4">
          <h2 className="font-semibold text-lg mb-3">Registreringer</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="py-2 pr-4">Dato</th>
                  <th className="py-2 pr-4">Start</th>
                  <th className="py-2 pr-4">Slut</th>
                  <th className="py-2 pr-4">Varighed</th>
                  <th className="py-2 pr-4">Time sats</th>
                  <th className="py-2 pr-4">Beløb</th>
                  <th className="py-2 pr-4">Projekt</th>
                  <th className="py-2 pr-4">Beskrivelse</th>
                  <th className="py-2 pr-2 text-right">Handling</th>
                </tr>
              </thead>
              <tbody>
                {active && (
                  <tr className="opacity-80">
                    <td className="py-2 pr-4">{fmtDate(active.startISO)}</td>
                    <td className="py-2 pr-4">{fmtTime(active.startISO)}</td>
                    <td className="py-2 pr-4">—</td>
                    <td className="py-2 pr-4"><span className="rounded bg-slate-100 px-2 py-0.5">{msToHMS(runningMs)}</span></td>
                    <td className="py-2 pr-4">{((active.rate ?? prefs.defaultRate ?? 0)).toFixed(2)} DKK/t</td>
                    <td className="py-2 pr-4">{fmtMoney((runningMs/3600000) * (active?.rate ?? prefs.defaultRate ?? 0), "DKK")}</td>
                    <td className="py-2 pr-4">{active.project || ""}</td>
                    <td className="py-2 pr-4">{active.description || ""}</td>
                    <td className="py-2 pr-2 text-right text-slate-500">(kørende)</td>
                  </tr>
                )}
                {entries.length === 0 && !active && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-slate-500">Ingen registreringer endnu.</td>
                  </tr>
                )}
                {entries.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="py-2 pr-4">{fmtDate(e.startISO)}</td>
                    <td className="py-2 pr-4">{fmtTime(e.startISO)}</td>
                    <td className="py-2 pr-4">{fmtTime(e.endISO)}</td>
                    <td className="py-2 pr-4">{msToHMS(e.durationMs)}</td>

                    <EditableCell
                      value={String(e.rate ?? prefs.defaultRate ?? 0)}
                      render={(v)=> <span>{Number(v).toFixed(2)} DKK/t</span>}
                      onSave={(v)=> saveEdit(e.id, { rate: Number(v) || 0 })}
                    />

                    <td className="py-2 pr-4">{fmtMoney((e.durationMs/3600000) * (e.rate ?? prefs.defaultRate ?? 0), "DKK")}</td>

                    <EditableCell
                      value={e.project || ""}
                      onSave={(v)=> saveEdit(e.id, { project: v })}
                    />
                    <EditableCell
                      value={e.description || ""}
                      wide
                      onSave={(v)=> saveEdit(e.id, { description: v })}
                    />

                    <td className="py-2 pr-2 text-right">
                      <button className="text-rose-600 hover:underline" onClick={()=> deleteEntry(e.id)}>Slet</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500">
          Tip: Klik på felter i tabellen for at redigere. Brug “Manuel post”, hvis du har glemt at stemple ind/ud.
        </p>
      </div>

      {/* Modal for manuel post */}
      {showManual && (
        <ManualModal
          defaultRate={prefs.defaultRate}
          onCancel={()=> setShowManual(false)}
          onSave={addManualEntry}
        />
      )}
    </div>
  );
}

// ------- små komponenter -------
function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-xl border px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
function ActiveBanner({ active, startISO, runningMs, rate }) {
  if (!active) return (
    <div className="rounded-xl border px-3 py-3 text-slate-600 text-sm">
      Ikke i gang. Stem ind for at starte en registrering.
    </div>
  );
  const amount = (runningMs / 3600000) * (rate ?? 0);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border px-3 py-3">
      <span className="rounded bg-emerald-100 text-emerald-700 px-2 py-0.5 text-sm">Aktiv</span>
      <div>Start: <strong>{fmtTime(startISO)}</strong></div>
      <div>Forløbet: <strong>{msToHMS(runningMs)}</strong></div>
      <div>Beløb: <strong>{fmtMoney(amount, "DKK")}</strong></div>
    </div>
  );
}
function EditableCell({ value, onSave, wide = false, render }) {
  const [isEdit, setIsEdit] = useState(false);
  const [val, setVal] = useState(value);
  useEffect(()=> setVal(value), [value]);
  return (
    <td className={`py-2 pr-4 ${wide ? "max-w-[36ch]" : ""}`}>
      {isEdit ? (
        <div className="flex items-center gap-2">
          <input className="rounded-lg border px-2 py-1 text-sm w-full" value={val} onChange={(e)=>setVal(e.target.value)} />
          <button className="rounded bg-emerald-600 text-white px-2 py-1 text-xs" onClick={()=> { onSave(val); setIsEdit(false); }}>Gem</button>
          <button className="rounded border px-2 py-1 text-xs" onClick={()=> { setVal(value); setIsEdit(false); }}>Annullér</button>
        </div>
      ) : (
        <div className={`truncate ${wide ? "max-w-[36ch]" : ""}`} onClick={()=> setIsEdit(true)} title={String(value)}>
          {render ? render(val) : (value || <span className="text-slate-400">—</span>)}
        </div>
      )}
    </td>
  );
}
function ManualModal({ onCancel, onSave, defaultRate = 200 }) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth()+1).padStart(2,"0");
  const d = String(today.getDate()).padStart(2,"0");

  const [date, setDate] = useState(`${y}-${m}-${d}`);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:00");
  const [project, setProject] = useState("");
  const [description, setDescription] = useState("");
  const [rate, setRate] = useState(defaultRate);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="font-semibold text-lg mb-3">Manuel registrering</h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-600">Dato</label>
            <input type="date" className="mt-1 w-full rounded-lg border px-3 py-2" value={date} onChange={(e)=>setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-600">Start</label>
            <input type="time" className="mt-1 w-full rounded-lg border px-3 py-2" value={start} onChange={(e)=>setStart(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-600">Slut</label>
            <input type="time" className="mt-1 w-full rounded-lg border px-3 py-2" value={end} onChange={(e)=>setEnd(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm text-slate-600">Projekt (valgfrit)</label>
            <input className="mt-1 w-full rounded-lg border px-3 py-2" value={project} onChange={(e)=>setProject(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm text-slate-600">Beskrivelse</label>
            <textarea className="mt-1 w-full rounded-lg border px-3 py-2" rows={3} value={description} onChange={(e)=>setDescription(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm text-slate-600">Time sats (DKK/time)</label>
            <input type="number" step="0.01" className="mt-1 w-full rounded-lg border px-3 py-2" value={rate} onChange={(e)=>setRate(Number(e.target.value))} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded border px-4 py-2" onClick={onCancel}>Annullér</button>
          <button className="rounded bg-emerald-600 text-white px-4 py-2" onClick={()=> onSave({ date, start, end, description, project, rate })}>
            Gem
          </button>
        </div>
      </div>
    </div>
  );
}

