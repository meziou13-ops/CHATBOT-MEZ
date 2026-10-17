/* Interface Gunners IA : état, rendu et événements. */
import { ApiError, streamChat } from './api.js';
import { createCannon, createToast } from './cannon.js';
import { renderMarkdown } from './markdown.js';
import * as store from './store.js';

const LEVEL_HINTS = {
  poli: 'Ton sage, piques légères. Je me retiens.',
  hautain: 'Ton par défaut : condescendant, mais précis.',
  sans_pitie: 'Aucun filtre. Ton ego est en danger.',
};
const MODELS = {
  'openai/gpt-oss-20b': { name: 'gpt-oss-20b', tag: 'Rapide' },
  'openai/gpt-oss-120b': { name: 'gpt-oss-120b', tag: 'Puissant' },
};
const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_LEVEL = 'hautain';
const HISTORY_SENT = 30;

const ICONS = {
  chat: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  regen: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 6M20 5v6h-6"/></svg>',
};

const $ = (id) => document.getElementById(id);
const dom = {
  app: $('app'), sidebar: $('sidebar'), backdrop: $('backdrop'), menuBtn: $('menu-btn'),
  gunSide: $('gun-side'), gunTop: $('gun-top'), brandSub: $('brand-sub'),
  newChat: $('new-chat'), search: $('search'), history: $('history'),
  levels: $('levels'), levelHint: $('level-hint'), clearAll: $('clear-all'), clearLabel: $('clear-label'),
  status: $('status'), statusText: $('status-text'),
  modelBtn: $('model-btn'), modelMenu: $('model-menu'), modelName: $('model-name'), modelTag: $('model-tag'),
  home: $('home'), thread: $('thread'), threadInner: $('thread-inner'),
  composer: $('composer'), input: $('input'), send: $('send'), stop: $('stop'),
  orb: document.querySelector('.orb'), orbWrap: $('orb-wrap'), fx: $('fx'), toast: $('toast'),
};

const saved = store.load();
const state = {
  conversations: saved.conversations,
  activeId: saved.conversations.some((c) => c.id === saved.activeId) ? saved.activeId : null,
  level: Object.hasOwn(LEVEL_HINTS, saved.level) ? saved.level : DEFAULT_LEVEL,
  model: Object.hasOwn(MODELS, saved.model) ? saved.model : DEFAULT_MODEL,
  query: '',
  streaming: false,
  controller: null,
  error: null,
  shots: 0,
  stick: true,
};

const toast = createToast(dom.toast);
const fire = createCannon({
  layer: dom.fx, orb: dom.orb, orbWrap: dom.orbWrap, toast,
  onFire: (count) => { state.shots = count; renderBrand(); renderStatus(); },
});

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'icon') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((c) => c != null));
  return node;
}

const activeConversation = () => state.conversations.find((c) => c.id === state.activeId) ?? null;
const persist = () => store.save(state);
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const makeTitle = (text) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 42 ? `${flat.slice(0, 42)}…` : flat;
};

/* ---------- Rendu ---------- */

function renderBrand() {
  dom.brandSub.textContent = state.shots ? `BOULETS TIRÉS · ${state.shots}` : 'SANCTUAIRE · V1';
}

function renderStatus() {
  dom.status.classList.toggle('busy', state.streaming);
  dom.statusText.textContent = state.streaming
    ? 'GUNNERS IA RÉFLÉCHIT…'
    : `EN LIGNE · DOMINATION MONDIALE ${Math.min(99, 12 + state.shots)} %`;
}

function renderSettings() {
  for (const button of dom.levels.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.level === state.level));
  }
  dom.levelHint.textContent = LEVEL_HINTS[state.level];
  const model = MODELS[state.model];
  dom.modelName.textContent = model.name;
  dom.modelTag.textContent = model.tag;
  for (const item of dom.modelMenu.children) {
    item.setAttribute('aria-checked', String(item.dataset.model === state.model));
  }
}

function groupLabel(timestamp) {
  const day = (t) => new Date(t).setHours(0, 0, 0, 0);
  const diff = Math.round((day(Date.now()) - day(timestamp)) / 86_400_000);
  if (diff <= 0) return "AUJOURD'HUI";
  return diff === 1 ? 'HIER' : 'PLUS ANCIEN';
}

function renderHistory() {
  const query = state.query.trim().toLowerCase();
  const matches = state.conversations
    .filter((c) => !query || c.title.toLowerCase().includes(query) || c.messages.some((m) => m.content.toLowerCase().includes(query)))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  dom.history.replaceChildren();
  if (!matches.length) {
    dom.history.append(h('p', { class: 'empty' }, query ? 'Rien trouvé. Même moi, je ne peux rien inventer.' : 'Aucune conversation. Pose ta première question.'));
    return;
  }
  let lastGroup = '';
  for (const conv of matches) {
    const group = groupLabel(conv.updatedAt);
    if (group !== lastGroup) {
      dom.history.append(h('span', { class: 'label hist-label' }, group));
      lastGroup = group;
    }
    const current = conv.id === state.activeId;
    dom.history.append(h('div', { class: 'hist-row' },
      h('button', { type: 'button', class: 'hist', ...(current ? { 'aria-current': 'true' } : {}), onclick: () => openConversation(conv.id) },
        h('span', { class: 'hist-ico', icon: ICONS.chat }),
        h('span', { class: 'hist-title' }, conv.title)),
      h('button', { type: 'button', class: 'hist-del', 'aria-label': `Supprimer « ${conv.title} »`, icon: ICONS.close, onclick: () => deleteConversation(conv.id) })));
  }
}

