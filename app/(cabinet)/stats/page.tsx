"use client";

import Link from "next/link";
import * as React from "react";
import { ALL, useCabinet } from "@/components/cabinet/cabinet-context";
import { PageBody, PageHeader } from "@/components/cabinet/page-header";
import { LoadError } from "@/components/forms";
import { Alert, Card, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { dateInTz, formatDayMonth, formatDuration, formatShortDateTime } from "@/lib/format";
import { errorText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Metric = { n: number; ids: string[] };
type Summary = {
  open: Metric & { new: number; progress: number };
  review: Metric;
  overdue: Metric;
  done: Metric & { denom: number; denomIds: string[] };
  notDone: Metric & { denom: number };
  onTime: Metric;
  late: Metric;
  completed: Metric;
  speed: { medianMs: number | null; n: number; ids: string[] };
  early: Metric & { medianLeadMs: number | null };
};
type Stats = {
  period: { from: string; to: string };
  snapshotAt: number;
  snapshot: "now" | "end";
  timezone: string;
  today: string;
  branch: string | null;
  assignee: { id: string; name: string } | null;
  speedFrom: "started" | "assigned";
  summary: Summary;
  employees: (Summary & { userId: string; name: string })[];
  tasks: Record<string, { number: number; title: string; assignee: string; status: string; dueAt: number | null; branch: string | null }>;
};

type Preset = "week" | "month" | "prev" | "d30";

/** Границы периода в поясе компании. */
function presetRange(preset: Preset, tz: string): { from: string; to: string } {
  const today = dateInTz(Date.now(), tz);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const utc = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
  if (preset === "week") {
    const base = utc(y, m - 1, d);
    const dow = (base.getUTCDay() + 6) % 7;
    return { from: iso(utc(y, m - 1, d - dow)), to: iso(utc(y, m - 1, d - dow + 6)) };
  }
  if (preset === "month") return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) };
  if (preset === "prev") return { from: iso(utc(y, m - 2, 1)), to: iso(utc(y, m - 1, 0)) };
  return { from: iso(utc(y, m - 1, d - 29)), to: today };
}

type Query = { preset: Preset | ""; from: string; to: string; snapshot: "now" | "end"; assignee: string };

function readQuery(tz: string): Query {
  const p = new URLSearchParams(window.location.search);
  const preset = (p.get("preset") as Preset | null) ?? (p.get("from") ? "" : "month");
  const range = preset ? presetRange(preset, tz) : { from: p.get("from") ?? "", to: p.get("to") ?? "" };
  return { preset: preset ?? "", ...range, snapshot: p.get("snapshot") === "end" ? "end" : "now", assignee: p.get("assignee") ?? "" };
}

