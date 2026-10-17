/* Client de l'API de chat : lit le flux SSE renvoyé par le serveur. */

export class ApiError extends Error {}

export async function streamChat({ messages, level, model, signal, onToken }) {
  let response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, level, model }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Connexion impossible. Vérifie ta connexion et réessaie.');
  }

  if (!response.ok) {
    let message = `Erreur serveur (${response.status}).`;
    try { message = (await response.json()).error || message; } catch { /* corps non JSON */ }
    throw new ApiError(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const event = JSON.parse(line.slice(5));
        if (event.t) onToken(event.t);
        else if (event.error) throw new ApiError(event.error);
        else if (event.done) finished = true;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError' || err instanceof ApiError) throw err;
    throw new ApiError('La réponse a été interrompue. Réessaie.');
  }
  if (!finished) throw new ApiError('La réponse a été interrompue. Réessaie.');
}
