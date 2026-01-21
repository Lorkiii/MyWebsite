// api-fetch.js (project root)
// JWT Cookie-based API helper - no Firebase tokens needed!

export async function apiFetch(path, opts = {}) {
  // Set headers (don't add Authorization - cookie handles auth automatically)
  const headers = opts.headers ? { ...opts.headers } : {};
  if (!headers["Content-Type"] && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  
  // Simple fix: If in development (localhost:5500), prepend API server URL
  let url = path;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // Development: Add the API server base URL if path is relative
    if (!path.startsWith('http')) {
      url = 'http://localhost:3000' + path;
    }
  }
  
  // Make request with credentials to send cookie
  const res = await fetch(url, { credentials: "include", ...opts, headers });
  const text = await res.text().catch(() => "");
  
  if (!res.ok) {
    // Handle session expiry
    if (res.status === 401 || res.status === 403) {
      // Session expired or unauthorized
      alert('⏰ Your session has expired. Please log in again.');
      window.location.href = '/login/login.html';
      return;
    }
    
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    const msg = parsed && (parsed.error || parsed.message) ? (parsed.error || parsed.message) : (text || res.statusText);
    const err = new Error(`Request failed ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = parsed || text;
    throw err;
  }
  
  try { return JSON.parse(text); } catch (e) { return text; }
}
