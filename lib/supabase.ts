import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { AiAnalysis, AppData, CoachResult, FoodEntry, InBodyMeasurement, ParsedMeasurement, Profile, WorkoutEntry, WorkoutPlan } from './types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

function requireClient() {
  if (!supabase) throw new Error('Supabase 환경 변수가 설정되지 않았습니다.');
  return supabase;
}

function throwIf(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadAppData(userId: string): Promise<AppData> {
  const client = requireClient();
  const [profileResult, foodsResult, workoutsResult, measurementsResult, plansResult, analysesResult] = await Promise.all([
    client.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    client.from('food_entries').select('*').order('eaten_at', { ascending: false }).limit(500),
    client.from('workout_entries').select('*').order('performed_at', { ascending: false }).limit(200),
    client.from('inbody_measurements').select('*').order('measured_at', { ascending: false }).limit(500),
    client.from('workout_plans').select('*').order('updated_at', { ascending: false }).limit(20),
    client.from('ai_analyses').select('*').order('created_at', { ascending: false }).limit(100),
  ]);
  [profileResult, foodsResult, workoutsResult, measurementsResult, plansResult, analysesResult].forEach((result) => throwIf(result.error));
  const profile = profileResult.data ?? {
    user_id: userId,
    display_name: '사용자',
    protein_min: 120,
    protein_target_min: 140,
    protein_target_max: 160,
    calorie_deficit: 400,
    base_activity_factor: 1.35,
    planned_exercise_kcal_week: 1000,
    selected_metric: 'weight',
  };
  if (!profileResult.data) {
    const { error } = await client.from('profiles').insert(profile);
    throwIf(error);
  }
  return {
    profile: profile as Profile,
    foods: (foodsResult.data ?? []) as FoodEntry[],
    workouts: (workoutsResult.data ?? []) as WorkoutEntry[],
    measurements: (measurementsResult.data ?? []) as InBodyMeasurement[],
    plans: (plansResult.data ?? []) as WorkoutPlan[],
    analyses: (analysesResult.data ?? []) as AiAnalysis[],
  };
}

export async function saveProfile(profile: Profile) {
  const { data, error } = await requireClient().from('profiles').upsert(profile).select().single();
  throwIf(error);
  return data as Profile;
}

export async function createFood(entry: Omit<FoodEntry, 'id'>) {
  const { data, error } = await requireClient().from('food_entries').insert(entry).select().single();
  throwIf(error);
  return data as FoodEntry;
}

export async function deleteFood(id: string) {
  const { error } = await requireClient().from('food_entries').delete().eq('id', id);
  throwIf(error);
}

export async function createWorkout(entry: Omit<WorkoutEntry, 'id'>) {
  const { data, error } = await requireClient().from('workout_entries').insert(entry).select().single();
  throwIf(error);
  return data as WorkoutEntry;
}

export async function deleteWorkout(id: string) {
  const { error } = await requireClient().from('workout_entries').delete().eq('id', id);
  throwIf(error);
}

export async function importMeasurements(userId: string, measurements: ParsedMeasurement[]) {
  const rows = measurements.map(({ row_number, ...measurement }) => { void row_number; return { ...measurement, user_id: userId }; });
  const { data, error } = await requireClient()
    .from('inbody_measurements')
    .upsert(rows, { onConflict: 'user_id,source_hash', ignoreDuplicates: true })
    .select();
  throwIf(error);
  return (data ?? []) as InBodyMeasurement[];
}

export async function createPlan(plan: Omit<WorkoutPlan, 'id' | 'updated_at'>) {
  const client = requireClient();
  if (plan.is_baseline) {
    const { error } = await client.from('workout_plans').update({ is_baseline: false }).eq('user_id', plan.user_id);
    throwIf(error);
  }
  const { data, error } = await client.from('workout_plans').insert(plan).select().single();
  throwIf(error);
  return data as WorkoutPlan;
}

async function workerRequest<T>(path: string, body: unknown, session: Session): Promise<T> {
  const workerUrl = process.env.NEXT_PUBLIC_AI_WORKER_URL;
  if (!workerUrl) throw new Error('AI Worker 주소가 설정되지 않았습니다.');
  const response = await fetch(`${workerUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? 'AI 요청을 처리하지 못했습니다.');
  return payload;
}

export async function requestCoach(session: Session, type: 'inbody_change' | 'coach_chat', prompt: string, context: unknown) {
  return workerRequest<{ analysis: AiAnalysis; cached: boolean }>('/v1/coach', { type, prompt, context }, session);
}

export async function extractNutrition(session: Session, file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('사진은 5MB 이하여야 합니다.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG 또는 WebP 사진만 사용할 수 있습니다.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  return workerRequest<{ extraction: { name: string; calories_min: number; calories_max: number; protein_min: number; protein_max: number; confidence: 'high' | 'medium' | 'low'; notes: string } }>('/v1/nutrition/extract', { image: dataUrl }, session);
}

export async function deleteAccount(session: Session) {
  return workerRequest<{ deleted: true }>('/v1/account/delete', { confirmation: 'DELETE' }, session);
}

export function makeDemoAnalysis(userId: string, prompt: string): AiAnalysis {
  const result: CoachResult = {
    confirmed_facts: ['최근 체중은 완만하게 감소했고 골격근량은 큰 변화 없이 유지되고 있습니다.', '오늘 기록된 단백질은 아직 최소선에 도달하지 않았습니다.'],
    possible_causes: ['현재의 식단 범위와 주 3–4회 운동이 추세 유지에 기여했을 수 있습니다.'],
    insufficient_data: ['수면과 운동 강도 기록이 충분하지 않아 피로의 원인은 판단하기 어렵습니다.'],
    next_actions: ['오늘 남은 식사에서 단백질 40–50g을 우선 확보하세요.', '다음 측정 전까지 현재 계획을 유지하고 수행 여부를 기록하세요.'],
  };
  return { id: crypto.randomUUID(), user_id: userId, analysis_type: 'coach_chat', input_hash: crypto.randomUUID(), prompt, result, created_at: new Date().toISOString() };
}
