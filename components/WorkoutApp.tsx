'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Camera, Check, ChevronRight, CircleUserRound,
  Dumbbell, FileDown, FileSpreadsheet, Home, LoaderCircle, LogOut, MessageCircle, MoreHorizontal,
  Plus, Save, Send, Settings, ShieldCheck, Sparkles, Trash2, Utensils, X,
} from 'lucide-react';
import { estimateCalorieTarget, formatNumber, isSameLocalDay, metricValue, sumFoods } from '@/lib/calculations';
import { parseInBodyFile } from '@/lib/inbody-parser';
import {
  createFood, createPlan, createWorkout, deleteAccount, deleteFood, deleteWorkout, extractNutrition, importMeasurements,
  makeDemoAnalysis, requestCoach, saveProfile, supabase,
} from '@/lib/supabase';
import type { AiAnalysis, AppData, FoodEntry, ParsedMeasurement, Profile, TabId, WorkoutEntry, WorkoutPlan } from '@/lib/types';
import { TrendChart } from './TrendChart';

const NAV_ITEMS: Array<{ id: TabId; label: string; icon: typeof Home }> = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'log', label: '기록', icon: Plus },
  { id: 'body', label: '신체변화', icon: BarChart3 },
  { id: 'coach', label: 'AI 코치', icon: MessageCircle },
];

const METRICS = [
  { id: 'weight', label: '체중', unit: 'kg' },
  { id: 'skeletal_muscle_mass', label: '골격근량', unit: 'kg' },
  { id: 'body_fat_percentage', label: '체지방률', unit: '%' },
  { id: 'bmr', label: '기초대사량', unit: 'kcal' },
];

const dateFormatter = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' });
const fullDateFormatter = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
const timeFormatter = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

