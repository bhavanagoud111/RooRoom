import 'server-only';
import { sha256 } from './auth';
import { anonymous } from './db';
import { llm, llmJson } from './llm';
import { languageName } from './languages';
import { maskMath, unmaskMath } from './markdown';
import { DATA_RULE, untrusted, type Source } from './untrusted';

// One shared translate(text, target_language). Class-visible content is cached by a hash of the
// text and the target language, so an announcement is translated once per language, not once
// per student. Private content (chat, notes) is never written to the cache.

export async function translate(text: string, target: string,
  opts: { cache?: boolean; source?: Source } = {}): Promise<string> {
  const clean = text.trim();
  if (!clean) return text;
  const cache = opts.cache ?? false;
  const key = sha256(clean);
  if (cache) {
    const hit = await anonymous((db) => db.query('SELECT translation_get($1, $2) AS t', [key, target]));
    if (hit.rows[0]?.t) return hit.rows[0].t;
  }
  const { masked, math } = maskMath(clean);
  const r = await llm({
    task: 'translate',
    temperature: 0,
    maxTokens: Math.min(4000, Math.ceil(clean.length / 2) + 300),
    messages: [
      {
        role: 'system',
        content:
          `Translate the text in the <untrusted> tag into ${languageName(target)}. ` +
          // Without the next sentence the model sometimes left text with a [[M0]] math marker untranslated (2026-11-11).
          'Translate every sentence; [[M0]]-style markers stand for math formulas and must be copied exactly, but the words around them must be translated. ' +
          'Keep technical terms, code, numbers, course codes, markdown formatting, citation markers like [2], markers like [[F1]] or [[M0]] exactly as they are, and keep the order of headings and paragraphs. ' +
          `Only if the text is already written in ${languageName(target)}, return it unchanged. Output only the translation, with no notes. ` +
          DATA_RULE,
      },
      { role: 'user', content: untrusted(opts.source ?? 'student_message', masked) },
    ],
  });
  const out = unmaskMath(r.content.trim(), math);
  if (cache && out) {
    await anonymous((db) => db.query('SELECT translation_put($1, $2, $3)', [key, target, out]));
  }
  return out || text;
}

/** Detects the language and returns an English version in one cheap call. */
export async function toEnglish(text: string, source: Source): Promise<{ lang: string; english: string }> {
  // No "looks like English" shortcut: students often mix languages in English letters
  // ("deadline ni extend cheyagalara?"), which a word check mistakes for English (2026-11-11).
  // Only questions, notes and professor answers come through here, so one small call each is fine.
  const r = await llmJson<{ lang: string; english: string }>(
    'translate',
    'Detect the language of the text in the <untrusted> tag and translate it into natural English. ' +
      'The text may mix languages, for example Telugu or Hindi written in English letters with English words in between ' +
      '("naaku slow start artham kaaledu"). Translate the whole meaning into English; if it is already fully English, return it unchanged. ' +
      'For mixed text, "lang" is the main non-English language. ' +
      'Return JSON {"lang": "<ISO 639-1 code>", "english": "<English translation>"}. ' +
      'Keep technical terms and numbers exactly. ' + DATA_RULE,
    untrusted(source, text),
    1500,
  );
  return { lang: (r.lang || 'en').slice(0, 5).toLowerCase(), english: r.english || text };
}
