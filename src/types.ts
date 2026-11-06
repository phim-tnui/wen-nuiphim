export interface CatalogItem {
  id: string;
  name: string;
  type: string;
  posterShape?: string;
  apiPath?: string;
  defaultChecked?: boolean;
  tag?: string;
  primaryKw?: string;
  secondaryKw?: string;
  keywords?: string[];
}

export interface FootballStream {
  name?: string;
  url?: string;
  behaviorHints?: {
    proxyHeaders?: {
      request?: Record<string, string>;
    };
  };
}

export interface FootballMatch {
  id: string;
  name: string;
  genre?: string;
  description?: string;
  poster?: string;
  timing?: {
    status?: 'live' | 'upcoming' | string;
    formattedTime?: string;
  };
  streams?: FootballStream[];
}

export interface FootballStats {
  live: number;
  upcoming: number;
  undated?: number;
}

export interface LiveTvChannel {
  id?: string;
  key?: string;
  name?: string;
  poster?: string;
  status?: string;
  isReachable?: boolean;
  streamUrl?: string;
  streamType?: string;
  latency?: number;
  category?: string;
  categoryName?: string;
  genre?: string;
  isClearkeyFlag?: boolean;
  kidHex?: string;
  keyHex?: string;
}

export interface LiveTvTelemetry {
  activeCount?: number;
  unstableCount?: number;
  offlineCount?: number;
  avgLatency?: number;
  lastRun?: number | string | null;
}

export interface ScrapedStream {
  id?: string;
  name?: string;
  streamUrl: string;
  streamType?: string;
  sourceUrl?: string;
  category?: string;
  latency?: number;
  isClearkeyFlag?: boolean;
  kidHex?: string;
  keyHex?: string;
}

export interface ScrapeJob {
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress?: number;
  logs?: string[];
  discoveredStreams?: ScrapedStream[];
}

export interface CrawlerState {
  isRunning: boolean;
  lastRun?: number | string | null;
  nextRun?: number | null;
  totalCaptured?: number;
  logs?: string[];
}

export interface CustomEndpoints {
  kkphim?: string;
  vsmov?: string;
  ophim?: string;
  nguonc?: string;
  xink?: string;
  customMovieApi?: string;
  customMovieApis?: string[];
}

export interface BotTelemetry {
  lastSync?: number;
  channelCount?: number;
  clearKeyCount?: number;
  status?: string;
}

export interface PreviewTarget {
  streamUrl: string;
  streamName: string;
  streamType: string;
  kidHex?: string;
  keyHex?: string;
}

export type ProTab = 'config' | 'livetv' | 'football' | 'scraper' | 'streams' | 'crawler';
export type StreamMode = 'native' | 'web';
export type FootballFilter = 'all' | 'live' | 'upcoming' | 'blv' | 'gavang' | 'xoiche' | 'cola' | 'khandai';
export type FormatFilter = 'all' | 'tv' | 'vod' | 'dash' | 'hls' | 'mp4';
export type LiveTvStatusFilter = 'all' | 'working' | 'requires_update';
export type LiveTvCategoryFilter = 'all' | 'quoc_te' | 'vtv' | 'vtvcab' | 'the_thao' | 'thieu_nhi' | 'giai_tri';