function shortDate(value: string) { return dateFormatter.format(new Date(value)); }
function signed(value: number, digits = 1) { return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}`; }
function uid(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

function buildAiContext(data: AppData) {
  const cutoff = Date.now() - 21 * 86_400_000;
  const recentFoods = data.foods.filter((entry) => +new Date(entry.eaten_at) >= cutoff);
  const days = new Map<string, FoodEntry[]>();
  recentFoods.forEach((entry) => {
    const day = entry.eaten_at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), entry]);
  });
  return {
    profile: {
      protein_targets: [data.profile.protein_min, data.profile.protein_target_min, data.profile.protein_target_max],
      calorie_deficit: data.profile.calorie_deficit,
      activity_factor: data.profile.base_activity_factor,
    },
    measurements: [...data.measurements]
      .sort((a, b) => +new Date(b.measured_at) - +new Date(a.measured_at))
      .slice(0, 8)
      .map(({ measured_at, weight, skeletal_muscle_mass, body_fat_percentage, bmr }) => ({ measured_at, weight, skeletal_muscle_mass, body_fat_percentage, bmr })),
    nutrition_days: Array.from(days, ([date, entries]) => ({ date, ...sumFoods(entries) })),
    workouts: data.workouts.filter((entry) => +new Date(entry.performed_at) >= cutoff).map(({ performed_at, area, duration_minutes, completed }) => ({ performed_at, area, duration_minutes, completed })),
    baseline_plan: data.plans.find((plan) => plan.is_baseline) ?? null,
  };
}

export function WorkoutApp({ initialData, session = null, isDemo = false }: { initialData: AppData; session?: Session | null; isDemo?: boolean }) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<TabId>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function updateProfile(profile: Profile) { setData((current) => ({ ...current, profile })); }

  return (
    <main className="app-shell">
      <section className="phone-frame">
        {isDemo && <div className="demo-banner"><span>미리보기</span> 현재 데이터는 저장되지 않아요.</div>}
        <header className="topbar">
          <button className="brand-button" type="button" onClick={() => setTab('home')} aria-label="홈으로 이동"><span>W</span><b>Workout Manager</b></button>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="설정 열기"><Settings size={18} /></button>
        </header>

        <div className="app-scroll" key={tab}>
          {tab === 'home' && <HomeScreen data={data} setTab={setTab} />}
          {tab === 'log' && <LogScreen data={data} setData={setData} session={session} isDemo={isDemo} notify={setToast} />}
          {tab === 'body' && <BodyScreen data={data} setData={setData} session={session} isDemo={isDemo} notify={setToast} />}
          {tab === 'coach' && <CoachScreen data={data} setData={setData} session={session} isDemo={isDemo} notify={setToast} />}
        </div>

        <nav className="bottom-nav" aria-label="주요 메뉴">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
              <span><Icon size={20} strokeWidth={tab === id ? 2.5 : 1.9} /></span>{label}
            </button>
          ))}
        </nav>

        {settingsOpen && <SettingsPanel data={data} setData={setData} session={session} isDemo={isDemo} onClose={() => setSettingsOpen(false)} onProfile={updateProfile} notify={setToast} />}
        {toast && <div className="toast" role="status"><Check size={15} /> {toast}</div>}
      </section>
    </main>
  );
}

function HomeScreen({ data, setTab }: { data: AppData; setTab: (tab: TabId) => void }) {
  const todayEntries = data.foods.filter((entry) => isSameLocalDay(entry.eaten_at));
  const totals = sumFoods(todayEntries);
  const target = estimateCalorieTarget(data.profile, data.measurements, data.foods);
  const proteinProgress = Math.min(100, Math.round((totals.proteinMin / data.profile.protein_min) * 100));
  const calorieProgress = Math.min(100, Math.round((totals.caloriesMax / target.max) * 100));
  const remainingMin = Math.max(0, target.min - totals.caloriesMax);
  const remainingMax = Math.max(0, target.max - totals.caloriesMin);
  const measurements = [...data.measurements].sort((a, b) => +new Date(a.measured_at) - +new Date(b.measured_at));
  const latest = measurements.at(-1);
  const previous = measurements.at(-2);
  const latestAnalysis = data.analyses.find((analysis) => analysis.analysis_type === 'inbody_change');

  return (
    <div className="page-content home-page">
      <div className="eyebrow">{fullDateFormatter.format(new Date())}</div>
      <div className="page-heading">
        <div><p>좋은 하루예요, {data.profile.display_name}님</p><h1>몸의 흐름을<br />차분히 이어가요.</h1></div>
        <span className="status-pill"><i /> 기록 중</span>
      </div>

      <article className="daily-card">
        <div className="daily-copy">
          <span className="card-kicker">오늘의 방향</span>
          <h2>단백질부터<br />채워볼까요?</h2>
          <p className="target-range">권장 {data.profile.protein_target_min}–{data.profile.protein_target_max}g</p>
          <p>최소선까지 {Math.max(0, Math.ceil(data.profile.protein_min - totals.proteinMin))}g 남았어요</p>
        </div>
        <div className="protein-ring" style={{ background: `conic-gradient(var(--lime) 0 ${proteinProgress}%, #343834 ${proteinProgress}% 100%)` }} aria-label={`단백질 최소 목표 ${data.profile.protein_min}g 중 ${Math.round(totals.proteinMin)}g 섭취`}>
          <div><strong>{Math.round(totals.proteinMin)}</strong><span>/ {data.profile.protein_min}g</span></div>
        </div>
      </article>

      <section className="metrics-grid" aria-label="오늘의 영양 현황">
        <article className="metric-card calorie">
          <div className="metric-head"><span>섭취 칼로리</span><b>{calorieProgress}%</b></div>
          <strong>{formatNumber(totals.caloriesMin)}{totals.caloriesMax !== totals.caloriesMin && <small>–{formatNumber(totals.caloriesMax)}</small>} <small>kcal</small></strong>
          <div className="range-track"><span style={{ width: `${calorieProgress}%` }} /></div>
          <p>{target.source === 'adaptive' ? '체중 추세로 보정' : 'BMR·활동·계획 기준'} · {formatNumber(target.min)}–{formatNumber(target.max)}</p>
        </article>
        <article className="metric-card budget">
          <div className="metric-head"><span>남은 범위</span><b>오늘</b></div>
          <strong>{formatNumber(remainingMin)}–{formatNumber(remainingMax)} <small>kcal</small></strong>
          <p>운동 소비량은 당일 예산에 전부 더하지 않아요.</p>
        </article>
      </section>

      <section className="section-block">
        <div className="section-title">
          <div><span className="card-kicker">BODY TREND</span><h2>몸의 변화</h2></div>
          <button type="button" onClick={() => setTab('body')}>전체 보기 <ArrowRight size={13} /></button>
        </div>
        {latest ? (
          <article className="body-card">
            <div className="body-stats">
              <MetricStat label="체중" value={latest.weight} unit="kg" delta={latest.weight !== null && previous?.weight !== null && previous?.weight !== undefined ? latest.weight - previous.weight : null} />
              <MetricStat label="골격근량" value={latest.skeletal_muscle_mass} unit="kg" delta={latest.skeletal_muscle_mass !== null && previous?.skeletal_muscle_mass !== null && previous?.skeletal_muscle_mass !== undefined ? latest.skeletal_muscle_mass - previous.skeletal_muscle_mass : null} />
              <MetricStat label="체지방률" value={latest.body_fat_percentage} unit="%" delta={latest.body_fat_percentage !== null && previous?.body_fat_percentage !== null && previous?.body_fat_percentage !== undefined ? latest.body_fat_percentage - previous.body_fat_percentage : null} />
            </div>
            <TrendChart values={measurements.slice(-8).map((item) => item.weight)} labels={measurements.length ? [shortDate(measurements[Math.max(0, measurements.length - 8)].measured_at), shortDate(measurements.at(-1)!.measured_at)] : undefined} ariaLabel="최근 체중 변화 그래프" />
          </article>
        ) : <EmptyCard icon={FileSpreadsheet} title="첫 인바디 기록을 가져와 보세요" body="CSV 또는 엑셀 파일은 아이폰 안에서만 읽고 원본을 저장하지 않아요." action="신체변화로 이동" onAction={() => setTab('body')} />}
      </section>

      <button className="coach-nudge" type="button" onClick={() => setTab('coach')}>
        <span className="coach-mark"><Sparkles size={16} /></span>
        <span><strong>{latestAnalysis ? '새 변화 리포트가 있어요' : 'AI 코치에게 물어보세요'}</strong><small>{latestAnalysis?.result.confirmed_facts[0] ?? '저장된 기록만 바탕으로 답변해요.'}</small></span>
        <ChevronRight size={17} />
      </button>
    </div>
  );
}

function MetricStat({ label, value, unit, delta }: { label: string; value: number | null; unit: string; delta: number | null }) {
  return (
    <div><span>{label}</span><strong>{value === null ? '—' : value.toFixed(1)}<small>{value === null ? '' : unit}</small></strong>{delta !== null && <em className={delta > 0 ? 'up' : ''}>{signed(delta)}</em>}</div>
  );
}