export default function StatsPage() {
  const { me, branchId, branchEpoch } = useCabinet();
  const tz = me.company.timezone;
  const [query, setQuery] = React.useState<Query | null>(null);
  const [data, setData] = React.useState<Stats | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [drill, setDrill] = React.useState<{ title: string; ids: string[] } | null>(null);

  // Период, срез и исполнитель восстанавливаются из адреса (возврат из карточки задачи).
  React.useEffect(() => setQuery(readQuery(tz)), [tz]);

  const qs = React.useMemo(() => {
    if (!query) return "";
    const p = new URLSearchParams({ from: query.from, to: query.to, snapshot: query.snapshot });
    if (branchId) p.set("branch", branchId);
    if (query.assignee) p.set("assignee", query.assignee);
    return p.toString();
  }, [query, branchId]);

  React.useEffect(() => {
    if (!query) return;
    const p = new URLSearchParams();
    if (query.preset) p.set("preset", query.preset);
    else {
      p.set("from", query.from);
      p.set("to", query.to);
    }
    if (query.snapshot !== "now") p.set("snapshot", query.snapshot);
    if (query.assignee) p.set("assignee", query.assignee);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${p}`);
  }, [query]);

  // Запоздалый ответ по прежнему филиалу или периоду на экран не попадает.
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    if (!qs || !query?.from || !query.to) return;
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    api<Stats>("GET", `/api/stats?${qs}`)
      .then((r) => id === seq.current && setData(r))
      .catch((e) => id === seq.current && setError(errorText(e instanceof ApiError ? e.code : "network")))
      .finally(() => id === seq.current && setLoading(false));
  }, [qs, query?.from, query?.to]);
  React.useEffect(load, [load, branchEpoch]);

  if (!me.capabilities.viewStats) {
    return (
      <>
        <PageHeader title={t("stats.title")} />
        <PageBody>
          <Alert tone="danger">{errorText("forbidden")}</Alert>
        </PageBody>
      </>
    );
  }

  const set = (patch: Partial<Query>) => setQuery((q) => (q ? { ...q, ...patch } : q));
  const open = (title: string, ids: string[]) => ids.length && setDrill({ title, ids });
  const s = data?.summary;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

  return (
    <>
      <PageHeader title={t("stats.title")} />
      <PageBody className="flex flex-col gap-4">
        {query ? (
          <div className="flex flex-wrap items-center gap-2">
            {(["week", "month", "prev", "d30"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={query.preset === p}
                onClick={() => set({ preset: p, ...presetRange(p, tz) })}
                className={cn(
                  "h-9 rounded-full border px-3.5 text-sm font-semibold",
                  query.preset === p ? "border-primary/30 bg-selected" : "border-border bg-surface text-foreground/80 hover:bg-muted",
                )}
              >
                {t(`stats.presets.${p}`)}
              </button>
            ))}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("stats.from")}
              <Input type="date" value={query.from} onChange={(e) => set({ preset: "", from: e.target.value })} className="w-40" />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("stats.to")}
              <Input type="date" value={query.to} onChange={(e) => set({ preset: "", to: e.target.value })} className="w-40" />
            </label>
            <NativeSelect aria-label={t("stats.snapshot")} value={query.snapshot} onChange={(e) => set({ snapshot: e.target.value as "now" | "end" })} className="w-52">
              <option value="now">{t("stats.snapshotNow")}</option>
              <option value="end">{t("stats.snapshotEnd")}</option>
            </NativeSelect>
            {loading ? <Spinner className="text-muted-foreground" /> : null}
          </div>
        ) : null}

        {error ? <LoadError message={error} onRetry={load} /> : null}
        {!data && !error ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> {t("app.loading")}
          </p>
        ) : null}

        {data && s ? (
          <>
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-muted-foreground">
              <span>
                {t("stats.line.period")}: <b className="text-foreground">{formatDayMonth(data.period.from)} — {formatDayMonth(data.period.to)}</b>
              </span>
              <span>
                {t("stats.line.branch")}: <b className="text-foreground">{data.branch ?? (branchId === ALL ? t("branch.all") : me.branch?.name ?? t("branch.all"))}</b>
              </span>
              <span>
                {t("stats.line.assignee")}:{" "}
                <b className="text-foreground">{data.assignee?.name ?? t("tasks.filters.assigneeAll")}</b>
                {data.assignee ? (
                  <button type="button" className="ml-2 text-primary hover:underline" onClick={() => set({ assignee: "" })}>
                    {t("stats.resetAssignee")}
                  </button>
                ) : null}
              </span>
              <span>
                {t("stats.line.tz")}: <b className="text-foreground">{data.timezone}</b>
              </span>
              <span>
                {t("stats.line.snapshot")}: <b className="text-foreground">{formatShortDateTime(data.snapshotAt, data.timezone)}</b>
              </span>
            </p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Tile label={t("stats.tiles.open")} value={s.open.n} note={t("stats.notes.open", { n: s.open.new, p: s.open.progress })} onClick={() => open(t("stats.tiles.open"), s.open.ids)} />
              <Tile label={t("stats.tiles.review")} value={s.review.n} note={t("stats.notes.review")} onClick={() => open(t("stats.tiles.review"), s.review.ids)} />
              <Tile label={t("stats.tiles.overdue")} value={s.overdue.n} danger={s.overdue.n > 0} note={t("stats.notes.overdue")} onClick={() => open(t("stats.tiles.overdue"), s.overdue.ids)} />
              <Tile
                label={t("stats.tiles.done")}
                value={pct(s.done.n, s.done.denom)}
                note={s.done.denom ? t("stats.notes.done", { n: s.done.n, d: s.done.denom }) : t("stats.notes.emptyDenom")}
                onClick={() => open(t("stats.tiles.done"), s.done.ids)}
              />
              <Tile
                label={t("stats.tiles.notDone")}
                value={pct(s.notDone.n, s.notDone.denom)}
                note={s.notDone.denom ? t("stats.notes.ratio", { n: s.notDone.n, d: s.notDone.denom }) : t("stats.notes.emptyDenom")}
                onClick={() => open(t("stats.tiles.notDone"), s.notDone.ids)}
              />
              <Tile
                label={t("stats.tiles.onTime")}
                value={`${s.onTime.n} / ${s.late.n}`}
                note={s.onTime.n + s.late.n ? t("stats.notes.onTime", { p: pct(s.onTime.n, s.onTime.n + s.late.n) }) : t("stats.notes.noCompleted")}
                onClick={() => open(t("stats.tiles.onTime"), [...s.onTime.ids, ...s.late.ids])}
              />
              <Tile
                label={t("stats.tiles.speed")}
                value={s.speed.medianMs === null ? "—" : formatDuration(s.speed.medianMs)}
                note={`${t(`stats.notes.speed.${data.speedFrom}`)} · ${t("stats.notes.tasksN", { n: s.speed.n })}`}
                onClick={() => open(t("stats.tiles.speed"), s.speed.ids)}
              />
              <Tile
                label={t("stats.tiles.early")}
                value={s.early.n}
                note={s.early.medianLeadMs === null ? t("stats.notes.none") : t("stats.notes.early", { d: formatDuration(s.early.medianLeadMs) })}
                onClick={() => open(t("stats.tiles.early"), s.early.ids)}
              />
            </div>

            <h2 className="mt-2 text-xl font-bold">{t("stats.byEmployee")}</h2>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-[15px]">
                <thead className="bg-muted/60 text-sm font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("stats.cols.employee")}</th>
                    <th className="px-3 py-3 text-right">{t("stats.cols.overdue")} ↓</th>
                    <th className="px-3 py-3 text-right">{t("stats.cols.open")}</th>
                    <th className="px-3 py-3 text-right">{t("stats.cols.review")}</th>
                    <th className="px-3 py-3 text-right">{t("stats.cols.done")}</th>
                    <th className="px-3 py-3 text-right">{t("stats.cols.onTime")}</th>
                    <th className="px-3 py-3 text-right">{t("stats.cols.late")}</th>
                    <th className="px-3 py-3 text-right">{t("stats.cols.speed")}</th>
                    <th className="px-4 py-3 text-right">{t("stats.cols.early")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.userId} className={cn("border-t border-border", data.assignee?.id === e.userId && "bg-selected/50")}>
                      <td className="px-4 py-3">
                        <button type="button" className="text-left font-semibold hover:text-primary" onClick={() => set({ assignee: e.userId })} title={t("stats.filterBy")}>
                          {e.name}
                        </button>
                      </td>
                      <Num m={e.overdue} title={`${e.name}: ${t("stats.cols.overdue")}`} onOpen={open} />
                      <Num m={e.open} title={`${e.name}: ${t("stats.cols.open")}`} onOpen={open} />
                      <Num m={e.review} title={`${e.name}: ${t("stats.cols.review")}`} onOpen={open} />
                      <td className="px-3 py-3 text-right">
                        {e.done.denom ? (
                          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => open(`${e.name}: ${t("stats.cols.done")}`, e.done.denomIds)}>
                            {pct(e.done.n, e.done.denom)}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}{" "}
                        <span className="text-sm text-muted-foreground">
                          {e.done.n}/{e.done.denom}
                        </span>
                      </td>
                      <Num m={e.onTime} title={`${e.name}: ${t("stats.cols.onTime")}`} onOpen={open} />
                      <Num m={e.late} title={`${e.name}: ${t("stats.cols.late")}`} onOpen={open} />
                      <td className="px-3 py-3 text-right">
                        {e.speed.medianMs === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => open(`${e.name}: ${t("stats.cols.speed")}`, e.speed.ids)}>
                            {formatDuration(e.speed.medianMs)}
                          </button>
                        )}
                      </td>
                      <Num m={e.early} title={`${e.name}: ${t("stats.cols.early")}`} onOpen={open} className="px-4" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <p className="text-sm text-muted-foreground">{t("stats.footnote")}</p>
          </>
        ) : null}

        <Dialog open={Boolean(drill)} onOpenChange={(o) => !o && setDrill(null)}>
          {drill && data ? (
            <DialogContent title={drill.title} description={t("stats.drillHint", { n: drill.ids.length })}>
              <ul className="flex flex-col divide-y divide-border">
                {drill.ids.map((id) => {
                  const task = data.tasks[id];
                  if (!task) return null;
                  return (
                    <li key={id} className="py-2.5">
                      <Link href={`/tasks/${id}`} className="font-semibold text-primary hover:underline">
                        #{task.number} {task.title}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {[task.assignee, task.branch, task.status, task.dueAt ? formatShortDateTime(task.dueAt, data.timezone) : t("tasks.due.none")].filter(Boolean).join(" · ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </DialogContent>
          ) : null}
        </Dialog>
      </PageBody>
    </>
  );
}

function Tile({ label, value, note, danger, onClick }: { label: string; value: React.ReactNode; note: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className="flex h-full flex-col gap-1.5 p-4 transition-colors hover:border-primary/40">
        <span className="text-[15px] font-semibold text-foreground/80">{label}</span>
        <span className={cn("text-3xl font-bold", danger && "text-destructive")}>{value}</span>
        <span className="text-sm text-muted-foreground">{note}</span>
      </Card>
    </button>
  );
}

function Num({ m, title, onOpen, className }: { m: { n: number; ids: string[] }; title: string; onOpen: (title: string, ids: string[]) => void; className?: string }) {
  return (
    <td className={cn("px-3 py-3 text-right", className)}>
      {m.n ? (
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpen(title, m.ids)}>
          {m.n}
        </button>
      ) : (
        <span className="text-foreground/70">0</span>
      )}
    </td>
  );
}
