// When deployed, Vercel forwards /api to a backend behind a free ngrok tunnel.
// ngrok answers browser requests with a warning page instead of the API unless
// this header is present, so every /api call carries it. Locally it is ignored.
const nativeFetch = window.fetch.bind(window);

window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api')) return nativeFetch(input, init);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('ngrok-skip-browser-warning', '1');
  return nativeFetch(input, { ...init, headers });
};
