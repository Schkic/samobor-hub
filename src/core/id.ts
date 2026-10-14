/** Stabilni kratki ID: SHA-1(izvor|datum|sadržaj), prvih 16 hex znakova. */
export async function noticeId(source: string, date: string, content: string): Promise<string> {
  const data = new TextEncoder().encode(`${source}|${date}|${content}`);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(hash)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
