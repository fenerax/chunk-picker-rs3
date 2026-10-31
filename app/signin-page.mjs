const providerNames = { discord: 'Discord', google: 'Google' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// A server-rendered form in the picker's established warm charcoal and gold palette.
// Provider destinations are fixed locally; no provider scripts, images or fonts load here.
export function renderSignInPage({ providers = [], heading = 'Sign in', message, continueInvite = false, claim = false, help = true, home = false } = {}) {
  const available = [...new Set(providers.map(provider => typeof provider === 'string' ? provider : provider?.id ?? provider?.provider))].filter(provider => Object.hasOwn(providerNames, provider));
  const links = available.map(provider => `<a class="signin-provider" href="/auth/${provider}">Sign in with ${providerNames[provider]}</a>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="referrer" content="no-referrer">
  <title>${escape(heading)} · Chunk Picker RS3</title>
  <link rel="stylesheet" href="/auth/signin.css">
</head>
<body class="signin-page">
  <main class="signin-content" aria-labelledby="signin-title">
    <p class="signin-brand">Chunk Picker <span>RS3</span></p>
    <h1 id="signin-title">${escape(heading)}</h1>
    ${message ? `<p class="signin-message" role="status">${escape(message)}</p>` : ''}
    ${home ? '<a class="signin-provider" href="/">Open your picker</a>' : ''}${links ? `<div class="signin-providers" aria-label="Sign-in providers">${links}</div>` : ''}
    ${claim ? '<form class="signin-claim" method="post" action="/auth/claim"><button type="submit">Use this invitation with this account</button></form>' : ''}
    ${continueInvite ? '<form class="signin-invite" method="post" action="/auth/invite"><button type="submit">Continue with invite link</button></form>' : ''}
    ${help && !links && !claim && !continueInvite ? '<p class="signin-help">No sign-in providers are available. Contact the picker administrator for access.</p>' : ''}
    <p class="signin-help">Use the invitation shared with you to access this picker.</p>
  </main>
</body>
</html>`;
}
