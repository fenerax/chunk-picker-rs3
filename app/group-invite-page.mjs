import { renderSignInPage } from './signin-page.mjs';

export function groupInvitePage({ providers, signedIn, status, playerCount }) {
  if (!signedIn) return renderSignInPage({ providers, heading: 'Join a group', message: `Group game · ${playerCount} players · invitation ${status}. Sign in to choose a character. Opening this link does not join or change a map.`, help: false });
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Join a group · Chunk Picker</title><link rel="stylesheet" href="/auth/signin.css"><script type="module" src="/group-invites.mjs"></script></head><body class="signin-page"><main class="signin-content"><p class="signin-brand">Chunk Picker <span>RS3</span></p><h1>Join a group</h1><div id="group-invite" aria-live="polite">Loading invitation…</div><p id="invite-error" role="alert"></p><p><a href="/characters">Your characters</a></p><noscript>Enable JavaScript to review and accept this invitation.</noscript></main></body></html>';
}
