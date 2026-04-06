/**
 * Navigation Client - TypeScript SDK for web browsing
 * Frontend SDK pour appels API navigation (Playwright backend)
 */

export interface BrowseOptions {
  url: string;
  width?: number;
  height?: number;
  screenshot?: boolean;
  content?: boolean;
  text?: boolean;
  accessibility?: boolean;
  metadata?: boolean;
  links?: boolean;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  waitForSelector?: string;
  timeout?: number;
}

export interface BrowseResult {
  url: string;
  title: string;
  timestamp: number;
  screenshot?: string; // base64
  content?: string; // HTML
  text?: string; // plain text
  accessibility?: any; // accessibility tree
  metadata?: {
    title?: string;
    description?: string;
    image?: string;
    author?: string;
    keywords?: string;
    canonical?: string;
    lang?: string;
  };
  links?: Array<{ href: string; text: string }>;
  cached?: boolean;
}

export interface CacheStats {
  size: number;
  oldest: number | null;
  newest: number | null;
  ttl: number;
}

export class NavigationClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:3000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}/api/browse${endpoint}`;
    const options: RequestInit = {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async health(): Promise<{ ok: boolean; available: boolean; engine: string; cache_size: number }> {
    return this.request('/health');
  }

  async browse(options: BrowseOptions): Promise<BrowseResult> {
    return this.request('', options);
  }

  async screenshot(url: string, fullPage: boolean = false, width: number = 1920, height: number = 1080): Promise<Blob> {
    const apiUrl = `${this.baseUrl}/api/browse/screenshot`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, fullPage, width, height })
    });

    if (!response.ok) {
      throw new Error(`Screenshot failed: ${response.status}`);
    }

    return response.blob();
  }

  async extractText(url: string): Promise<{ url: string; title: string; text: string; length: number }> {
    return this.request('/text', { url });
  }

  async clearCache(): Promise<{ success: boolean; cleared: number }> {
    return this.request('/cache/clear', {});
  }

  async getCacheStats(): Promise<CacheStats> {
    return this.request('/cache/stats');
  }
}

// Singleton instance
let clientInstance: NavigationClient | null = null;

export function getNavigationClient(baseUrl?: string): NavigationClient {
  if (!clientInstance || baseUrl) {
    clientInstance = new NavigationClient(baseUrl);
  }
  return clientInstance;
}

// Helper functions for common operations
export async function browseUrl(
  url: string,
  options: Partial<BrowseOptions> = {}
): Promise<BrowseResult> {
  const client = getNavigationClient();
  return client.browse({ url, ...options });
}

export async function getPageText(url: string): Promise<string> {
  const client = getNavigationClient();
  const result = await client.extractText(url);
  return result.text;
}

export async function getPageScreenshot(url: string, fullPage: boolean = false): Promise<string> {
  const client = getNavigationClient();
  const blob = await client.screenshot(url, fullPage);
  
  // Convert blob to base64
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function getPageMetadata(url: string): Promise<BrowseResult['metadata']> {
  const client = getNavigationClient();
  const result = await client.browse({
    url,
    screenshot: false,
    content: false,
    text: false,
    metadata: true
  });
  return result.metadata;
}

export async function getPageLinks(url: string): Promise<Array<{ href: string; text: string }>> {
  const client = getNavigationClient();
  const result = await client.browse({
    url,
    screenshot: false,
    content: false,
    text: false,
    links: true
  });
  return result.links || [];
}

/**
 * Get full page context for AI (text + metadata + links)
 */
export async function getPageContext(url: string): Promise<{
  url: string;
  title: string;
  text: string;
  metadata?: BrowseResult['metadata'];
  links?: Array<{ href: string; text: string }>;
}> {
  const client = getNavigationClient();
  const result = await client.browse({
    url,
    screenshot: false,
    content: false,
    text: true,
    metadata: true,
    links: true
  });

  return {
    url: result.url,
    title: result.title,
    text: result.text || '',
    metadata: result.metadata,
    links: result.links
  };
}

/**
 * Format page context as markdown for AI consumption
 */
export function formatPageContextForAI(context: BrowseResult): string {
  let markdown = `# ${context.title}\n\n`;
  markdown += `**URL:** ${context.url}\n\n`;

  if (context.metadata?.description) {
    markdown += `**Description:** ${context.metadata.description}\n\n`;
  }

  if (context.text) {
    markdown += `## Content\n\n${context.text.substring(0, 10000)}\n\n`;
  }

  if (context.links && context.links.length > 0) {
    markdown += `## Links (${context.links.length})\n\n`;
    context.links.slice(0, 20).forEach(link => {
      markdown += `- [${link.text || 'Link'}](${link.href})\n`;
    });
  }

  return markdown;
}
