export function chromeLaunchConfiguration(profile, { extraArgs = [], port, env = process.env } = {}) {
  const configured = env.RS3_SCRATCH_CDP_PORT;
  if (configured !== undefined && (typeof configured !== 'string' || !/^89\d{2}$/.test(configured))) throw new Error('Bounded Chrome port must be 8900–8999.');
  const selected = port ?? (configured === undefined ? 0 : Number(configured));
  if (!Number.isInteger(selected) || selected !== 0 && (selected < 8900 || selected > 8999)
    || configured !== undefined && selected !== Number(configured)) throw new Error('Chrome port conflicts with the bounded scratch policy.');
  if (!Array.isArray(extraArgs) || extraArgs.some(arg => typeof arg !== 'string' || /^--(?:remote-debugging(?:-|$)|user-data-dir(?:=|$))/i.test(arg))) throw new Error('Chrome ownership flags cannot be overridden.');
  return { port: selected, args: ['--headless=new', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${selected}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--hide-scrollbars', ...extraArgs, 'about:blank'] };
}
