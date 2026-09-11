import { config } from './config.js';

export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
  source?: string;
};

const TRUSTED_MEDICAL_DOMAINS = [
  'who.int',
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'cdc.gov',
  'nih.gov',
  'nice.org.uk',
  'escardio.org',
  'heart.org',
  'merckmanuals.com',
  'msdmanuals.com',
  'mayoclinic.org',
];

function isTrustedUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return TRUSTED_MEDICAL_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function cleanMarkdown(value: string, maxChars: number) {
  const withoutNoise = value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const heading = withoutNoise.match(/^#\s+.+$/m);
  const start = heading?.index ?? 0;
  const trimmed = withoutNoise.slice(start);
  const footerMarkers = ['## References', '## Related', '## More Information', '## Contact Us', 'Copyright'];
  let end = trimmed.length;
  for (const marker of footerMarkers) {
    const index = trimmed.indexOf(marker);
    if (index > 500) end = Math.min(end, index);
  }
  return trimmed.slice(0, Math.min(end, maxChars)).trim();
}

async function firecrawl(path: string, body: unknown) {
  if (!config.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.FIRECRAWL_SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.firecrawl.dev${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.FIRECRAWL_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Firecrawl ${response.status}: ${raw.slice(0, 400)}`);
    return JSON.parse(raw) as Record<string, any>;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchMedicalWeb(query: string, limit = config.FIRECRAWL_SEARCH_LIMIT) {
  if (config.WEB_SEARCH_PROVIDER !== 'firecrawl' || !config.FIRECRAWL_API_KEY) return [];
  const data = await firecrawl('/v2/search', {
    query: `${query} medical clinical guideline review`,
    limit: Math.min(Math.max(limit, 1), 10),
  });
  const results = Array.isArray(data.data?.web) ? data.data.web : [];
  return results
    .filter((item: any) => typeof item?.url === 'string' && isTrustedUrl(item.url))
    .map((item: any) => ({
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : item.url,
      url: item.url,
      content: typeof item.description === 'string' ? item.description.trim() : '',
    }));
}

export async function scrapeMedicalPage(url: string, maxChars = 12_000): Promise<WebSearchResult | null> {
  if (!isTrustedUrl(url) || config.WEB_SEARCH_PROVIDER !== 'firecrawl' || !config.FIRECRAWL_API_KEY) return null;
  const data = await firecrawl('/v2/scrape', { url, formats: ['markdown'] });
  const markdown = typeof data.data?.markdown === 'string' ? data.data.markdown : '';
  const content = cleanMarkdown(markdown, maxChars);
  if (!content) return null;
  return { title: url, url, content, source: new URL(url).hostname.replace(/^www\./, '') };
}

export async function searchMedicalSources(query: string, _unused?: unknown, limit = 3) {
  const candidates = await searchMedicalWeb(query, Math.max(limit, config.FIRECRAWL_SEARCH_LIMIT));
  const selected = candidates.slice(0, limit);
  const scraped = await Promise.all(selected.map((item) => scrapeMedicalPage(item.url).catch(() => null)));
  return scraped
    .map((item, index) => item ? { ...item, title: selected[index]?.title || item.title } : null)
    .filter((item): item is WebSearchResult => Boolean(item));
}