function LogScreen({ data, setData, session, isDemo, notify }: ScreenProps) {
  const [mode, setMode] = useState<'food' | 'workout'>('food');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [reviewNotice, setReviewNotice] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const [food, setFood] = useState({ name: '', caloriesMin: '', caloriesMax: '', proteinMin: '', proteinMax: '', estimated: false, incomplete: false });
  const [workout, setWorkout] = useState({ area: '등 · 이두', duration: '60', completed: true, notes: '' });
  const todayFoods = data.foods.filter((entry) => isSameLocalDay(entry.eaten_at));
  const todayWorkouts = data.workouts.filter((entry) => isSameLocalDay(entry.performed_at));
  const totals = sumFoods(todayFoods);
  const baseline = data.plans.find((plan) => plan.is_baseline);

  function setFoodValue(field: keyof typeof food, value: string | boolean) { setFood((current) => ({ ...current, [field]: value })); }

  async function submitFood(event: React.FormEvent) {
    event.preventDefault();
    const caloriesMin = Number(food.caloriesMin);
    const caloriesMax = food.estimated ? Number(food.caloriesMax) : caloriesMin;
    const proteinMin = Number(food.proteinMin);
    const proteinMax = food.estimated ? Number(food.proteinMax) : proteinMin;
    if (!food.name.trim() || !Number.isFinite(caloriesMin) || !Number.isFinite(caloriesMax) || !Number.isFinite(proteinMin) || !Number.isFinite(proteinMax)) return;
    if (caloriesMin < 0 || caloriesMax < caloriesMin || proteinMin < 0 || proteinMax < proteinMin) { notify('최소값과 최대값을 다시 확인해 주세요.'); return; }
    setBusy(true);
    const payload: Omit<FoodEntry, 'id'> = {
      user_id: data.profile.user_id, eaten_at: new Date().toISOString(), name: food.name.trim(),
      calories_min: caloriesMin, calories_max: caloriesMax, protein_min: proteinMin, protein_max: proteinMax,
      status: food.incomplete ? 'incomplete' : food.estimated ? 'estimated' : 'complete', source: reviewNotice ? 'photo' : 'manual', notes: reviewNotice || null,
    };
    try {
      const saved = isDemo ? { ...payload, id: uid('food') } : await createFood(payload);
      setData((current) => ({ ...current, foods: [saved, ...current.foods] }));
      setFood({ name: '', caloriesMin: '', caloriesMax: '', proteinMin: '', proteinMax: '', estimated: false, incomplete: false });
      setReviewNotice(''); notify('식단을 기록했어요.');
    } catch (caught) { notify(caught instanceof Error ? caught.message : '식단을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function removeFood(id: string) {
    try {
      if (!isDemo) await deleteFood(id);
      setData((current) => ({ ...current, foods: current.foods.filter((entry) => entry.id !== id) }));
      notify('기록을 삭제했어요.');
    } catch (caught) { notify(caught instanceof Error ? caught.message : '기록을 삭제하지 못했습니다.'); }
  }

  async function handlePhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const extraction = isDemo
        ? { name: '영양성분표 제품', calories_min: 240, calories_max: 240, protein_min: 20, protein_max: 20, confidence: 'medium' as const, notes: '1회 제공량 기준' }
        : (await extractNutrition(session!, file)).extraction;
      setFood({ name: extraction.name, caloriesMin: String(extraction.calories_min), caloriesMax: String(extraction.calories_max), proteinMin: String(extraction.protein_min), proteinMax: String(extraction.protein_max), estimated: extraction.calories_min !== extraction.calories_max || extraction.protein_min !== extraction.protein_max, incomplete: false });
      setReviewNotice(`AI 추출 · 신뢰도 ${extraction.confidence} · ${extraction.notes}`);
      notify('추출값을 확인한 뒤 저장해 주세요.');
    } catch (caught) { notify(caught instanceof Error ? caught.message : '사진에서 값을 읽지 못했습니다.'); }
    finally { setPhotoBusy(false); if (photoInput.current) photoInput.current.value = ''; }
  }

  async function submitWorkout(event: React.FormEvent) {
    event.preventDefault();
    const duration = Number(workout.duration);
    if (!Number.isFinite(duration) || duration < 0 || duration > 360) { notify('운동 시간은 0–360분으로 입력해 주세요.'); return; }
    setBusy(true);
    const payload: Omit<WorkoutEntry, 'id'> = { user_id: data.profile.user_id, performed_at: new Date().toISOString(), area: workout.area, duration_minutes: duration, completed: workout.completed, notes: workout.notes || null };
    try {
      const saved = isDemo ? { ...payload, id: uid('workout') } : await createWorkout(payload);
      setData((current) => ({ ...current, workouts: [saved, ...current.workouts] }));
      setWorkout((current) => ({ ...current, notes: '' })); notify('운동을 기록했어요.');
    } catch (caught) { notify(caught instanceof Error ? caught.message : '운동을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function removeWorkout(id: string) {
    try {
      if (!isDemo) await deleteWorkout(id);
      setData((current) => ({ ...current, workouts: current.workouts.filter((entry) => entry.id !== id) }));
      notify('운동 기록을 삭제했어요.');
    } catch (caught) { notify(caught instanceof Error ? caught.message : '운동 기록을 삭제하지 못했습니다.'); }
  }

  return (
    <div className="page-content log-page">
      <PageIntro kicker="QUICK LOG" title="오늘의 기록" body="정확한 만큼만, 빠르게 남겨요." />
      <div className="segmented-control" role="tablist">
        <button role="tab" aria-selected={mode === 'food'} className={mode === 'food' ? 'active' : ''} onClick={() => setMode('food')}><Utensils size={16} /> 식단</button>
        <button role="tab" aria-selected={mode === 'workout'} className={mode === 'workout' ? 'active' : ''} onClick={() => setMode('workout')}><Dumbbell size={17} /> 운동</button>
      </div>

      {mode === 'food' ? (
        <>
          <article className="today-total"><div><span>오늘 단백질</span><strong>{Math.round(totals.proteinMin)}–{Math.round(totals.proteinMax)}g</strong></div><i /><div><span>오늘 칼로리</span><strong>{formatNumber(totals.caloriesMin)}–{formatNumber(totals.caloriesMax)}</strong></div></article>
          <form className="entry-card" onSubmit={submitFood}>
            <div className="entry-card-head"><div><span className="card-kicker">ADD MEAL</span><h2>빠른 식단 입력</h2></div><button type="button" className="photo-button" onClick={() => photoInput.current?.click()} disabled={photoBusy}>{photoBusy ? <LoaderCircle className="spin" /> : <Camera />} 사진 읽기</button></div>
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => handlePhoto(event.target.files?.[0])} />
            {reviewNotice && <div className="review-callout"><Sparkles size={15} /><span><strong>저장 전 확인이 필요해요.</strong>{reviewNotice}</span></div>}
            <label className="field wide"><span>음식 이름</span><input required maxLength={80} value={food.name} onChange={(event) => setFoodValue('name', event.target.value)} placeholder="예: 닭가슴살 포케" /></label>
            <div className="range-toggle"><span><b>추정 범위로 기록</b><small>외식처럼 정확하지 않을 때 사용해요.</small></span><button type="button" role="switch" aria-checked={food.estimated} className={food.estimated ? 'on' : ''} onClick={() => setFoodValue('estimated', !food.estimated)}><i /></button></div>
            <label className="incomplete-check"><input type="checkbox" checked={food.incomplete} onChange={(event) => setFoodValue('incomplete', event.target.checked)} /><span><b>오늘 기록은 불완전함</b><small>하루 합계에는 포함하되 적응형 TDEE 계산에서는 제외해요.</small></span></label>
            <div className="field-grid">
              <label className="field"><span>칼로리 {food.estimated ? '최소' : ''}</span><div><input required inputMode="decimal" value={food.caloriesMin} onChange={(event) => setFoodValue('caloriesMin', event.target.value)} /><small>kcal</small></div></label>
              {food.estimated && <label className="field"><span>칼로리 최대</span><div><input required inputMode="decimal" value={food.caloriesMax} onChange={(event) => setFoodValue('caloriesMax', event.target.value)} /><small>kcal</small></div></label>}
              <label className="field"><span>단백질 {food.estimated ? '최소' : ''}</span><div><input required inputMode="decimal" value={food.proteinMin} onChange={(event) => setFoodValue('proteinMin', event.target.value)} /><small>g</small></div></label>
              {food.estimated && <label className="field"><span>단백질 최대</span><div><input required inputMode="decimal" value={food.proteinMax} onChange={(event) => setFoodValue('proteinMax', event.target.value)} /><small>g</small></div></label>}
            </div>
            <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Plus />} 식단 추가</button>
          </form>
          <EntryList title="오늘 먹은 것" empty="아직 기록한 식단이 없어요." entries={todayFoods.map((entry) => ({ id: entry.id, title: entry.name, meta: `${timeFormatter.format(new Date(entry.eaten_at))} · 단백질 ${entry.protein_min}${entry.protein_max !== entry.protein_min ? `–${entry.protein_max}` : ''}g`, value: `${entry.calories_min}${entry.calories_max !== entry.calories_min ? `–${entry.calories_max}` : ''} kcal`, badge: entry.status === 'estimated' ? '추정' : undefined }))} onDelete={removeFood} />
        </>
      ) : (
        <>
          {baseline && <article className="plan-summary"><div className="plan-icon"><Dumbbell size={18} /></div><div><span>기준 계획</span><strong>{baseline.title}</strong><p>{baseline.summary}</p></div></article>}
          <form className="entry-card" onSubmit={submitWorkout}>
            <div className="entry-card-head"><div><span className="card-kicker">ADD WORKOUT</span><h2>운동 기록</h2></div></div>
            <fieldset className="chip-field"><legend>운동 부위</legend><div>{['가슴 · 삼두', '등 · 이두', '하체', '어깨 · 코어', '유산소'].map((area) => <button key={area} type="button" className={workout.area === area ? 'active' : ''} onClick={() => setWorkout((current) => ({ ...current, area }))}>{area}</button>)}</div></fieldset>
            <div className="field-grid">
              <label className="field"><span>수행 여부</span><select value={workout.completed ? 'done' : 'skipped'} onChange={(event) => setWorkout((current) => ({ ...current, completed: event.target.value === 'done' }))}><option value="done">수행함</option><option value="skipped">건너뜀</option></select></label>
              <label className="field"><span>운동 시간</span><div><input required inputMode="numeric" value={workout.duration} onChange={(event) => setWorkout((current) => ({ ...current, duration: event.target.value }))} /><small>분</small></div></label>
            </div>
            <label className="field wide"><span>메모 · 선택</span><textarea maxLength={300} value={workout.notes} onChange={(event) => setWorkout((current) => ({ ...current, notes: event.target.value }))} placeholder="컨디션이나 세트 강도를 남겨 보세요." /></label>
            <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Plus />} 운동 추가</button>
          </form>
          <EntryList title="오늘 운동" empty="오늘 운동 기록이 없어요." entries={todayWorkouts.map((entry) => ({ id: entry.id, title: entry.area, meta: entry.completed ? '수행 완료' : '건너뜀', value: `${entry.duration_minutes}분` }))} onDelete={removeWorkout} />
        </>
      )}
    </div>
  );
}

