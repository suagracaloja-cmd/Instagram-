export type PostType = 'video' | 'image' | 'carousel' | 'unknown';

export interface MonitoredProfile {
  handle: string;
  url?: string;
  addedAt?: string;
}

export interface Account {
  handle: string;
  fullName?: string;
  biography?: string;
  followers?: number | null;
  following?: number | null;
  postsCount?: number | null;
  verified?: boolean;
  isPrivate?: boolean;
  isBusiness?: boolean;
  status: 'ok' | 'error' | 'private';
  error: string | null;
  lastCollectedAt?: string;
  lastAttemptAt?: string;
  baseline?: { average: number | null; posts: number };
}

export interface Snapshot {
  date: string; // YYYY-MM-DD (fuso de São Paulo)
  handle: string;
  followers: number;
  following: number | null;
  postsCount: number | null;
  avgEngagement: number | null;
  postsConsidered: number;
  collectedAt: string;
}

export interface FlaggedPost {
  shortCode: string;
  handle: string;
  url: string;
  type: PostType;
  caption: string;
  timestamp: string | null;
  likes: number | null;
  comments: number | null;
  followersAtFlag: number;
  engagement: number;
  baseline: number;
  baselinePosts: number;
  multiple: number;
  multipleNow?: number;
  flaggedAt: string;
  transcript: string | null;
  transcriptStatus: 'pending' | 'ok' | 'no_speech' | 'unavailable' | 'not_applicable';
  transcriptNote: string | null;
  transcriptLanguage?: string | null;
  analysis: string | null;
  analysisStatus: 'pending' | 'ok' | 'unavailable' | 'refused' | 'error';
  analysisNote: string | null;
  analysisBasis: 'caption' | 'transcript+caption' | null;
}

export interface RunProfileResult {
  handle: string;
  status: 'ok' | 'private' | 'error';
  error?: string | null;
  posts: number;
  newFlags: number;
}

export interface Run {
  startedAt: string;
  finishedAt: string;
  date: string;
  status: 'ok' | 'partial' | 'failed';
  profiles: RunProfileResult[];
}

export interface Meta {
  lastRun: Run | null;
  runs: Run[];
}

export interface AppData {
  profiles: MonitoredProfile[];
  accounts: Record<string, Account>;
  snapshots: Snapshot[];
  flagged: FlaggedPost[];
  meta: Meta;
}

export type Period = 7 | 30 | 90 | 'all';
export type Metric = 'followers' | 'engagement' | 'growth';
