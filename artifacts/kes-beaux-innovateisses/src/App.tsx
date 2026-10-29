import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import {
  Activity, AlertTriangle, ArrowLeft, Check, ChevronRight, CircleHelp, Flame, Gauge, Leaf, LogOut,
  MapPin, Pause, Play, Plus, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, Users,
} from 'lucide-react';
import {
  getGetAlertsQueryKey, getGetCurrentUserQueryKey, getGetDashboardQueryKey, getHealthCheckQueryKey,
  getGetMonitoringSettingsQueryKey, getGetStationMeasurementsQueryKey, getGetStationQueryKey,
  getGetStationsQueryKey, getGetUsersQueryKey, useAddStationMeasurement, useCreateStation, useDeleteStation,
  useGetAlerts, useGetCurrentUser, useGetDashboard, useHealthCheck, useGetMonitoringSettings,
  useGetStation, useGetStationMeasurements, useGetStations, useGetUsers, useLogin, useLogout,
  useResetSimulation, useUpdateAlert, useUpdateMonitoringSettings, useUpdateStation, useUpdateUserRole,
} from '@workspace/api-client-react';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 } } });
const DISCLAIMER = 'Учебный прототип. Все данные демонстрационные и не предназначены для обнаружения реальных пожаров';
const roleText: Record<string, string> = { guest: 'Наблюдатель', operator: 'Оператор', admin: 'Администратор' };
const riskText: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический' };
const statusText: Record<string, string> = { new: 'Новое', in_progress: 'В работе', processed: 'Обработано', resolved: 'Закрыто' };
const deviceText: Record<string, string> = { working: 'На связи', faulty: 'Неисправна', offline: 'Нет связи' };
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Нет данных';
const severityClass = (level?: string) => level === 'high' || level === 'critical' ? 'danger' : level === 'medium' ? 'warn' : 'neutral';
const safeError = (err: unknown) => err instanceof Error ? err.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.';