function botMessage(content, { last, streaming }) {
  const md = h('div', { class: 'md' });
  md.innerHTML = renderMarkdown(content);
  const actions = h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'act', 'aria-label': 'Copier la réponse', icon: ICONS.copy, onclick: () => copyText(content) }),
    last ? h('button', { type: 'button', class: 'act', 'aria-label': 'Régénérer la réponse', icon: ICONS.regen, onclick: regenerate }) : null);
  return h('div', { class: `msg bot${streaming ? ' streaming' : ''}` },
    h('span', { class: 'avatar' }, h('img', { src: '/static/img/logo-canon.jpg', alt: '', width: '34', height: '34' })),
    h('div', { class: 'card-msg' }, h('div', { class: 'who' }, 'Gunners IA —'), md, actions));
}

function renderThread() {
  const conv = activeConversation();
  dom.threadInner.replaceChildren();
  if (!conv) return;
  const count = conv.messages.length;
  conv.messages.forEach((message, index) => {
    if (message.role === 'user') {
      const bubble = h('div', { class: 'bubble' });
      bubble.textContent = message.content;
      dom.threadInner.append(h('div', { class: 'msg user' }, bubble));
    } else {
      const last = index === count - 1;
      dom.threadInner.append(botMessage(message.content, { last: last && !state.streaming, streaming: last && state.streaming }));
    }
  });
  if (state.error) {
    dom.threadInner.append(h('div', { class: 'errbar', role: 'alert' },
      h('span', {}, state.error),
      h('button', { type: 'button', class: 'retry', onclick: regenerate }, 'Réessayer')));
  } else if (!state.streaming && conv.messages.at(-1)?.role === 'user') {
    dom.threadInner.append(h('div', { class: 'errbar' },
      h('span', {}, 'Aucune réponse pour ce message.'),
      h('button', { type: 'button', class: 'retry', onclick: regenerate }, 'Relancer')));
  }
  dom.thread.setAttribute('aria-busy', String(state.streaming));
  scrollToEnd(true);
}

function renderComposer() {
  dom.send.hidden = state.streaming;
  dom.stop.hidden = !state.streaming;
  dom.send.disabled = !dom.input.value.trim();
}

function renderAll() {
  dom.app.dataset.view = activeConversation() ? 'chat' : 'home';
  renderBrand();
  renderStatus();
  renderSettings();
  renderHistory();
  renderThread();
  renderComposer();
}

function scrollToEnd(force = false) {
  if (force) state.stick = true;
  if (state.stick) dom.thread.scrollTop = dom.thread.scrollHeight;
}

function autosize() {
  dom.input.style.height = 'auto';
  dom.input.style.height = `${Math.min(dom.input.scrollHeight, 160)}px`;
}

/* ---------- Conversation ---------- */

async function complete(conversation) {
  const reply = { role: 'assistant', content: '' };
  conversation.messages.push(reply);
  state.streaming = true;
  state.error = null;
  state.controller = new AbortController();
  renderAll();

  const target = dom.threadInner.querySelector('.msg.bot:last-child .md');
  const history = conversation.messages.slice(0, -1).slice(-HISTORY_SENT).map(({ role, content }) => ({ role, content }));
  let scheduled = false;
  const paint = () => {
    scheduled = false;
    if (!target?.isConnected) return;
    target.innerHTML = renderMarkdown(reply.content);
    scrollToEnd();
  };

  try {
    await streamChat({
      messages: history, level: state.level, model: state.model, signal: state.controller.signal,
      onToken: (text) => {
        reply.content += text;
        if (!scheduled) { scheduled = true; requestAnimationFrame(paint); }
      },
    });
  } catch (err) {
    if (err.name !== 'AbortError') state.error = err instanceof ApiError ? err.message : 'Erreur inattendue. Réessaie.';
  } finally {
    state.streaming = false;
    state.controller = null;
    if (!reply.content.trim()) conversation.messages.splice(conversation.messages.indexOf(reply), 1);
    conversation.updatedAt = Date.now();
    persist();
    renderAll();
    focusInput();
  }
}

async function send(text) {
  const content = text.trim();
  if (!content || state.streaming) return;
  let conversation = activeConversation();
  if (!conversation) {
    conversation = { id: newId(), title: makeTitle(content), updatedAt: Date.now(), messages: [] };
    state.conversations.unshift(conversation);
    state.activeId = conversation.id;
  }
  conversation.messages.push({ role: 'user', content });
  dom.input.value = '';
  autosize();
  closeDrawer();
  await complete(conversation);
}

