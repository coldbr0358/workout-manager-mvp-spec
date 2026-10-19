import type { FoodEntry, InBodyMeasurement, Profile } from './types';

export function isSameLocalDay(iso: string, date = new Date()) {
  const value = new Date(iso);
  return value.getFullYear() === date.getFullYear()
    && value.getMonth() === date.getMonth()
    && value.getDate() === date.getDate();
}

export function sumFoods(entries: FoodEntry[]) {
  return entries.reduce((sum, entry) => ({
    proteinMin: sum.proteinMin + entry.protein_min,
    proteinMax: sum.proteinMax + entry.protein_max,
    caloriesMin: sum.caloriesMin + entry.calories_min,
    caloriesMax: sum.caloriesMax + entry.calories_max,
    complete: sum.complete && entry.status !== 'incomplete',
  }), { proteinMin: 0, proteinMax: 0, caloriesMin: 0, caloriesMax: 0, complete: true });
}

export function estimateCalorieTarget(profile: Profile, measurements: InBodyMeasurement[], foods: FoodEntry[] = []) {
  const bmr = [...measurements]
    .sort((a, b) => +new Date(b.measured_at) - +new Date(a.measured_at))
    .find((measurement) => measurement.bmr !== null)?.bmr ?? 1650;
  const initialTdee = Math.round(bmr * profile.base_activity_factor + profile.planned_exercise_kcal_week / 7);
  const cutoff = Date.now() - 23 * 86_400_000;
  const completeDays = new Map<string, FoodEntry[]>();
  foods.filter((entry) => +new Date(entry.eaten_at) >= cutoff).forEach((entry) => {
    const day = entry.eaten_at.slice(0, 10);
    completeDays.set(day, [...(completeDays.get(day) ?? []), entry]);
  });
  const dailyCalories = Array.from(completeDays.values())
    .filter((entries) => entries.every((entry) => entry.status !== 'incomplete'))
    .map((entries) => {
      const total = sumFoods(entries);
      return (total.caloriesMin + total.caloriesMax) / 2;
    });
  const datedWeights = measurements
    .filter((measurement) => measurement.weight !== null && +new Date(measurement.measured_at) >= cutoff)
    .sort((a, b) => +new Date(a.measured_at) - +new Date(b.measured_at));
  const first = datedWeights[0];
  const last = datedWeights.at(-1);
  const spanDays = first && last ? (+new Date(last.measured_at) - +new Date(first.measured_at)) / 86_400_000 : 0;
  let tdee = initialTdee;
  let source: 'initial' | 'adaptive' = 'initial';
  if (dailyCalories.length >= 14 && first && last && first.weight !== null && last.weight !== null && spanDays >= 14) {
    const averageIntake = dailyCalories.reduce((sum, value) => sum + value, 0) / dailyCalories.length;
    const observedTdee = averageIntake + ((first.weight - last.weight) * 7700) / spanDays;
    const boundedObserved = Math.min(initialTdee * 1.15, Math.max(initialTdee * .85, observedTdee));
    tdee = Math.round(initialTdee * .75 + boundedObserved * .25);
    source = 'adaptive';
  }
  const center = Math.max(1200, tdee - profile.calorie_deficit);
  return {
    bmr,
    tdee,
    min: Math.round((center - 75) / 10) * 10,
    max: Math.round((center + 75) / 10) * 10,
    source,
  };
}

export function metricValue(measurement: InBodyMeasurement, metric: string) {
  if (metric === 'weight') return measurement.weight;
  if (metric === 'skeletal_muscle_mass') return measurement.skeletal_muscle_mass;
  if (metric === 'body_fat_percentage') return measurement.body_fat_percentage;
  if (metric === 'bmr') return measurement.bmr;
  const raw = measurement.raw_values[metric];
  return typeof raw === 'number' ? raw : null;
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
