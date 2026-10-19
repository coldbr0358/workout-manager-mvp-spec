import { readSheet } from 'read-excel-file/browser';
import type { ParsedMeasurement } from './types';

type Cell = string | number | boolean | Date | null;

const DATE_KEYS = ['측정일', '측정일자', '검사일', 'date', 'measurementdate', 'testdate'];
const METRIC_KEYS = {
  weight: ['체중', 'weight'],
  skeletal_muscle_mass: ['골격근량', 'smm', 'skeletalmusclemass'],
  body_fat_percentage: ['체지방률', 'pbf', 'percentbodyfat', 'bodyfatpercentage'],
  bmr: ['기초대사량', 'bmr', 'basalmetabolicrate'],
} as const;

function key(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/[\s_%()·./-]|\[|\]/g, '');
}

function normalizeCell(value: Cell): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '-' || /^(n\/?a|미측정|null)$/i.test(trimmed)) return null;
    return trimmed;
  }
  return value;
}

function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(cell); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => String(value).trim())) rows.push(row);
  return rows;
}

function numeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function dateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && value > 25_000 && value < 80_000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toISOString();
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\./g, '-').replace(/\//g, '-').replace(/년|월/g, '-').replace(/일/g, '');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function findValue(row: Record<string, Cell>, aliases: readonly string[]) {
  const entry = Object.entries(row).find(([header]) => aliases.includes(key(header)));
  return entry?.[1] ?? null;
}

async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertRange(label: string, value: number | null, min: number, max: number, row: number) {
  if (value !== null && (value < min || value > max)) {
    throw new Error(`${row}행의 ${label} 값(${value})이 허용 범위를 벗어났습니다.`);
  }
}

export async function parseInBodyFile(file: File): Promise<ParsedMeasurement[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !['csv', 'xlsx', 'xls'].includes(extension)) throw new Error('CSV, XLSX 또는 XLS 파일만 가져올 수 있습니다.');
  if (file.size > 10 * 1024 * 1024) throw new Error('파일 크기는 10MB 이하여야 합니다.');

  let rows: Cell[][];
  if (extension === 'csv') {
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buffer);
    if (text.includes('\uFFFD')) text = new TextDecoder('euc-kr').decode(buffer);
    rows = parseCsv(text.replace(/^\uFEFF/, ''));
  } else {
    rows = (await readSheet(file)) as Cell[][];
  }

  if (rows.length < 2) throw new Error('헤더와 한 개 이상의 측정 행이 필요합니다.');
  if (rows.length > 501) throw new Error('한 번에 최대 500개 측정만 가져올 수 있습니다.');
  const headers = rows[0].map((cell, index) => String(cell ?? `열 ${index + 1}`).trim());
  if (headers.length > 200) throw new Error('열이 200개를 초과하는 파일은 가져올 수 없습니다.');
  if (new Set(headers.map(key)).size !== headers.length) throw new Error('중복된 열 이름이 있습니다. 열 이름을 고친 뒤 다시 시도해 주세요.');
  if (!headers.some((header) => DATE_KEYS.includes(key(header)))) throw new Error('측정일 열을 찾지 못했습니다.');

  const parsed: ParsedMeasurement[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const values = rows[index];
    if (!values.some((value) => normalizeCell(value) !== null)) continue;
    const original = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? null])) as Record<string, Cell>;
    const measuredAt = dateValue(findValue(original, DATE_KEYS));
    if (!measuredAt) throw new Error(`${index + 1}행의 측정일을 읽을 수 없습니다.`);
    const weight = numeric(findValue(original, METRIC_KEYS.weight));
    const muscle = numeric(findValue(original, METRIC_KEYS.skeletal_muscle_mass));
    const fat = numeric(findValue(original, METRIC_KEYS.body_fat_percentage));
    const bmr = numeric(findValue(original, METRIC_KEYS.bmr));
    assertRange('체중', weight, 20, 400, index + 1);
    assertRange('골격근량', muscle, 3, 150, index + 1);
    assertRange('체지방률', fat, 1, 75, index + 1);
    assertRange('기초대사량', bmr, 500, 5000, index + 1);
    const rawValues = Object.fromEntries(Object.entries(original).map(([header, value]) => [header, normalizeCell(value)]));
    const sourceHash = await digest({ measuredAt, weight, muscle, fat, rawValues });
    parsed.push({
      row_number: index + 1,
      measured_at: measuredAt,
      source_hash: sourceHash,
      weight,
      skeletal_muscle_mass: muscle,
      body_fat_percentage: fat,
      bmr,
      raw_values: rawValues,
    });
  }

  if (!parsed.length) throw new Error('저장할 수 있는 측정 행이 없습니다.');
  return parsed;
}
