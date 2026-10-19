export type EntryStatus = 'complete' | 'estimated' | 'incomplete';

export interface Profile {
  user_id: string;
  display_name: string;
  protein_min: number;
  protein_target_min: number;
  protein_target_max: number;
  calorie_deficit: number;
  base_activity_factor: number;
  planned_exercise_kcal_week: number;
  selected_metric: string;
}

export interface FoodEntry {
  id: string;
  user_id: string;
  eaten_at: string;
  name: string;
  protein_min: number;
  protein_max: number;
  calories_min: number;
  calories_max: number;
  status: EntryStatus;
  source: 'manual' | 'photo';
  notes?: string | null;
}

export interface WorkoutEntry {
  id: string;
  user_id: string;
  performed_at: string;
  area: string;
  duration_minutes: number;
  completed: boolean;
  notes?: string | null;
}

export interface WorkoutPlan {
  id: string;
  user_id: string;
  title: string;
  summary: string;
  weekly_days: number;
  is_baseline: boolean;
  updated_at: string;
}

export interface InBodyMeasurement {
  id: string;
  user_id: string;
  measured_at: string;
  source_hash: string;
  weight: number | null;
  skeletal_muscle_mass: number | null;
  body_fat_percentage: number | null;
  bmr: number | null;
  raw_values: Record<string, string | number | boolean | null>;
}

export interface CoachResult {
  confirmed_facts: string[];
  possible_causes: string[];
  insufficient_data: string[];
  next_actions: string[];
  suggested_plan?: { title: string; summary: string; weekly_days: number } | null;
}

export interface AiAnalysis {
  id: string;
  user_id: string;
  analysis_type: 'inbody_change' | 'coach_chat' | 'nutrition_extract';
  input_hash: string;
  prompt?: string | null;
  result: CoachResult;
  created_at: string;
}

export interface AppData {
  profile: Profile;
  foods: FoodEntry[];
  workouts: WorkoutEntry[];
  measurements: InBodyMeasurement[];
  plans: WorkoutPlan[];
  analyses: AiAnalysis[];
}

export interface ParsedMeasurement extends Omit<InBodyMeasurement, 'id' | 'user_id'> {
  row_number: number;
}

export type TabId = 'home' | 'log' | 'body' | 'coach';