function Shell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const [loc, setLocation] = useLocation();
  const qc = useQueryClient();
  const { data: current } = useGetCurrentUser();
  const logout = useLogout({ mutation: { onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }), qc.invalidateQueries({ queryKey: getHealthCheckQueryKey() })]); setLocation('/login'); } } });
  const user = current?.user;
  const links = [
    { href: '/', label: 'Обзор', icon: Gauge },
    { href: '/stations', label: 'Станции', icon: MapPin },
    { href: '/alerts', label: 'Журнал тревог', icon: AlertTriangle },
    ...(user?.role === 'admin' ? [{ href: '/settings', label: 'Настройки', icon: Settings2 }] : []),
  ];
  return <div className="shell">
    <aside className="sidebar">
      <Link href="/" className="brand">KES BEAUX<br />INNOVATEISSES<small>лесной мониторинг</small></Link>
      <div className="navlabel">Рабочее пространство</div>
      {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`navlink ${loc === href || (href === '/stations' && loc.startsWith('/stations/')) ? 'active' : ''}`}><Icon size={16} strokeWidth={1.8} />{label}</Link>)}
      <div className="navlabel" style={{ marginTop: 'auto' }}>Учебный режим</div>
      <div style={{ padding: '5px 10px 13px', fontSize: 10, color: '#b5c4b7', lineHeight: 1.6 }}>Интерфейс для обучения операторов лесного мониторинга.</div>
      {user ? <button className="navlink" onClick={() => logout.mutate()} disabled={logout.isPending} data-testid="button-logout"><LogOut size={16} />Выйти</button> : <Link href="/login" className="navlink"><ShieldCheck size={16} />Войти</Link>}
    </aside>
    <nav className="mobilebar">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={loc === href ? 'active' : ''}><Icon size={18} />{label}</Link>)}</nav>
    <main className="main">
      <header className="topbar">
        <div><div className="eyebrow">{subtitle}</div><h1 className="page-title">{title}</h1></div>
        <div className="user-pill"><span className="avatar">{user?.username?.slice(0, 2).toUpperCase() ?? 'KB'}</span><span><b>{user?.username ?? 'Гостевой просмотр'}</b><span className="role" style={{ display: 'block', color: '#849084', fontSize: 10 }}>{user ? roleText[user.role] : 'Демонстрационный режим'}</span></span></div>
      </header>
      <div className="disclaimer" data-testid="text-disclaimer">{DISCLAIMER}</div>
      {children}
    </main>
  </div>;
}
function Page({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <Shell title={title} subtitle={subtitle}>{children}</Shell>;
}
function StateBox({ loading, error, retry }: { loading?: boolean; error?: unknown; retry?: () => void }) {
  if (loading) return <div className="panel loadingbox"><div className="empty-mark"><Activity size={18} /></div>Загружаем данные мониторинга…</div>;
  if (error) return <div className="panel errorbox"><div className="empty-mark"><CircleHelp size={18} /></div><p>{safeError(error)}</p><button className="btn" onClick={retry} data-testid="button-retry">Повторить запрос</button></div>;
  return null;
}
function Empty({ title, body }: { title: string; body: string }) {
  return <div className="empty"><div className="empty-mark"><Leaf size={18} /></div><b>{title}</b><p>{body}</p></div>;
}
function MarkerCenter({ center }: { center: [number, number] }) { const map = useMap(); useEffect(() => { map.setView(center, map.getZoom()); }, [center, map]); return null; }
function FitStations({ stations }: { stations: Array<{ latitude: number; longitude: number }> }) {
  const map = useMap();
  useEffect(() => {
    if (stations.length > 1) {
      map.fitBounds(
        L.latLngBounds(stations.map((station) => L.latLng(station.latitude, station.longitude))),
        { padding: [32, 32], maxZoom: 7 },
      );
    }
  }, [map, stations]);
  return null;
}

function Dashboard() {
  const qc = useQueryClient();
  const summary = useGetDashboard();
  const stationsQuery = useGetStations();
  const alertsQuery = useGetAlerts();
  const health = useHealthCheck();
  const stations = stationsQuery.data ?? [];
  const alerts = (alertsQuery.data ?? []).filter((a) => a.status !== 'resolved').slice(0, 6);
  const [selectedStation, setSelectedStation] = useState('');
  const [paused, setPaused] = useState(false);
  const [scenarioMode, setScenarioMode] = useState<'normal' | 'dangerous' | null>(null);
  const [simError, setSimError] = useState('');
  const selected = stations.find((s) => s.id === Number(selectedStation));
  const addMeasurement = useAddStationMeasurement({ mutation: { onSuccess: async (_, vars) => {
    await Promise.all([qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }), qc.invalidateQueries({ queryKey: getGetStationsQueryKey() }), qc.invalidateQueries({ queryKey: getGetStationMeasurementsQueryKey(vars.id) }), qc.invalidateQueries({ queryKey: getGetAlertsQueryKey() })]);
  }, onError: (e) => setSimError(safeError(e)) } });
  const reset = useResetSimulation({ mutation: { onSuccess: async () => {
    setSimError('');
    await Promise.all([qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }), qc.invalidateQueries({ queryKey: getGetStationsQueryKey() }), qc.invalidateQueries({ queryKey: getGetAlertsQueryKey() })]);
  }, onError: (e) => setSimError(safeError(e)) } });
  const center: [number, number] = selected ? [selected.latitude, selected.longitude] : stations.length ? [stations.reduce((v, s) => v + s.latitude, 0) / stations.length, stations.reduce((v, s) => v + s.longitude, 0) / stations.length] : [57.5, 40.5];
  const sendScenario = (dangerous: boolean, resumeImmediately = false) => {
    if (!selected || (paused && !resumeImmediately) || addMeasurement.isPending) return;
    setSimError('');
    const temperature = Math.max(-40, Math.min(60, selected.temperature + (dangerous ? 3 : -8)));
    const humidity = Math.max(0, Math.min(100, selected.humidity + (dangerous ? -3 : 10)));
    const smoke = Math.max(0, Math.min(100, selected.smoke + (dangerous ? 8 : -15)));
    addMeasurement.mutate({ id: selected.id, data: { temperature, humidity, smoke } });
  };
  const startScenario = (dangerous: boolean) => {
    setScenarioMode(dangerous ? 'dangerous' : 'normal');
    setPaused(false);
    sendScenario(dangerous, true);
  };
  useEffect(() => {
    if (!scenarioMode || paused || !selected || addMeasurement.isPending) return;
    const timer = window.setTimeout(
      () => sendScenario(scenarioMode === 'dangerous'),
      5_000,
    );
    return () => window.clearTimeout(timer);
  }, [scenarioMode, paused, selected, addMeasurement.isPending]);
  const retry = () => { void summary.refetch(); void stationsQuery.refetch(); void alertsQuery.refetch(); void health.refetch(); };
  const stats = summary.data;
  return <Page title="Центр наблюдения" subtitle="оперативная сводка · мониторинг">
    <StateBox loading={summary.isLoading || stationsQuery.isLoading} error={summary.error || stationsQuery.error} retry={retry} />
    {!summary.isLoading && !stationsQuery.isLoading && !summary.error && !stationsQuery.error && <>
      <div className="grid stats">
        <div className="panel stat"><div className="stat-label">Станций всего</div><div className="stat-value" data-testid="value-total-stations">{stats?.totalStations ?? '—'}</div><div className="stat-note">активных: {stats?.activeStations ?? '—'}</div></div>
        <div className="panel stat"><div className="stat-label">Активные тревоги</div><div className="stat-value" style={{ color: (stats?.activeAlerts ?? 0) ? '#b85243' : undefined }}>{stats?.activeAlerts ?? '—'}</div><div className="stat-note">не закрыты оператором</div></div>
        <div className="panel stat"><div className="stat-label">Средний риск</div><div className="stat-value">{stats ? `${Math.round(stats.averageRisk)}%` : '—'}</div><div className="stat-note">расчёт выполняет сервер</div></div>
        <div className="panel stat"><div className="stat-label">Система</div><div className="stat-value" style={{ fontSize: 20, marginTop: 14 }}>{stats?.systemState === 'online' ? 'В сети' : stats?.systemState === 'degraded' ? 'Требует внимания' : '—'}</div><div className="stat-note">обновлено: {formatDate(stats?.lastUpdated)}</div></div>
      </div>
      <div className="grid dashboard-grid">
        <section className="panel">
          <div className="panel-head"><div><div className="panel-title">Карта станций</div><div className="panel-sub">Спутниковая подложка · выберите метку для перехода</div></div><span className={`badge ${stats?.systemState === 'online' ? '' : 'warn'}`}><span style={{ width: 6, height: 6, background: 'currentColor', borderRadius: 10, marginRight: 6 }} />{stats?.systemState === 'online' ? 'Система активна' : 'Проверить систему'}</span></div>
          <div className="map-wrap">
            {stations.length ? <MapContainer center={center} zoom={7} scrollWheelZoom>
              <MarkerCenter center={center} />
              <FitStations stations={stations} />
              <TileLayer attribution='&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
              {stations.map((s) => <Marker key={s.id} position={[s.latitude, s.longitude]} icon={L.divIcon({ className: '', html: `<div class="station-marker marker-${s.riskLevel}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] })}>
                <Popup><b>{s.name}</b><br />Координаты: {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}<br />Температура: {s.temperature} °C<br />Влажность: {s.humidity}%<br />Задымлённость: {s.smoke}/100<br />Риск: {riskText[s.riskLevel]} · {s.risk}/100<br />Устройство: {deviceText[s.deviceStatus]}<br />Измерение: {formatDate(s.lastMeasuredAt)}<br /><Link href={`/stations/${s.id}`} className="name-link">Открыть карточку</Link></Popup>
              </Marker>)}
            </MapContainer> : <Empty title="Станций пока нет" body="Когда данные станут доступны, они появятся на карте." />}
          </div>
          {stations.length > 0 && <div className="map-legend"><span><i className="marker-low" />Низкий</span><span><i className="marker-medium" />Средний</span><span><i className="marker-high" />Высокий</span><span><i className="marker-critical" />Критический</span></div>}
        </section>
        <div className="content-stack">
          <section className="panel">
            <div className="panel-head"><div><div className="panel-title">Тревоги к разбору</div><div className="panel-sub">Только демонстрационные события</div></div><Link className="btn ghost" href="/alerts">Журнал <ChevronRight size={14} /></Link></div>
            <div className="alert-list">{alertsQuery.isLoading ? <div className="loadingbox">Загружаем журнал…</div> : alertsQuery.error ? <div className="errorbox">{safeError(alertsQuery.error)}</div> : alerts.length ? alerts.map(a => <Link key={a.id} href={`/stations/${a.stationId}`} className="alert-row" style={{ textDecoration: 'none' }}><span className="alert-dot" /><span style={{ flex: 1 }}><span className="alert-name">{a.stationName}</span><span className="alert-meta" style={{ display: 'block' }}>{a.reason} · {formatDate(a.createdAt)}</span></span><span className={`badge ${severityClass(a.severity)}`}>{riskText[a.severity]}</span></Link>) : <Empty title="Новых тревог нет" body="Активные записи появятся в этом списке." />}</div>
          </section>
          <section className="panel">
            <div className="panel-head"><div><div className="panel-title">Симулятор измерений</div><div className="panel-sub">Запросы записываются через API · риск рассчитывает сервер</div></div><span className="badge neutral">Тренировка</span></div>
            <div style={{ padding: 16 }}>
              {stations.length ? <><label className="field"><span>Станция</span><select className="select" value={selectedStation || String(stations[0]?.id ?? '')} onChange={e => setSelectedStation(e.target.value)} data-testid="select-simulation-station">{stations.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={() => setPaused(v => !v)} data-testid="button-simulation-pause">{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Продолжить' : 'Пауза'}</button>
                  <button className={`btn primary ${scenarioMode === 'normal' && !paused ? 'scenario-active' : ''}`} disabled={addMeasurement.isPending} onClick={() => startScenario(false)} data-testid="button-scenario-normal"><Leaf size={14} />Обычный сценарий</button>
                  <button className={`btn danger ${scenarioMode === 'dangerous' && !paused ? 'scenario-active' : ''}`} disabled={addMeasurement.isPending} onClick={() => startScenario(true)} data-testid="button-scenario-dangerous"><Flame size={14} />Опасный сценарий</button>
                  <button className="btn ghost" disabled={reset.isPending || addMeasurement.isPending} onClick={() => { setScenarioMode(null); setPaused(true); reset.mutate(); }} data-testid="button-simulation-reset"><RotateCcw size={14} />Сбросить</button>
                </div>
                {scenarioMode && !paused && <div className="panel-sub" style={{ marginTop: 10 }}>Сценарий: {scenarioMode === 'dangerous' ? 'опасный' : 'обычный'} · новое измерение каждые 5 секунд</div>}
                {paused && <div className="panel-sub" style={{ marginTop: 10 }}>Пауза включена: новые измерения не отправляются.</div>}
                {(simError || addMeasurement.isSuccess || reset.isSuccess) && <div style={{ fontSize: 11, color: simError ? '#ae4b40' : '#3c7658', marginTop: 10 }} role="status">{simError || (reset.isSuccess ? 'Симуляция сброшена. История измерений сохранена.' : 'Измерение отправлено, риск рассчитан сервером.')}</div>}</>
                : <Empty title="Нет станций для симуляции" body="Сначала добавьте станцию с учётной записью администратора." />}
            </div>
          </section>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#818b80', marginTop: 16 }}><span>Состояние API: {health.isLoading ? 'проверка…' : health.data?.status ?? (health.error ? 'недоступен' : '—')}</span><span>Все значения — учебные</span></div>
    </>}
  </Page>;
}

function StationDialog({ initial, onClose, onSave, pending }: { initial?: any; onClose: () => void; onSave: (data: any) => void; pending: boolean }) {
  const [form, setForm] = useState({ name: initial?.name ?? '', latitude: initial?.latitude ?? '', longitude: initial?.longitude ?? '', stationType: initial?.stationType ?? '', deviceStatus: initial?.deviceStatus ?? 'working', scenario: initial?.scenario ?? 'normal' });
  const change = (key: string, value: string) => setForm(v => ({ ...v, [key]: value }));
  const submit = (e: FormEvent) => { e.preventDefault(); onSave({ name: form.name.trim(), latitude: Number(form.latitude), longitude: Number(form.longitude), stationType: form.stationType.trim(), deviceStatus: form.deviceStatus, scenario: form.scenario }); };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><form className="dialog" onSubmit={submit}>
    <h2>{initial ? 'Изменить станцию' : 'Новая станция'}</h2>
    <div className="form-grid">
      <div className="field full"><label>Название</label><input className="input" required minLength={2} maxLength={100} value={form.name} onChange={e => change('name', e.target.value)} data-testid="input-station-name" /></div>
      <div className="field"><label>Широта</label><input className="input" type="number" min="-90" max="90" step="any" required value={form.latitude} onChange={e => change('latitude', e.target.value)} data-testid="input-station-latitude" /></div>
      <div className="field"><label>Долгота</label><input className="input" type="number" min="-180" max="180" step="any" required value={form.longitude} onChange={e => change('longitude', e.target.value)} data-testid="input-station-longitude" /></div>
      <div className="field full"><label>Тип станции</label><input className="input" required minLength={2} maxLength={80} value={form.stationType} onChange={e => change('stationType', e.target.value)} data-testid="input-station-type" /></div>
      <div className="field"><label>Состояние устройства</label><select className="select" value={form.deviceStatus} onChange={e => change('deviceStatus', e.target.value)}><option value="working">На связи</option><option value="faulty">Неисправна</option><option value="offline">Нет связи</option></select></div>
      <div className="field"><label>Сценарий симуляции</label><select className="select" value={form.scenario} onChange={e => change('scenario', e.target.value)}><option value="normal">Обычный</option><option value="dangerous">Опасный</option></select></div>
    </div>
    <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Отмена</button><button className="btn primary" disabled={pending} data-testid="button-save-station">{pending ? 'Сохранение…' : 'Сохранить'}</button></div>
  </form></div>;
}
function Stations() {
  const qc = useQueryClient(); const query = useGetStations(); const { data: current } = useGetCurrentUser();
  const admin = current?.user?.role === 'admin';
  const [search, setSearch] = useState(''); const [riskFilter, setRiskFilter] = useState('all'); const [dialog, setDialog] = useState<any>(null); const [error, setError] = useState('');
  const refresh = async () => { await Promise.all([qc.invalidateQueries({ queryKey: getGetStationsQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]); };
  const create = useCreateStation({ mutation: { onSuccess: async () => { await refresh(); setDialog(null); setError(''); }, onError: e => setError(safeError(e)) } });
  const update = useUpdateStation({ mutation: { onSuccess: async (_, vars) => { await Promise.all([refresh(), qc.invalidateQueries({ queryKey: getGetStationQueryKey(vars.id) })]); setDialog(null); setError(''); }, onError: e => setError(safeError(e)) } });
  const remove = useDeleteStation({ mutation: { onSuccess: async () => { await refresh(); setError(''); }, onError: e => setError(safeError(e)) } });
  const visible = useMemo(() => (query.data ?? []).filter(s => (s.name.toLowerCase().includes(search.toLowerCase()) || s.stationType.toLowerCase().includes(search.toLowerCase())) && (riskFilter === 'all' || s.riskLevel === riskFilter)), [query.data, search, riskFilter]);
  const save = (data: any) => dialog?.station ? update.mutate({ id: dialog.station.id, data }) : create.mutate({ data });
  return <Page title="Станции мониторинга" subtitle="каталог · точки наблюдения">
    <div className="section-head"><div><div className="eyebrow">Каталог сети</div><div className="panel-sub">Поиск и состояние измерительных узлов</div></div>{admin && <button className="btn primary" onClick={() => { setError(''); setDialog({}); }} data-testid="button-create-station"><Plus size={15} />Добавить станцию</button>}</div>
    <div className="panel">
      <div className="panel-head"><div className="toolbar" style={{ flex: 1 }}><label style={{ position: 'relative', flex: 1, maxWidth: 320 }}><Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: '#839084' }} /><input className="input" style={{ width: '100%', paddingLeft: 34 }} placeholder="Найти станцию…" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-station-search" /></label><select className="select" value={riskFilter} onChange={e => setRiskFilter(e.target.value)} data-testid="select-risk-filter"><option value="all">Любой риск</option><option value="low">Низкий риск</option><option value="medium">Средний риск</option><option value="high">Высокий риск</option><option value="critical">Критический риск</option></select><span className="badge neutral">{visible.length} записей</span></div></div>
      <StateBox loading={query.isLoading} error={query.error} retry={() => void query.refetch()} />
      {!query.isLoading && !query.error && (visible.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Станция</th><th>Координаты</th><th>Риск</th><th>Температура</th><th>Устройство</th><th>Измерение</th><th></th></tr></thead><tbody>{visible.map(s => <tr key={s.id} data-testid={`row-station-${s.id}`}><td><Link href={`/stations/${s.id}`} className="name-link">{s.name}</Link><div className="panel-sub">{s.stationType}</div></td><td className="mono">{s.latitude.toFixed(3)}, {s.longitude.toFixed(3)}</td><td><span className={`badge ${severityClass(s.riskLevel)}`}>{riskText[s.riskLevel]} · {s.risk}%</span></td><td>{s.temperature} °C</td><td><span className={`badge ${s.deviceStatus === 'working' ? '' : 'warn'}`}>{deviceText[s.deviceStatus]}</span></td><td className="mono" style={{ fontSize: 10 }}>{formatDate(s.lastMeasuredAt)}</td><td>{admin && <div className="toolbar"><button className="btn" onClick={() => { setError(''); setDialog({ station: s }); }} data-testid={`button-edit-station-${s.id}`}>Изменить</button><button className="btn danger" onClick={() => { if (window.confirm(`Удалить станцию «${s.name}»?`)) remove.mutate({ id: s.id }); }} disabled={remove.isPending} data-testid={`button-delete-station-${s.id}`}>Удалить</button></div>}</td></tr>)}</tbody></table></div> : <Empty title={query.data?.length ? 'Ничего не найдено' : 'Станций пока нет'} body={query.data?.length ? 'Измените запрос или фильтр риска.' : 'Добавьте станцию, чтобы начать учебное наблюдение.'} />)}
    </div>
    {error && <p role="alert" style={{ color: '#a94d42', fontSize: 12 }}>{error}</p>}
    {dialog && <StationDialog initial={dialog.station} onClose={() => setDialog(null)} onSave={save} pending={create.isPending || update.isPending} />}
  </Page>;
}

function StationDetail() {
  const params = useParams<{ id: string }>(); const id = Number(params.id);
  const station = useGetStation(id, { query: { enabled: Number.isFinite(id), queryKey: getGetStationQueryKey(id) } });
  const measurements = useGetStationMeasurements(id, { query: { enabled: Number.isFinite(id), queryKey: getGetStationMeasurementsQueryKey(id) } });
  const [, setLoc] = useLocation();
  const chartData = (measurements.data ?? []).map((measurement) => ({
    time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(measurement.recordedAt)),
    temperature: measurement.temperature,
    humidity: measurement.humidity,
    smoke: measurement.smoke,
    risk: measurement.risk,
  }));
  return <Page title={station.data?.name ?? 'Карточка станции'} subtitle="станция · история измерений">
    <div style={{ marginBottom: 14 }}><button className="btn ghost" onClick={() => setLoc('/stations')}><ArrowLeft size={14} />К списку станций</button></div>
    <StateBox loading={station.isLoading} error={station.error} retry={() => void station.refetch()} />
    {station.data && <>
      <div className="grid detail-layout">
        <section className="panel"><div className="panel-head"><div><div className="panel-title">{station.data.name}</div><div className="panel-sub">{station.data.stationType} · {deviceText[station.data.deviceStatus]}</div></div><span className={`badge ${severityClass(station.data.riskLevel)}`}>{riskText[station.data.riskLevel]}</span></div>
          <div className="grid measure-grid"><div className="measure"><span>Температура</span><b>{station.data.temperature}°</b></div><div className="measure"><span>Влажность</span><b>{station.data.humidity}%</b></div><div className="measure"><span>Дым</span><b>{station.data.smoke}%</b></div></div>
          <div style={{ padding: '0 18px 18px', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#738176' }}><span>Риск: <b style={{ color: '#345844' }}>{station.data.risk}%</b></span><span>Последнее измерение: {formatDate(station.data.lastMeasuredAt)}</span></div>
        </section>
        <section className="panel"><div className="panel-head"><div><div className="panel-title">Положение узла</div><div className="panel-sub mono">{station.data.latitude}, {station.data.longitude}</div></div><MapPin size={17} color="#547860" /></div><div style={{ height: 190 }}><MapContainer center={[station.data.latitude, station.data.longitude]} zoom={8} scrollWheelZoom><TileLayer attribution='&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" /><Marker position={[station.data.latitude, station.data.longitude]} icon={L.divIcon({ className: '', html: `<div class="station-marker marker-${station.data.riskLevel}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] })} /></MapContainer></div></section>
      </div>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><div><div className="panel-title">Динамика измерений</div><div className="panel-sub">Температура, влажность, задымлённость и риск по записям станции</div></div><span className="badge neutral">данные API</span></div>
        {measurements.isLoading ? <div className="chart-wrap">Загружаем историю…</div> : measurements.error ? <div className="chart-wrap"><StateBox error={measurements.error} retry={() => void measurements.refetch()} /></div> : chartData.length ? <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData} margin={{ top: 12, right: 20, bottom: 4, left: -14 }}>
              <CartesianGrid stroke="#e7e8df" strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#7d897f' }} />
              <YAxis tick={{ fontSize: 10, fill: '#7d897f' }} />
              <ChartTooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="temperature" name="Температура °C" stroke="#427b5d" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="humidity" name="Влажность %" stroke="#5788a0" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="smoke" name="Задымлённость" stroke="#d28b3f" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="risk" name="Риск" stroke="#bd5347" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div> : <Empty title="История пока пуста" body="График появится после сохранения измерений." />}
      </section>
      <section className="panel" style={{ marginTop: 16 }}><div className="panel-head"><div><div className="panel-title">История измерений</div><div className="panel-sub">Данные получены из журнала станции</div></div><span className="badge neutral">{measurements.data?.length ?? 0} записей</span></div>
        <StateBox loading={measurements.isLoading} error={measurements.error} retry={() => void measurements.refetch()} />
        {!measurements.isLoading && !measurements.error && (measurements.data?.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Время</th><th>Температура</th><th>Влажность</th><th>Дым</th><th>Риск сервера</th></tr></thead><tbody>{measurements.data.map(m => <tr key={m.id}><td className="mono">{formatDate(m.recordedAt)}</td><td>{m.temperature} °C</td><td>{m.humidity}%</td><td>{m.smoke}%</td><td><span className={`badge ${severityClass(m.riskLevel)}`}>{riskText[m.riskLevel]} · {m.risk}%</span></td></tr>)}</tbody></table></div> : <Empty title="История пуста" body="Измерения появятся после отправки сценария симуляции." />)}
      </section>
    </>}
  </Page>;
}

function Alerts() {
  const qc = useQueryClient(); const query = useGetAlerts(); const { data: current } = useGetCurrentUser();
  const canManage = current?.user?.role === 'admin' || current?.user?.role === 'operator';
  const [filter, setFilter] = useState('all'); const [error, setError] = useState('');
  const update = useUpdateAlert({ mutation: { onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: getGetAlertsQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]); setError(''); }, onError: e => setError(safeError(e)) } });
  const visible = (query.data ?? []).filter(a => filter === 'all' || a.status === filter);
  const statusNext: Record<string, string> = { new: 'in_progress', in_progress: 'processed', processed: 'resolved' };
  return <Page title="Журнал тревог" subtitle="события · очередь оператора">
    <div className="section-head"><div><div className="eyebrow">Разбор событий</div><div className="panel-sub">Все записи относятся к учебной симуляции и не являются реальными извещениями</div></div><select className="select" value={filter} onChange={e => setFilter(e.target.value)} data-testid="select-alert-status"><option value="all">Все статусы</option><option value="new">Новые</option><option value="in_progress">В работе</option><option value="processed">Обработанные</option><option value="resolved">Закрытые</option></select></div>
    <section className="panel"><StateBox loading={query.isLoading} error={query.error} retry={() => void query.refetch()} />
      {!query.isLoading && !query.error && (visible.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Событие</th><th>Уровень</th><th>Причина</th><th>Время</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{visible.map(a => <tr key={a.id} data-testid={`row-alert-${a.id}`}><td><Link className="name-link" href={`/stations/${a.stationId}`}>{a.stationName}</Link><div className="panel-sub">Запись №{a.id}</div></td><td><span className={`badge ${severityClass(a.severity)}`}>{riskText[a.severity]} · {a.risk}%</span></td><td>{a.reason}</td><td className="mono" style={{ fontSize: 10 }}>{formatDate(a.createdAt)}</td><td><span className={`badge ${a.status === 'resolved' ? 'neutral' : a.status === 'new' ? 'danger' : 'warn'}`}>{statusText[a.status]}</span>{a.published && <div className="panel-sub">Опубликовано (учебное)</div>}</td><td>{canManage && statusNext[a.status] && <button className="btn" disabled={update.isPending} onClick={() => update.mutate({ id: a.id, data: { status: statusNext[a.status] as any } })} data-testid={`button-alert-status-${a.id}`}>{statusNext[a.status] === 'in_progress' ? 'Взять в работу' : statusNext[a.status] === 'processed' ? 'Обработать' : 'Закрыть'}<ChevronRight size={13} /></button>}</td></tr>)}</tbody></table></div> : <Empty title="Записей нет" body="Тревоги и изменения статуса появятся здесь." />)}
    </section>{error && <p role="alert" style={{ color: '#a94d42', fontSize: 12 }}>{error}</p>}
  </Page>;
}

function Settings() {
  const qc = useQueryClient(); const { data: current } = useGetCurrentUser(); const [threshold, setThreshold] = useState(''); const [notice, setNotice] = useState('');
  const settings = useGetMonitoringSettings({ query: { enabled: current?.user?.role === 'admin', queryKey: getGetMonitoringSettingsQueryKey() } });
  const users = useGetUsers({ query: { enabled: current?.user?.role === 'admin', queryKey: getGetUsersQueryKey() } });
  useEffect(() => { if (settings.data) setThreshold(String(settings.data.alertThreshold)); }, [settings.data]);
  const updateSettings = useUpdateMonitoringSettings({ mutation: { onSuccess: async () => { setNotice('Порог сохранён.'); await qc.invalidateQueries({ queryKey: getGetMonitoringSettingsQueryKey() }); }, onError: e => setNotice(safeError(e)) } });
  const updateRole = useUpdateUserRole({ mutation: { onSuccess: async () => { setNotice('Роль пользователя обновлена.'); await qc.invalidateQueries({ queryKey: getGetUsersQueryKey() }); }, onError: e => setNotice(safeError(e)) } });
  if (current?.user?.role !== 'admin') return <Page title="Настройки" subtitle="доступ ограничен"><div className="panel"><Empty title="Требуются права администратора" body="Войдите под демонстрационной учётной записью администратора для управления порогом и ролями." /><div style={{ textAlign: 'center', paddingBottom: 22 }}><Link className="btn primary" href="/login">Перейти ко входу</Link></div></div></Page>;
  return <Page title="Настройки системы" subtitle="администрирование · учебный контур">
    <div className="grid detail-layout">
      <section className="panel"><div className="panel-head"><div><div className="panel-title">Порог оповещения</div><div className="panel-sub">Риск от которого сервер фиксирует тревогу</div></div><SlidersHorizontal size={17} color="#557a61" /></div><div style={{ padding: 20 }}>
        <form onSubmit={e => { e.preventDefault(); const value = Number(threshold); if (value >= 30 && value <= 100) updateSettings.mutate({ data: { alertThreshold: value } }); }}><div className="field"><label>Порог риска, от 30 до 100%</label><input className="input" type="number" min="30" max="100" required value={threshold} onChange={e => setThreshold(e.target.value)} data-testid="input-alert-threshold" /></div><p className="panel-sub">Последнее изменение: {formatDate(settings.data?.updatedAt)}</p><button className="btn primary" style={{ marginTop: 10 }} disabled={updateSettings.isPending} data-testid="button-save-threshold"><Check size={14} />Сохранить порог</button></form>
      </div></section>
      <section className="panel"><div className="panel-head"><div><div className="panel-title">Роли пользователей</div><div className="panel-sub">Гость · оператор · администратор</div></div><Users size={17} color="#557a61" /></div>
        <StateBox loading={users.isLoading} error={users.error} retry={() => void users.refetch()} />
        {!users.isLoading && !users.error && (users.data?.length ? <div>{users.data.map(user => <div key={user.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: '1px solid #eeede5' }} data-testid={`row-user-${user.id}`}><div><b style={{ fontSize: 12 }}>{user.username}</b><div className="panel-sub">Пользователь №{user.id}</div></div><select className="select" value={user.role} disabled={updateRole.isPending} onChange={e => updateRole.mutate({ id: user.id, data: { role: e.target.value as 'guest' | 'operator' | 'admin' } })} data-testid={`select-user-role-${user.id}`}><option value="guest">Наблюдатель</option><option value="operator">Оператор</option><option value="admin">Администратор</option></select></div>)}</div> : <Empty title="Список пользователей пуст" body="Пользователи появятся здесь после создания учётных записей." />)}
      </section>
    </div>{notice && <p role="status" style={{ fontSize: 12, color: notice.includes('сохранён') || notice.includes('обновлена') ? '#3d7558' : '#a94d42' }}>{notice}</p>}
  </Page>;
}

