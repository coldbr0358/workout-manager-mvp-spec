import type { AppData } from './types';

const DAY = 86_400_000;
const now = new Date();

function atDay(offset: number, hour = 8) {
  const date = new Date(now.getTime() + offset * DAY);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

export const demoData: AppData = {
  profile: {
    user_id: 'demo-user',
    display_name: '데모 사용자',
    protein_min: 140,
    protein_target_min: 155,
    protein_target_max: 175,
    calorie_deficit: 420,
    base_activity_factor: 1.36,
    planned_exercise_kcal_week: 1200,
    selected_metric: 'weight',
  },
  foods: [
    { id: 'food-1', user_id: 'demo-user', eaten_at: atDay(0, 8), name: '그릭요거트와 견과', protein_min: 24, protein_max: 24, calories_min: 310, calories_max: 310, status: 'complete', source: 'manual' },
    { id: 'food-2', user_id: 'demo-user', eaten_at: atDay(0, 12), name: '닭가슴살 포케', protein_min: 38, protein_max: 46, calories_min: 520, calories_max: 620, status: 'estimated', source: 'manual' },
    { id: 'food-3', user_id: 'demo-user', eaten_at: atDay(0, 16), name: '프로틴 쉐이크', protein_min: 28, protein_max: 28, calories_min: 160, calories_max: 160, status: 'complete', source: 'photo' },
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `history-food-${index}`,
      user_id: 'demo-user',
      eaten_at: atDay(-index - 1, 13),
      name: '하루 식단 합계',
      protein_min: 132 + (index % 5) * 5,
      protein_max: 145 + (index % 5) * 5,
      calories_min: 1840 + (index % 4) * 55,
      calories_max: 1980 + (index % 4) * 55,
      status: (index % 6 === 0 ? 'incomplete' : 'complete') as 'complete' | 'incomplete',
      source: 'manual' as const,
    })),
  ],
  workouts: [
    { id: 'workout-1', user_id: 'demo-user', performed_at: atDay(-1, 19), area: '등 · 이두', duration_minutes: 62, completed: true, notes: '마지막 세트 RPE 8' },
    { id: 'workout-2', user_id: 'demo-user', performed_at: atDay(-3, 19), area: '하체', duration_minutes: 70, completed: true },
    { id: 'workout-3', user_id: 'demo-user', performed_at: atDay(-5, 18), area: '가슴 · 삼두', duration_minutes: 55, completed: true },
  ],
  measurements: [
    [0, 76.8, 34.2, 21.6, 1660], [-10, 77.1, 34.1, 22.0, 1654], [-20, 77.5, 34.2, 22.4, 1658], [-30, 77.8, 34.0, 22.8, 1648], [-40, 78.0, 34.1, 23.0, 1652], [-50, 78.2, 34.1, 23.1, 1650],
  ].map(([offset, weight, muscle, fat, bmr], index) => ({
    id: `measurement-${index}`,
    user_id: 'demo-user',
    measured_at: atDay(offset, 7),
    source_hash: `demo-${index}`,
    weight,
    skeletal_muscle_mass: muscle,
    body_fat_percentage: fat,
    bmr,
    raw_values: {
      '체중': weight,
      '골격근량': muscle,
      '체지방률': fat,
      '기초대사량': bmr,
      '오른팔 근육량': index < 4 ? 3.41 - index * 0.01 : null,
      '왼팔 근육량': index < 4 ? 3.36 - index * 0.01 : null,
      '몸통 근육량': index < 4 ? 27.1 - index * 0.05 : null,
      '오른다리 근육량': index < 4 ? 9.52 - index * 0.02 : null,
      '왼다리 근육량': index < 4 ? 9.47 - index * 0.02 : null,
    },
  })),
  plans: [{
    id: 'plan-1', user_id: 'demo-user', title: '주 4일 상·하체 루틴', weekly_days: 4, is_baseline: true,
    summary: '월 상체 밀기 · 화 하체 · 목 상체 당기기 · 토 하체. 주 운동량을 유지하며 주요 복합 운동은 RPE 7–8로 진행합니다.',
    updated_at: atDay(-14),
  }],
  analyses: [{
    id: 'analysis-1', user_id: 'demo-user', analysis_type: 'inbody_change', input_hash: 'demo-analysis', created_at: atDay(-1),
    result: {
      confirmed_facts: ['최근 50일간 체중이 1.4kg 감소했습니다.', '같은 기간 골격근량은 측정 오차 범위 안에서 유지됐습니다.'],
      possible_causes: ['기록된 섭취량과 운동 빈도가 현재의 완만한 감량 추세에 기여했을 수 있습니다.'],
      insufficient_data: ['수면과 일상 활동량 데이터가 없어 컨디션 변화의 원인은 판단하기 어렵습니다.'],
      next_actions: ['현재 섭취 범위를 2주 더 유지하세요.', '같은 시간대와 조건에서 다음 측정을 진행하세요.'],
    },
  }],
};
