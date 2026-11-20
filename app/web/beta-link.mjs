// Fragments never reach the HTTP request or Referer. Remove it before any
// asynchronous work, then use the same bounded preauth continuation as invites.
const secret = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const message = document.querySelector('.signin-message');
try {
  if (!/^bet_[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('This beta link is unavailable. Ask the person who invited you for a new link.');
  const result = await fetch('/auth/beta', { method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) });
  const body = await result.json();
  if (!result.ok) throw new Error(body.message || 'This beta link is unavailable. Ask for a new link.');
  location.replace('/auth/beta/signin');
} catch (error) { message.textContent = error.message; }
