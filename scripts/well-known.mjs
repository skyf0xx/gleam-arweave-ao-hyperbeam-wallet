// Checks that the invite-link host serves the files iOS and Android fetch
// to verify the app may open its links. Run from release-all only: the
// release workflow blocks egress to this host.

const FILES = ["apple-app-site-association", "assetlinks.json"];

/**
 * Returns a list of problems; empty means both files are served correctly.
 * Redirects count as problems because the platforms refuse to follow them.
 * The timeout keeps a dropped connection from hanging release-all.
 * @param {{ fetchImpl?: typeof fetch, host?: string }} [opts]
 * @returns {Promise<string[]>}
 */
export async function checkWellKnown({ fetchImpl = globalThis.fetch, host = "open.gleamwallet.app" } = {}) {
  const problems = [];
  for (const file of FILES) {
    const url = `https://${host}/.well-known/${file}`;
    try {
      const res = await fetchImpl(url, { redirect: "manual", signal: globalThis.AbortSignal.timeout(10_000) });
      if (res.status !== 200) {
        problems.push(`${url}: status ${res.status}, expected 200`);
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("application/json")) problems.push(`${url}: content-type "${type}", expected application/json`);
      try {
        JSON.parse(await res.text());
      } catch {
        problems.push(`${url}: body is not JSON`);
      }
    } catch (e) {
      problems.push(`${url}: ${/** @type {Error} */ (e).message}`);
    }
  }
  return problems;
}
