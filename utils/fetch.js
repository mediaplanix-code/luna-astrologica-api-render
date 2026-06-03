async function safeFetchJson(url, options = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`HTTP ${response.status} from ${url}`);
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.warn(`Non-JSON response from ${url}: ${contentType}`);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.warn(`Fetch error for ${url}:`, err.message);
    return null;
  }
}

module.exports = { safeFetchJson };
