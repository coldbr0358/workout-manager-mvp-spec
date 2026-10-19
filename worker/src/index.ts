interface Env {
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGIN: string;
  MONTHLY_REQUEST_LIMIT?: string;
  MONTHLY_TOKEN_BUDGET?: string;
}

interface AuthUser { id: string }

const coachSchema = {
  type: 'object', additionalProperties: false,
  required: ['confirmed_facts', 'possible_causes', 'insufficient_data', 'next_actions', 'suggested_plan'],
  properties: {
    confirmed_facts: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    possible_causes: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    insufficient_data: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    next_actions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    suggested_plan: {
      anyOf: [
        { type: 'null' },
        { type: 'object', additionalProperties: false, required: ['title', 'summary', 'weekly_days'], properties: { title: { type: 'string' }, summary: { type: 'string' }, weekly_days: { type: 'integer', minimum: 0, maximum: 14 } } },
      ],
    },
  },
};

const nutritionSchema = {
  type: 'object', additionalProperties: false,
  required: ['name', 'calories_min', 'calories_max', 'protein_min', 'protein_max', 'confidence', 'notes'],
  properties: {
    name: { type: 'string' }, calories_min: { type: 'number', minimum: 0, maximum: 20000 }, calories_max: { type: 'number', minimum: 0, maximum: 20000 },
    protein_min: { type: 'number', minimum: 0, maximum: 1000 }, protein_max: { type: 'number', minimum: 0, maximum: 1000 },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, notes: { type: 'string' },
  },
};

function json(body: unknown, status = 200, origin?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN.split(',').map((item) => item.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function bearer(request: Request) {
  const value = request.headers.get('Authorization');
  return value?.startsWith('Bearer ') ? value.slice(7) : null;
}

function jwtPayload(token: string) {
  try {
    const raw = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, '='))) as Record<string, unknown>;
  } catch { return {}; }
}

async function authenticate(request: Request, env: Env): Promise<{ user: AuthUser; token: string }> {
  const token = bearer(request);
  if (!token || jwtPayload(token).aal !== 'aal2') throw new Error('unauthorized');
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('unauthorized');
  const user = await response.json() as AuthUser;
  if (!user.id) throw new Error('unauthorized');
  return { user, token };
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function supabaseRest(env: Env, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function reserveUsage(env: Env, userId: string, tokens: number) {
  const response = await supabaseRest(env, '/rest/v1/rpc/reserve_ai_usage', {
    method: 'POST', body: JSON.stringify({ p_user_id: userId, p_reserved_tokens: tokens, p_request_limit: Number(env.MONTHLY_REQUEST_LIMIT ?? 120), p_token_limit: Number(env.MONTHLY_TOKEN_BUDGET ?? 600000) }),
  });
  if (!response.ok) throw new Error(response.status === 400 ? 'usage_limit' : 'usage_error');
}

async function cachedAnalysis(env: Env, userId: string, hash: string) {
  const query = new URLSearchParams({ user_id: `eq.${userId}`, input_hash: `eq.${hash}`, select: '*', limit: '1' });
  const response = await supabaseRest(env, `/rest/v1/ai_analyses?${query}`);
  if (!response.ok) throw new Error('cache_error');
  return ((await response.json()) as unknown[])[0] ?? null;
}

async function saveAnalysis(env: Env, row: unknown) {
  const response = await supabaseRest(env, '/rest/v1/ai_analyses', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!response.ok) throw new Error('save_error');
  return ((await response.json()) as unknown[])[0];
}

function outputText(response: Record<string, unknown>) {
  if (typeof response.output_text === 'string') return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output as Array<Record<string, unknown>>) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as Array<Record<string, unknown>>) if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
  }
  throw new Error('empty_model_response');
}

async function openAi(env: Env, body: Record<string, unknown>) {
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('model_error');
  return response.json() as Promise<Record<string, unknown>>;
}

