import 'server-only';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// Model names live in one file, config/models.json, shared with the worker.
type Tier = 'small' | 'strong';
export type Task =
  | 'translate' | 'redact' | 'moderate_note' | 'flashcards' | 'guardrail_check' | 'detect_language'
  | 'study_answer' | 'cluster_digest' | 'syllabus_extract' | 'calendar_agent' | 'draft_answer';

type ModelsConfig = {
  small: string;
  strong: string;
  use_for: Record<Task, Tier>;
  limits: {
    ai_calls_per_user_per_day: number;
    questions_per_user_per_day: number;
    messages_per_user_per_hour: number;
    reads_per_user_per_hour: number;
    cross_course_alert_threshold: number;
    study_ai_top_chunks: number;
  };
};

let cached: ModelsConfig | null = null;

export function config(): ModelsConfig {
  if (cached) return cached;
  const candidates = ['/config/models.json', path.join(process.cwd(), '..', 'config', 'models.json')];
  const file = candidates.find((p) => existsSync(p));
  if (!file) throw new Error('config/models.json not found');
  cached = JSON.parse(readFileSync(file, 'utf8')) as ModelsConfig;
  return cached;
}

export function modelFor(task: Task): string {
  const c = config();
  return c[c.use_for[task] ?? 'small'];
}

export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'http://localhost:3300';

/** The term students are joining rooms for. Matches the label used by scripts/import_umkc.py. */
export const CURRENT_TERM = process.env.CURRENT_TERM ?? 'Fall 2026';
