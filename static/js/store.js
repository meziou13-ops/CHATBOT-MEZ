/* Persistance locale (navigateur) : conversations et réglages. */

const KEY = 'gunners.v1';
const MAX_CONVERSATIONS = 50;

const isMessage = (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
const isConversation = (c) => c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages);

export function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch { /* absent, illisible ou bloqué */ }
  if (!data || typeof data !== 'object') data = {};

  const conversations = (Array.isArray(data.conversations) ? data.conversations : [])
    .filter(isConversation)
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => ({
      id: c.id,
      title: c.title.slice(0, 80),
      updatedAt: Number(c.updatedAt) || Date.now(),
      messages: c.messages.filter(isMessage).map(({ role, content }) => ({ role, content })),
    }));

  return { conversations, activeId: data.activeId, level: data.level, model: data.model };
}

export function save({ conversations, activeId, level, model }) {
  const kept = conversations.slice(0, MAX_CONVERSATIONS);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ conversations: kept, activeId, level, model }));
      return;
    } catch {
      if (kept.length <= 1) return;
      kept.pop();
    }
  }
}
