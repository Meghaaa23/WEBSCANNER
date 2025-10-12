// bridge.js
// OpenAI LLM bridge (planner).
// Requires: npm i openai
// Set env: OPENAI_API_KEY, optionally OPENAI_MODEL (default gpt-4o-mini)

const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function renderActions(ap) {
  return ap.actions.map(a => {
    const label = (a.label || '').replace(/\s+/g, ' ').trim();
    if (a.kind === 'form') return `${a.id}: FORM ${label}`;
    return `${a.id}: ${a.kind.toUpperCase()} — ${label}`;
  }).join('\n');
}

module.exports = async function decide(ap, task, history = []) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const system = `
    You are a Yura browser agent that returns exactly one command per turn.
    Output MUST be one of:
      CLICK {id}
      FILL & SUBMIT FORM {id}
      STOP
    Only use ids from the provided Actions list. No extra text.
    `.trim();

  const user = `
Task: ${task}

Page: ${ap.title} (${ap.url})

Actions:
${renderActions(ap)}

Recent History: ${history.slice(-8).join(' | ')}

Return exactly one command: CLICK id, FILL & SUBMIT FORM id, or STOP.
`.trim();

  const resp = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0,
    max_tokens: 50
  });

  const text = (resp.choices?.[0]?.message?.content || '').trim().split('\n')[0].trim();
  const m = text.match(/^(CLICK|FILL & SUBMIT FORM|STOP)\s*([0-9]*)/i);
  if (!m) return 'STOP';

  const cmd = m[1].toUpperCase() + (m[2] ? ` ${m[2]}` : '');

  // Validate id if present
  if (/CLICK|FILL/i.test(cmd)) {
    const id = cmd.split(/\s+/)[1];
    const ok = ap.actions.some(a => String(a.id) === String(id));
    if (!ok) return 'STOP';
  }

  return cmd;
};
