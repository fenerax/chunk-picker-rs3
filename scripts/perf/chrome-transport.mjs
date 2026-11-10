import { request as httpRequest } from 'node:http';

const aborted = () => Object.assign(new Error('Outer browser-file hang guard fired.'), { name: 'AbortError' });

// Node's WebSocket default dispatcher has a connection deadline. Keep its
// framing/parser, but acknowledge the loopback HTTP upgrade without that timer.
export function acknowledgedUpgrade({ request = httpRequest } = {}) {
  return { dispatch(options, handler) {
    const headers = Array.isArray(options.headers) ? options.headers : Object.entries(options.headers ?? {}).flat();
    const req = request(new URL(options.path, options.origin), { method: options.method, agent: false, timeout: 0,
      headers: [...headers, 'Connection', 'Upgrade', 'Upgrade', 'websocket'] });
    req.once('error', error => handler.onError(error));
    req.once('response', response => {
      response.resume();
      handler.onError(new Error(`Owned CDP upgrade returned HTTP ${response.statusCode}.`));
    });
    req.once('upgrade', (response, socket, head) => {
      if (head.length) socket.unshift(head);
      handler.onUpgrade(response.statusCode, response.rawHeaders, socket);
    });
    handler.onConnect(reason => req.destroy(reason instanceof Error ? reason : undefined), null);
    req.end();
    return true;
  } };
}

// A transport acknowledgement has no deadline. Only the owning file may abort.
export function acknowledgedConnection(socket, { signal } = {}) {
  let sequence = 0, stopped;
  const pending = new Map(), listeners = new Set();
  const stop = error => {
    stopped = error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  const abort = () => { stop(aborted()); socket.close(); };
  signal?.addEventListener('abort', abort, { once: true });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      message.error ? entry.reject(new Error(`CDP ${entry.method}: ${message.error.message}`)) : entry.resolve(message.result);
    } else for (const listener of listeners) listener(message);
  });
  socket.addEventListener('close', () => { signal?.removeEventListener('abort', abort); stop(new Error('Owned CDP socket closed.')); });
  socket.addEventListener('error', () => stop(new Error('Owned CDP socket failed.')));
  return { listeners, pending: () => [...pending.values()].map(({ method, sessionId }) => ({ method, sessionId })),
    send(method, params = {}, sessionId) {
      if (signal?.aborted || stopped) return Promise.reject(stopped ?? aborted());
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject, method, sessionId });
        try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
        catch (error) { pending.delete(id); reject(error); }
      });
    }, close() {
      signal?.removeEventListener('abort', abort);
      stop(new Error('Owned CDP socket closed.'));
      socket.close();
    } };
}

export function chromeEndpoint(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const done = (error, value) => {
      child.stderr.removeListener('data', data); child.removeListener('exit', exit); child.removeListener('error', fail);
      error ? reject(error) : resolve(value);
    };
    const exit = (code, signal) => done(new Error(`Owned Chrome exited before readiness (${code ?? signal}). ${output}`));
    const fail = error => done(error);
    const data = chunk => {
      output = (output + chunk.toString()).slice(-8192);
      const endpoint = output.match(/DevTools listening on ([^\r\n]+)\r?\n/)?.[1];
      if (!endpoint) return;
      let url;
      try { url = new URL(endpoint); }
      catch { return done(new Error('Malformed owned Chrome endpoint.')); }
      if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !/^\/devtools\/browser\//.test(url.pathname)
        || url.username || url.password || url.search || url.hash || Number(url.port) < 1024
        || [8788, 8789, 8790, 8791].includes(Number(url.port))) return done(new Error('Unsafe owned Chrome endpoint.'));
      done(null, endpoint);
    };
    child.stderr.on('data', data); child.once('exit', exit); child.once('error', fail);
    if (child.exitCode !== null || child.signalCode !== null) exit(child.exitCode, child.signalCode);
  });
}