function BodyScreen({ data, setData, session, isDemo, notify }: ScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedMetric, setSelectedMetric] = useState(data.profile.selected_metric || 'weight');
  const [pending, setPending] = useState<ParsedMeasurement[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState('');
  const measurements = useMemo(() => [...data.measurements].sort((a, b) => +new Date(a.measured_at) - +new Date(b.measured_at)), [data.measurements]);
  const latest = measurements.at(-1);
  const previous = measurements.at(-2);
  const metric = METRICS.find((item) => item.id === selectedMetric) ?? METRICS[0];
  const values = measurements.map((measurement) => metricValue(measurement, selectedMetric));
  const finite = values.filter((value): value is number => value !== null);
  const segmentEntries = latest ? Object.entries(latest.raw_values).filter(([label, value]) => value !== null && typeof value === 'number' && /(팔|다리|몸통|arm|leg|trunk)/i.test(label)) : [];

  async function chooseMetric(nextMetric: string) {
    setSelectedMetric(nextMetric);
    const profile = { ...data.profile, selected_metric: nextMetric };
    setData((current) => ({ ...current, profile }));
    if (!isDemo) {
      try { await saveProfile(profile); } catch { /* The view can still change locally. */ }
    }
  }

  async function handleFile(file?: File) {
    if (!file) return;
    setBusy(true); setParseError(''); setPending([]); setFileName(file.name);
    try {
      const parsed = await parseInBodyFile(file);
      const existing = new Set(data.measurements.map((measurement) => measurement.source_hash));
      setPending(parsed.filter((measurement) => !existing.has(measurement.source_hash)));
      if (parsed.every((measurement) => existing.has(measurement.source_hash))) notify('모든 측정이 이미 저장되어 있어요.');
    } catch (caught) { setParseError(caught instanceof Error ? caught.message : '파일을 읽지 못했습니다.'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  async function confirmImport() {
    if (!pending.length) return;
    setBusy(true);
    try {
      const inserted = isDemo
        ? pending.map(({ row_number, ...measurement }) => { void row_number; return { ...measurement, id: uid('measurement'), user_id: data.profile.user_id }; })
        : await importMeasurements(data.profile.user_id, pending);
      let nextData: AppData = { ...data, measurements: [...inserted, ...data.measurements] };
      setData(nextData); setPending([]); notify(`새 측정 ${inserted.length}개를 추가했어요.`);
      if (inserted.length && (isDemo || session)) {
        const prompt = '새 인바디 측정과 이전 기록의 변화를 분석해 주세요.';
        try {
          const analysis = isDemo ? makeDemoAnalysis(data.profile.user_id, prompt) : (await requestCoach(session!, 'inbody_change', prompt, buildAiContext(nextData))).analysis;
          analysis.analysis_type = 'inbody_change';
          nextData = { ...nextData, analyses: [analysis, ...nextData.analyses] };
          setData(nextData);
        } catch { notify('측정은 저장됐지만 변화 리포트 생성은 다음에 다시 시도해 주세요.'); }
      }
    } catch (caught) { notify(caught instanceof Error ? caught.message : '측정을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="page-content body-page">
      <PageIntro kicker="BODY HISTORY" title="신체변화" body="같은 조건의 측정을 길게 이어서 봐요." />
      <button className="import-button" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
        <span>{busy ? <LoaderCircle className="spin" /> : <FileSpreadsheet />}</span><span><strong>인바디 파일 가져오기</strong><small>CSV · XLSX · XLS, 최대 10MB</small></span><ChevronRight />
      </button>
      <input ref={inputRef} hidden type="file" accept=".csv,.xlsx,.xls" onChange={(event) => handleFile(event.target.files?.[0])} />
      <p className="privacy-note"><ShieldCheck size={14} /> 원본 파일은 이 기기에서만 읽고 서버에 보관하지 않아요.</p>
      {parseError && <div className="inline-error" role="alert"><X size={16} />{parseError}</div>}
      {(pending.length > 0 || fileName) && !parseError && (
        <article className="import-review">
          <div className="entry-card-head"><div><span className="card-kicker">IMPORT REVIEW</span><h2>{fileName}</h2></div><button type="button" className="close-small" onClick={() => { setPending([]); setFileName(''); }} aria-label="가져오기 취소"><X /></button></div>
          {pending.length ? <><p>중복을 제외한 새 측정 <strong>{pending.length}개</strong>를 찾았어요.</p><div className="preview-table">{pending.slice(0, 3).map((measurement) => <div key={measurement.source_hash}><span>{shortDate(measurement.measured_at)}</span><b>{measurement.weight ?? '—'}kg</b><small>근육 {measurement.skeletal_muscle_mass ?? '—'} · 체지방 {measurement.body_fat_percentage ?? '—'}%</small></div>)}</div><button className="primary-button" type="button" onClick={confirmImport} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Save />} 확인하고 저장</button></> : <p>이 파일에는 새 측정이 없습니다.</p>}
        </article>
      )}

      {latest ? (
        <>
          <section className="latest-measurement">
            <div className="section-title"><div><span className="card-kicker">LATEST · {shortDate(latest.measured_at)}</span><h2>최근 측정</h2></div></div>
            <div className="measurement-hero">
              <MetricStat label="체중" value={latest.weight} unit="kg" delta={latest.weight !== null && previous?.weight != null ? latest.weight - previous.weight : null} />
              <MetricStat label="골격근량" value={latest.skeletal_muscle_mass} unit="kg" delta={latest.skeletal_muscle_mass !== null && previous?.skeletal_muscle_mass != null ? latest.skeletal_muscle_mass - previous.skeletal_muscle_mass : null} />
              <MetricStat label="체지방률" value={latest.body_fat_percentage} unit="%" delta={latest.body_fat_percentage !== null && previous?.body_fat_percentage != null ? latest.body_fat_percentage - previous.body_fat_percentage : null} />
            </div>
          </section>
          <section className="trend-section">
            <div className="section-title"><div><span className="card-kicker">LONG TERM</span><h2>장기 변화</h2></div></div>
            <div className="metric-tabs">{METRICS.map((item) => <button key={item.id} className={selectedMetric === item.id ? 'active' : ''} type="button" onClick={() => chooseMetric(item.id)}>{item.label}</button>)}</div>
            <article className="large-chart-card">
              <div className="chart-summary"><span>{metric.label}</span><strong>{finite.at(-1)?.toFixed(metric.id === 'bmr' ? 0 : 1) ?? '—'} <small>{metric.unit}</small></strong>{finite.length > 1 && <em>{signed(finite.at(-1)! - finite[0], metric.id === 'bmr' ? 0 : 1)} {metric.unit}</em>}</div>
              <TrendChart values={values.slice(-12)} labels={measurements.length ? [shortDate(measurements[Math.max(0, measurements.length - 12)].measured_at), shortDate(measurements.at(-1)!.measured_at)] : undefined} ariaLabel={`${metric.label} 장기 변화 그래프`} />
              {finite.length > 1 && <div className="history-range"><span>기록 내 범위</span><b>{Math.min(...finite).toFixed(metric.id === 'bmr' ? 0 : 1)}–{Math.max(...finite).toFixed(metric.id === 'bmr' ? 0 : 1)} {metric.unit}</b></div>}
            </article>
          </section>
          {segmentEntries.length > 0 && (
            <section className="segment-section"><div className="section-title"><div><span className="card-kicker">MEASURED SEGMENTS</span><h2>부위별 측정</h2></div></div><article className="segment-card">{segmentEntries.map(([label, value]) => <div key={label}><span>{label}</span><strong>{String(value)}</strong></div>)}</article><p className="data-caption">파일에 실제 값이 있는 부위만 표시합니다.</p></section>
          )}
          <details className="raw-details"><summary>가져온 전체 열 보기 <ChevronRight /></summary><div>{Object.entries(latest.raw_values).map(([label, value]) => <div key={label}><span>{label}</span><b>{value === null ? '미측정' : String(value)}</b></div>)}</div></details>
        </>
      ) : <EmptyCard icon={Activity} title="아직 측정 기록이 없어요" body="전체 이력 파일을 여러 번 올려도 새로운 측정만 추가합니다." />}
    </div>
  );
}

function CoachScreen({ data, setData, session, isDemo, notify }: ScreenProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const latestReport = data.analyses.find((analysis) => analysis.analysis_type === 'inbody_change');
  const chats = data.analyses.filter((analysis) => analysis.analysis_type === 'coach_chat');
  const [active, setActive] = useState<AiAnalysis | null>(latestReport ?? chats[0] ?? null);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const analysis = isDemo ? makeDemoAnalysis(data.profile.user_id, prompt.trim()) : (await requestCoach(session!, 'coach_chat', prompt.trim(), buildAiContext(data))).analysis;
      setData((current) => ({ ...current, analyses: [analysis, ...current.analyses] }));
      setActive(analysis); setPrompt('');
    } catch (caught) { notify(caught instanceof Error ? caught.message : 'AI 코치에게 연결하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function acceptPlan(suggestion: NonNullable<AiAnalysis['result']['suggested_plan']>) {
    const payload: Omit<WorkoutPlan, 'id' | 'updated_at'> = { user_id: data.profile.user_id, title: suggestion.title, summary: suggestion.summary, weekly_days: suggestion.weekly_days, is_baseline: true };
    try {
      const saved = isDemo ? { ...payload, id: uid('plan'), updated_at: new Date().toISOString() } : await createPlan(payload);
      setData((current) => ({ ...current, plans: [saved, ...current.plans.map((plan) => ({ ...plan, is_baseline: false }))] }));
      setActive((current) => current ? { ...current, result: { ...current.result, suggested_plan: null } } : current);
      notify('확인한 계획을 기준 계획으로 저장했어요.');
    } catch (caught) { notify(caught instanceof Error ? caught.message : '계획을 저장하지 못했습니다.'); }
  }

  return (
    <div className="page-content coach-page">
      <PageIntro kicker="EVIDENCE-AWARE" title="AI 코치" body="계산은 코드로, AI는 해석과 설명만 맡아요." />
      <div className="coach-guard"><ShieldCheck size={17} /><p><strong>필요한 기록만 사용해요.</strong><span>의료 진단을 제공하지 않으며, 중요한 건강 문제는 전문가 상담을 안내합니다.</span></p></div>
      {active ? <AnalysisCard analysis={active} onAcceptPlan={acceptPlan} /> : <EmptyCard icon={Sparkles} title="첫 분석을 요청해 보세요" body="저장된 계획, 운동, 식단, 신체변화 기록을 함께 살펴봅니다." />}
      <section className="question-section">
        <div className="section-title"><div><span className="card-kicker">ASK ONLY WHEN NEEDED</span><h2>코치에게 묻기</h2></div></div>
        <div className="prompt-chips">{['최근 감량 속도 괜찮아?', '이번 주 운동을 조정할까?', '단백질 기록을 점검해줘'].map((suggestion) => <button key={suggestion} type="button" onClick={() => setPrompt(suggestion)}>{suggestion}</button>)}</div>
        <form className="coach-form" onSubmit={ask}><label htmlFor="coach-prompt" className="sr-only">AI 코치에게 질문</label><textarea id="coach-prompt" maxLength={800} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="기록을 바탕으로 궁금한 점을 물어보세요." /><button type="submit" disabled={busy || !prompt.trim()} aria-label="질문 보내기">{busy ? <LoaderCircle className="spin" /> : <Send />}</button></form>
      </section>
      {chats.length > 0 && <section className="history-section"><div className="section-title"><div><span className="card-kicker">RECENT</span><h2>최근 상담</h2></div></div><div className="analysis-history">{chats.map((analysis) => <button type="button" key={analysis.id} onClick={() => setActive(analysis)}><MessageCircle /><span><strong>{analysis.prompt || '요청형 분석'}</strong><small>{shortDate(analysis.created_at)}</small></span><ChevronRight /></button>)}</div></section>}
    </div>
  );
}

function AnalysisCard({ analysis, onAcceptPlan }: { analysis: AiAnalysis; onAcceptPlan: (suggestion: NonNullable<AiAnalysis['result']['suggested_plan']>) => void }) {
  const sections = [
    { label: '확인된 사실', icon: Check, items: analysis.result.confirmed_facts, tone: 'fact' },
    { label: '가능한 원인', icon: Sparkles, items: analysis.result.possible_causes, tone: 'cause' },
    { label: '데이터 부족', icon: MoreHorizontal, items: analysis.result.insufficient_data, tone: 'missing' },
    { label: '다음 행동', icon: ArrowRight, items: analysis.result.next_actions, tone: 'action' },
  ];
  return (
    <article className="analysis-card">
      <div className="analysis-head"><span className="coach-mark"><Sparkles /></span><div><span>{analysis.analysis_type === 'inbody_change' ? '변화 리포트' : '요청형 분석'}</span><strong>{shortDate(analysis.created_at)} 분석</strong></div></div>
      {sections.map(({ label, icon: Icon, items, tone }) => <section key={label} className={`analysis-section ${tone}`}><h3><Icon />{label}</h3>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>해당 내용이 없습니다.</p>}</section>)}
      {analysis.result.suggested_plan && <div className="plan-proposal"><span>확인이 필요한 계획 변경</span><strong>{analysis.result.suggested_plan.title}</strong><p>{analysis.result.suggested_plan.summary}</p><div><button type="button" className="secondary-button">이번에는 유지</button><button type="button" className="primary-button" onClick={() => onAcceptPlan(analysis.result.suggested_plan!)}><Check /> 확인하고 저장</button></div></div>}
    </article>
  );
}

function SettingsPanel({ data, setData, session, isDemo, onClose, onProfile, notify }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; session: Session | null; isDemo: boolean; onClose: () => void; onProfile: (profile: Profile) => void; notify: (message: string) => void }) {
  const [profile, setProfile] = useState(data.profile);
  const baseline = data.plans.find((plan) => plan.is_baseline);
  const [plan, setPlan] = useState({ title: baseline?.title ?? '', summary: baseline?.summary ?? '', weekly_days: String(baseline?.weekly_days ?? 4) });
  const [busy, setBusy] = useState(false);

  function change(field: keyof Profile, value: string) {
    setProfile((current) => ({ ...current, [field]: field === 'display_name' ? value : Number(value) }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (profile.protein_min > profile.protein_target_min || profile.protein_target_min > profile.protein_target_max) { notify('단백질 목표 범위를 다시 확인해 주세요.'); return; }
    setBusy(true);
    try {
      const saved = isDemo ? profile : await saveProfile(profile);
      onProfile(saved); notify('목표를 저장했어요.');
    } catch (caught) { notify(caught instanceof Error ? caught.message : '설정을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function submitPlan(event: React.FormEvent) {
    event.preventDefault();
    const weeklyDays = Number(plan.weekly_days);
    if (!plan.title.trim() || !plan.summary.trim() || !Number.isInteger(weeklyDays) || weeklyDays < 0 || weeklyDays > 14) return;
    setBusy(true);
    const payload: Omit<WorkoutPlan, 'id' | 'updated_at'> = { user_id: data.profile.user_id, title: plan.title.trim(), summary: plan.summary.trim(), weekly_days: weeklyDays, is_baseline: true };
    try {
      const saved = isDemo ? { ...payload, id: uid('plan'), updated_at: new Date().toISOString() } : await createPlan(payload);
      setData((current) => ({ ...current, plans: [saved, ...current.plans.map((item) => ({ ...item, is_baseline: false }))] }));
      notify('기준 운동 계획을 저장했어요.');
    } catch (caught) { notify(caught instanceof Error ? caught.message : '운동 계획을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  function exportData() {
    const safe = { exported_at: new Date().toISOString(), profile: data.profile, food_entries: data.foods, workout_entries: data.workouts, workout_plans: data.plans, inbody_measurements: data.measurements, ai_analyses: data.analyses };
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `workout-manager-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
    notify('데이터 내보내기를 시작했어요.');
  }

  async function removeAccount() {
    if (isDemo) { notify('미리보기에서는 계정을 삭제하지 않아요.'); return; }
    if (!session) return;
    const confirmation = window.prompt('계정과 모든 데이터를 영구 삭제하려면 DELETE를 입력해 주세요.');
    if (confirmation !== 'DELETE') return;
    setBusy(true);
    try { await deleteAccount(session); await supabase?.auth.signOut(); }
    catch (caught) { notify(caught instanceof Error ? caught.message : '계정을 삭제하지 못했습니다.'); setBusy(false); }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><button type="button" onClick={onClose} aria-label="설정 닫기"><ArrowLeft /></button><div><span className="card-kicker">PREFERENCES</span><h2 id="settings-title">설정과 보안</h2></div></header>
        <div className="sheet-scroll">
          <section className="account-card"><CircleUserRound /><div><strong>{profile.display_name || '사용자'}님</strong><span>{isDemo ? '미리보기 모드' : session?.user.email}</span></div><b><ShieldCheck /> AAL2</b></section>
          <form className="settings-form" onSubmit={submit}>
            <h3>개인 목표</h3>
            <label className="field wide"><span>표시 이름</span><input maxLength={30} value={profile.display_name} onChange={(event) => change('display_name', event.target.value)} /></label>
            <div className="field-grid three"><label className="field"><span>단백질 최소</span><div><input type="number" min="30" max="400" value={profile.protein_min} onChange={(event) => change('protein_min', event.target.value)} /><small>g</small></div></label><label className="field"><span>권장 시작</span><div><input type="number" min="30" max="400" value={profile.protein_target_min} onChange={(event) => change('protein_target_min', event.target.value)} /><small>g</small></div></label><label className="field"><span>권장 상한</span><div><input type="number" min="30" max="400" value={profile.protein_target_max} onChange={(event) => change('protein_target_max', event.target.value)} /><small>g</small></div></label></div>
            <div className="field-grid"><label className="field"><span>목표 적자</span><div><input type="number" min="0" max="1000" step="10" value={profile.calorie_deficit} onChange={(event) => change('calorie_deficit', event.target.value)} /><small>kcal</small></div></label><label className="field"><span>활동 계수</span><input type="number" min="1.1" max="2.2" step="0.01" value={profile.base_activity_factor} onChange={(event) => change('base_activity_factor', event.target.value)} /></label></div>
            <label className="field wide"><span>주간 계획 운동량</span><div><input type="number" min="0" max="10000" step="50" value={profile.planned_exercise_kcal_week} onChange={(event) => change('planned_exercise_kcal_week', event.target.value)} /><small>kcal / 주</small></div></label>
            <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Save />} 목표 저장</button>
          </form>
          <form className="settings-form plan-settings" onSubmit={submitPlan}>
            <h3>기준 운동 계획</h3>
            <p>기존 ChatGPT 운동 프로젝트에서 정리한 루틴 요약을 붙여 넣으세요. 대화 내용은 자동으로 읽지 않습니다.</p>
            <label className="field wide"><span>계획 이름</span><input required maxLength={100} value={plan.title} onChange={(event) => setPlan((current) => ({ ...current, title: event.target.value }))} placeholder="예: 주 4일 상·하체 루틴" /></label>
            <label className="field wide"><span>루틴 요약</span><textarea required maxLength={4000} value={plan.summary} onChange={(event) => setPlan((current) => ({ ...current, summary: event.target.value }))} placeholder="요일별 부위, 주요 운동, 세트와 강도 기준을 붙여 넣으세요." /></label>
            <label className="field wide"><span>주간 운동 일수</span><input required type="number" min="0" max="14" value={plan.weekly_days} onChange={(event) => setPlan((current) => ({ ...current, weekly_days: event.target.value }))} /></label>
            <button className="secondary-button plan-save" disabled={busy}><Dumbbell /> 기준 계획 저장</button>
          </form>
          <section className="settings-group"><h3>내 데이터</h3><button type="button" onClick={exportData}><FileDown /><span><strong>데이터 내보내기</strong><small>식단, 운동, 측정과 분석을 JSON으로 받습니다.</small></span><ChevronRight /></button></section>
          <section className="settings-group"><h3>계정 보안</h3>{!isDemo && <button type="button" onClick={() => supabase?.auth.signOut()}><LogOut /><span><strong>로그아웃</strong><small>이 기기의 세션을 종료합니다.</small></span><ChevronRight /></button>}<button type="button" className="danger-row" onClick={removeAccount} disabled={busy}><Trash2 /><span><strong>계정과 데이터 삭제</strong><small>되돌릴 수 없는 작업이며 다시 확인합니다.</small></span><ChevronRight /></button></section>
          <p className="settings-footnote">건강 데이터는 다중 인증이 완료된 세션에서만 접근할 수 있습니다.</p>
        </div>
      </aside>
    </div>
  );
}

interface ScreenProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  session: Session | null;
  isDemo: boolean;
  notify: (message: string) => void;
}

function PageIntro({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return <header className="page-intro"><span className="card-kicker">{kicker}</span><h1>{title}</h1><p>{body}</p></header>;
}

function EmptyCard({ icon: Icon, title, body, action, onAction }: { icon: typeof Activity; title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="empty-card"><span><Icon /></span><h3>{title}</h3><p>{body}</p>{action && <button type="button" onClick={onAction}>{action}<ArrowRight /></button>}</div>;
}

interface EntryView { id: string; title: string; meta: string; value: string; badge?: string }
function EntryList({ title, empty, entries, onDelete }: { title: string; empty: string; entries: EntryView[]; onDelete?: (id: string) => void }) {
  return (
    <section className="entry-list"><div className="section-title"><div><span className="card-kicker">TODAY</span><h2>{title}</h2></div></div>{entries.length ? <div>{entries.map((entry) => <article key={entry.id}><span className="entry-bullet" /><div><strong>{entry.title}</strong><small>{entry.meta}</small></div><span className="entry-value">{entry.badge && <i>{entry.badge}</i>}{entry.value}</span>{onDelete && <button type="button" onClick={() => onDelete(entry.id)} aria-label={`${entry.title} 삭제`}><Trash2 /></button>}</article>)}</div> : <p className="entry-empty">{empty}</p>}</section>
  );
}