async function coach(request: Request, env: Env, origin: string, user: AuthUser) {
  const body = await request.json() as { type?: string; prompt?: string; context?: unknown };
  if (!['inbody_change', 'coach_chat'].includes(body.type ?? '') || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 800) return json({ error: '요청 형식을 확인해 주세요.' }, 400, origin);
  const contextText = JSON.stringify(body.context ?? {});
  if (contextText.length > 120_000) return json({ error: '분석 데이터가 너무 큽니다.' }, 413, origin);
  const inputHash = await sha256(JSON.stringify({ type: body.type, prompt: body.prompt.trim(), context: body.context }));
  const cached = await cachedAnalysis(env, user.id, inputHash);
  if (cached) return json({ analysis: cached, cached: true }, 200, origin);
  await reserveUsage(env, user.id, 6000);
  const safeUser = await sha256(user.id);
  const response = await openAi(env, {
    model: env.OPENAI_MODEL ?? 'gpt-5.4-mini',
    store: false,
    max_output_tokens: 1600,
    safety_identifier: safeUser,
    prompt_cache_key: safeUser,
    instructions: '당신은 개인 운동 기록을 설명하는 근거 중심 코치입니다. 제공된 수치에서 확인할 수 없는 내용을 만들지 마세요. 수치 계산을 새로 하지 말고 입력된 계산 결과를 해석하세요. 가능한 원인은 가능성으로만 표현하세요. 의료 진단을 하지 말고 위험 신호가 있거나 사용자가 통증·질병을 언급하면 의료 전문가 상담을 권하세요. 계획 변경 제안은 suggested_plan에 넣되 적용됐다고 말하지 마세요. 모든 문장은 간결한 한국어로 작성하세요.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: `요청: ${body.prompt.trim()}\n\n익명화된 기록:\n${contextText}` }] }],
    text: { format: { type: 'json_schema', name: 'workout_coach_response', strict: true, schema: coachSchema } },
  });
  const result = JSON.parse(outputText(response));
  const analysis = await saveAnalysis(env, { user_id: user.id, analysis_type: body.type, input_hash: inputHash, prompt: body.prompt.trim(), result });
  return json({ analysis, cached: false }, 200, origin);
}

async function nutrition(request: Request, env: Env, origin: string, user: AuthUser) {
  const body = await request.json() as { image?: string };
  if (typeof body.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(body.image) || body.image.length > 7_200_000) return json({ error: '사진 형식이나 크기를 확인해 주세요.' }, 400, origin);
  await reserveUsage(env, user.id, 2500);
  const safeUser = await sha256(user.id);
  const response = await openAi(env, {
    model: env.OPENAI_MODEL ?? 'gpt-5.4-mini', store: false, max_output_tokens: 700, safety_identifier: safeUser,
    instructions: '영양성분표 사진에서 1회 섭취 기준 칼로리(kcal)와 단백질(g)을 추출하세요. 사진이 불명확하거나 제공량이 애매하면 보수적인 최소·최대 범위를 사용하고 confidence를 낮추세요. 보이지 않는 값을 만들지 마세요. 제품명은 보이는 경우에만 사용하고 없으면 영양성분표 제품이라고 쓰세요. 한국어로 작성하세요.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: '이 사진의 영양정보를 추출해 주세요.' }, { type: 'input_image', image_url: body.image, detail: 'high' }] }],
    text: { format: { type: 'json_schema', name: 'nutrition_extraction', strict: true, schema: nutritionSchema } },
  });
  const extraction = JSON.parse(outputText(response));
  if (extraction.calories_max < extraction.calories_min || extraction.protein_max < extraction.protein_min) return json({ error: '추출 범위가 올바르지 않습니다.' }, 502, origin);
  return json({ extraction }, 200, origin);
}

async function removeAccount(request: Request, env: Env, origin: string, user: AuthUser) {
  const body = await request.json() as { confirmation?: string };
  if (body.confirmation !== 'DELETE') return json({ error: '삭제 확인 문구가 일치하지 않습니다.' }, 400, origin);
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!response.ok) return json({ error: '계정을 삭제하지 못했습니다.' }, 502, origin);
  return json({ deleted: true }, 200, origin);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: '허용되지 않은 출처입니다.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } });
    if (request.method !== 'POST') return json({ error: '지원하지 않는 요청입니다.' }, 405, origin);
    try {
      const { user } = await authenticate(request, env);
      const path = new URL(request.url).pathname;
      if (path === '/v1/coach') return coach(request, env, origin, user);
      if (path === '/v1/nutrition/extract') return nutrition(request, env, origin, user);
      if (path === '/v1/account/delete') return removeAccount(request, env, origin, user);
      return json({ error: '찾을 수 없습니다.' }, 404, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      if (message === 'unauthorized') return json({ error: '2단계 인증이 필요한 세션입니다.' }, 401, origin);
      if (message === 'usage_limit') return json({ error: '이번 달 AI 사용 한도에 도달했습니다.' }, 429, origin);
      return json({ error: '요청을 안전하게 처리하지 못했습니다.' }, 500, origin);
    }
  },
};

export default worker;
