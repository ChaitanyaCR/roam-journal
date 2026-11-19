const encoder = new TextEncoder();

async function signingKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function pinFromResult(result) {
  const { formatted: label, lat, lon: lng, place_id: id, datasource } = result;
  if (typeof label !== "string" || !label.trim() || label.length > 500 ||
      typeof id !== "string" || !id || id.length > 1024 ||
      !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  return { label, lat, lng, id, provider: "geoapify",
    attribution: datasource?.attribution || datasource?.sourcename || "Geoapify",
    sourceUrl: /^https?:\/\//i.test(datasource?.url ?? "") ? datasource.url : "",
    license: datasource?.license ?? "" };
}

export async function searchPlaces(request, secret, owner) {
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 200) return { status: 400, message: "Enter a place name between 2 and 200 characters." };
  if (!secret) return { status: 503, message: "Online search needs a Geoapify API key. The journal’s local suggestions are available." };
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.search = new URLSearchParams({ text: query, limit: "5", format: "json", lang: "en", bias: "countrycode:none", apiKey: secret });
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error();
    const { results } = await response.json();
    const key = await signingKey(secret);
    const places = [];
    for (const result of results.slice(0, 5)) {
      const pin = pinFromResult(result);
      if (!pin) continue;
      const bytes = encoder.encode(JSON.stringify([owner, pin]));
      const signature = await crypto.subtle.sign("HMAC", key, bytes);
      places.push({ pin, proof: btoa(String.fromCharCode(...new Uint8Array(signature))) });
    }
    return { places };
  } catch {
    return { status: 503, message: "Online place search is unavailable. Try again or use a local suggestion." };
  }
}

export async function verifyPlace(raw, secret, owner, label) {
  if (!secret || raw.length > 8192) return null;
  try {
    const { pin, proof } = JSON.parse(raw);
    if (pin.label !== label) return null;
    const signature = Uint8Array.from(atob(proof), c => c.charCodeAt(0));
    const verified = await crypto.subtle.verify("HMAC", await signingKey(secret), signature, encoder.encode(JSON.stringify([owner, pin])));
    return verified ? pin : null;
  } catch { return null; }
}