function Login() {
  const qc = useQueryClient(); const [, setLocation] = useLocation();
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
  const login = useLogin({ mutation: { onSuccess: async () => { await qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/'); }, onError: e => setError(safeError(e)) } });
  const signIn = (e: FormEvent) => { e.preventDefault(); setError(''); login.mutate({ data: { username, password } }); };
  const demo = (name: string, pass: string) => { setUsername(name); setPassword(pass); };
  return <div className="login-screen">
    <section className="login-art"><div className="login-mark">KES BEAUX INNOVATEISSES<span style={{ display: 'block', font: '500 10px var(--app-font-mono)', letterSpacing: '.14em', marginTop: 8, color: '#aac0ac' }}>ЛЕСНОЙ МОНИТОРИНГ</span></div><div className="login-heading">Наблюдать.<br />Понимать.<br /><em>Действовать.</em></div><div style={{ position: 'relative', zIndex: 1, fontSize: 11, color: '#bdcbbb' }}>Среда обучения операторов лесного мониторинга</div></section>
    <section className="login-side"><div className="login-card"><div className="eyebrow">Демонстрационный доступ</div><h1>Вход в систему</h1><p>Выберите роль или введите данные вручную.</p>
      <form onSubmit={signIn} className="content-stack"><div className="field"><label>Имя пользователя</label><input className="input" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required data-testid="input-login-username" /></div><div className="field"><label>Пароль</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required data-testid="input-login-password" /></div><button className="btn primary" disabled={login.isPending} style={{ justifyContent: 'center', padding: 12 }} data-testid="button-login">{login.isPending ? 'Входим…' : 'Войти'}</button></form>
      {error && <div role="alert" style={{ color: '#aa4e43', fontSize: 12, marginTop: 11 }}>{error}</div>}
      <div className="cred-list"><b>Учебные аккаунты</b><br /><button className="btn ghost" onClick={() => demo('guest', 'guest-demo-2026')} data-testid="button-demo-guest">Гость</button> <code>guest / guest-demo-2026</code><br /><button className="btn ghost" onClick={() => demo('operator', 'operator-demo-2026')} data-testid="button-demo-operator">Оператор</button> <code>operator / operator-demo-2026</code><br /><button className="btn ghost" onClick={() => demo('admin', 'admin-demo-2026')} data-testid="button-demo-admin">Администратор</button> <code>admin / admin-demo-2026</code></div>
      <div className="disclaimer" style={{ marginTop: 16 }}>{DISCLAIMER}</div>
    </div></section>
  </div>;
}

function Router() {
  return <ErrorBoundary><Switch>
    <Route path="/" component={Dashboard} /><Route path="/stations" component={Stations} /><Route path="/stations/:id" component={StationDetail} /><Route path="/alerts" component={Alerts} /><Route path="/settings" component={Settings} /><Route path="/login" component={Login} /><Route component={NotFound} />
  </Switch></ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