function regenerate() {
  const conversation = activeConversation();
  if (!conversation || state.streaming) return;
  while (conversation.messages.at(-1)?.role === 'assistant') conversation.messages.pop();
  if (!conversation.messages.length) return;
  complete(conversation);
}

function abortStream() {
  state.controller?.abort();
}

function openConversation(id) {
  abortStream();
  state.activeId = id;
  state.error = null;
  persist();
  renderAll();
  closeDrawer();
}

function startNewChat() {
  abortStream();
  state.activeId = null;
  state.error = null;
  persist();
  renderAll();
  closeDrawer();
  focusInput();
}

function deleteConversation(id) {
  if (id === state.activeId) abortStream();
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.activeId === id) state.activeId = null;
  persist();
  renderAll();
}

let clearTimer = null;
function clearEverything() {
  if (!clearTimer) {
    dom.clearLabel.textContent = 'Confirmer l\'effacement ?';
    dom.clearAll.classList.add('confirm');
    clearTimer = setTimeout(resetClearButton, 3000);
    return;
  }
  resetClearButton();
  abortStream();
  state.conversations = [];
  state.activeId = null;
  state.error = null;
  persist();
  renderAll();
}

function resetClearButton() {
  clearTimeout(clearTimer);
  clearTimer = null;
  dom.clearLabel.textContent = "Effacer tout l'historique";
  dom.clearAll.classList.remove('confirm');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copié.');
  } catch {
    toast('Copie impossible.');
  }
}

function focusInput() {
  if (window.matchMedia('(pointer: fine)').matches) dom.input.focus();
}

/* ---------- Menus ---------- */

function openDrawer() {
  dom.app.classList.add('nav-open');
  dom.menuBtn.setAttribute('aria-expanded', 'true');
  dom.newChat.focus();
}

function closeDrawer() {
  if (!dom.app.classList.contains('nav-open')) return;
  dom.app.classList.remove('nav-open');
  dom.menuBtn.setAttribute('aria-expanded', 'false');
}

function setModelMenu(open) {
  dom.modelMenu.hidden = !open;
  dom.modelBtn.setAttribute('aria-expanded', String(open));
}

function buildModelMenu() {
  for (const [id, model] of Object.entries(MODELS)) {
    dom.modelMenu.append(h('button', {
      type: 'button', role: 'menuitemradio', 'data-model': id, 'aria-checked': 'false',
      onclick: () => { state.model = id; persist(); renderSettings(); setModelMenu(false); dom.modelBtn.focus(); },
    }, h('span', { class: 'n' }, model.name), h('span', { class: 't' }, model.tag)));
  }
}

/* ---------- Événements ---------- */

dom.composer.addEventListener('submit', (event) => { event.preventDefault(); send(dom.input.value); });
dom.input.addEventListener('input', () => { autosize(); renderComposer(); });
dom.input.addEventListener('keydown', (event) => {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !touch) {
    event.preventDefault();
    send(dom.input.value);
  }
});
dom.stop.addEventListener('click', abortStream);

dom.thread.addEventListener('scroll', () => {
  state.stick = dom.thread.scrollHeight - dom.thread.scrollTop - dom.thread.clientHeight < 80;
});
dom.threadInner.addEventListener('click', async (event) => {
  const button = event.target.closest('.code-copy');
  if (!button) return;
  await copyText(button.closest('.code').querySelector('code').textContent);
  button.textContent = 'Copié';
  setTimeout(() => { button.textContent = 'Copier'; }, 1500);
});

for (const card of document.querySelectorAll('.card')) {
  card.addEventListener('click', () => send(card.dataset.prompt));
}
dom.newChat.addEventListener('click', startNewChat);
dom.search.addEventListener('input', () => { state.query = dom.search.value; renderHistory(); });
dom.clearAll.addEventListener('click', clearEverything);
dom.levels.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-level]');
  if (!button) return;
  state.level = button.dataset.level;
  persist();
  renderSettings();
});

dom.gunSide.addEventListener('click', () => fire(dom.gunSide));
dom.gunTop.addEventListener('click', () => fire(dom.gunTop));
dom.menuBtn.addEventListener('click', () => (dom.app.classList.contains('nav-open') ? closeDrawer() : openDrawer()));
dom.backdrop.addEventListener('click', closeDrawer);

dom.modelBtn.addEventListener('click', () => setModelMenu(dom.modelMenu.hidden));
document.addEventListener('click', (event) => {
  if (!dom.modelMenu.hidden && !event.target.closest('.model')) setModelMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!dom.modelMenu.hidden) { setModelMenu(false); dom.modelBtn.focus(); }
  else if (dom.app.classList.contains('nav-open')) { closeDrawer(); dom.menuBtn.focus(); }
});

buildModelMenu();
renderAll();
focusInput();
