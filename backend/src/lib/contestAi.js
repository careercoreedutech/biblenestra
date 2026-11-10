// AI Bible quiz generator for contest organizers. Questions come back as DRAFTS: the organizer must
// review them before they are used (they are only stored when a contest is created with them).
// Uses Workers AI (binding AI) with the public-domain KJV in mind. Without AI (local dev, tests, or
// when the model fails) it falls back to the server question bank for that book, so it always helps.
import { CONTEST_BANK } from './contestBank.js';

const MODELS = ['@cf/meta/llama-3.1-8b-instruct-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];

function readText(out) {
  if (!out) return '';
  if (typeof out.response === 'string') return out.response;
  if (out.result && typeof out.result.response === 'string') return out.result.response;
  const choice = Array.isArray(out.choices) && out.choices[0] && out.choices[0].message ? out.choices[0].message.content : '';
  return typeof choice === 'string' ? choice : '';
}

function parseList(text) {
  const s = String(text || '');
  const a = s.indexOf('['); const b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  try { const v = JSON.parse(s.slice(a, b + 1)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

function clean(list, type, book) {
  const out = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const question = String(x.question || x.q || '').trim().slice(0, 400);
    let options = (x.options || x.o || []).map((o) => String(o || '').replace(/^[A-D][).:]\s*/, '').trim()).filter(Boolean).slice(0, 5);
    if (type === 'true_false') options = ['True', 'False'];
    let answer = x.answer !== undefined ? x.answer : x.correctIndex !== undefined ? x.correctIndex : x.a;
    if (typeof answer === 'string') {
      const letter = answer.trim().toUpperCase();
      if (/^[A-E]$/.test(letter)) answer = letter.charCodeAt(0) - 65;
      else if (/^(TRUE|FALSE)$/.test(letter)) answer = letter === 'TRUE' ? 0 : 1;
      else answer = options.findIndex((o) => o.toLowerCase() === answer.trim().toLowerCase());
    }
    answer = Number(answer);
    if (question.length < 8 || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    out.push({
      question, options, correctIndex: answer,
      reference: String(x.reference || x.r || book).trim().slice(0, 80),
      explanation: String(x.explanation || x.x || '').trim().slice(0, 400),
    });
  }
  return out;
}

function fromBank(book, count) {
  const name = book.toLowerCase();
  const hits = CONTEST_BANK.filter((x) => String(x.r || '').toLowerCase().startsWith(name));
  return hits.slice(0, count).map((x) => ({ question: x.q, options: x.o, correctIndex: x.a, reference: x.r, explanation: '' }));
}

export async function aiQuizQuestions(env, { book, difficulty, type, count }) {
  const kind = type === 'true_false' ? 'true-or-false statements (options exactly ["True","False"])'
    : type === 'fill_gap' ? 'fill-in-the-missing-word questions quoting a KJV verse with ____ for the missing word, with 4 options'
      : 'multiple-choice questions with 4 options';
  if (env.AI && typeof env.AI.run === 'function') {
    const prompt = `Write ${count} ${difficulty} ${kind} about the Bible book of ${book}, based on the King James Version. `
      + 'Each must be factually correct and answerable from the text. Reply with only a JSON array of objects: '
      + '{"question": string, "options": string[], "answer": index of the correct option (0-based), "reference": "Book chapter:verse", "explanation": one sentence}.';
    for (const model of MODELS) {
      try {
        const out = await env.AI.run(model, { messages: [{ role: 'system', content: 'You write accurate Bible quiz questions. Reply with JSON only.' }, { role: 'user', content: prompt }], max_tokens: 1800, temperature: 0.4 });
        const items = clean(parseList(readText(out)), type, book).slice(0, count);
        if (items.length) return { source: 'ai', model, needsReview: true, items };
      } catch (e) { console.warn('[contest ai] model failed', model, e && e.message); }
    }
  }
  const items = fromBank(book, count);
  return { source: 'bank', needsReview: true, items, note: items.length ? 'From the BibleNestra question bank' : `No ready-made questions for ${book} yet. Try another book.` };
}
