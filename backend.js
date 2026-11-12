// Access to the C++ core. Two interchangeable backends return exactly the same JSON:
//   - 'server': the local Python server (python/labserver.py) through relative URLs api/config and api/serve;
//   - 'wasm'  : the same core compiled to WebAssembly (wasm/pingsim.js + pingsim.wasm), computed in the browser,
//               which lets the Service Lab run as a static site (GitHub Pages).
// The server is tried first (local use); if it does not answer, the page falls back on WebAssembly.
// `?backend=wasm` or `?backend=server` in the URL forces one of them.

let mode = null;       // 'server' | 'wasm'
let wasm = null;       // { config, serve }

async function loadWasm() {
  const { default: createPingSim } = await import('./wasm/pingsim.js');
  const m = await createPingSim();
  const config = m.cwrap('pingsim_config_json', 'number', []);
  const serve = m.cwrap('pingsim_serve_json', 'number', ['string']);
  return { config: () => JSON.parse(m.UTF8ToString(config())), serve: (q) => JSON.parse(m.UTF8ToString(serve(q))) };
}

export async function init() {
  const forced = new URLSearchParams(location.search).get('backend');
  if (forced !== 'wasm') {
    try {
      const res = await fetch('api/config');
      if (res.ok) { mode = 'server'; return { mode, config: await res.json() }; }
    } catch (e) { /* no server: fall back */ }
    if (forced === 'server') throw new Error('Serveur injoignable : lancez python/labserver.py');
  }
  wasm = await loadWasm();
  mode = 'wasm';
  return { mode, config: wasm.config() };
}

export const backendMode = () => mode;

// query: string such as "x=-1.45&speed=7&rubber=inverted_soft". Returns the parsed JSON (with server_ms).
export async function serve(query) {
  if (mode === 'wasm') return wasm.serve(query);
  const res = await fetch('api/serve?' + query);
  return res.json();
}
