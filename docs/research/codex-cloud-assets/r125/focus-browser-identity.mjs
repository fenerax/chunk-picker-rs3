// Exact identity of the independently pinned image's official Chrome for Testing.
// Observed V2 output SHA256 also fixes the trailing space and LF; never trim output.
export const PINNED_BROWSER = Object.freeze({
  image: 'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac',
  executable: '/ms-playwright/chromium-1234/chrome-linux64/chrome',
  playwright: '1.62.1', revision: '1234', version: '151.0.7922.34',
  output: 'Google Chrome for Testing 151.0.7922.34 \n',
  outputSha256: '2d44e8c7507ca1c7cefc2fff277ee234d5d87be645dd56bee1b3ffca6564e529',
});
export function pinnedBrowserIdentity(context, outcome) {
  return context?.image === PINNED_BROWSER.image && context.executable === PINNED_BROWSER.executable
    && context.playwright === PINNED_BROWSER.playwright && context.revision === PINNED_BROWSER.revision
    && context.version === PINNED_BROWSER.version && outcome?.code === 0 && outcome.signal === null
    && outcome.raw === PINNED_BROWSER.output;
}
