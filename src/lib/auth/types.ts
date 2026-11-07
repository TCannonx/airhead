import type { Remote } from '../sync/types';

export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * The slice of authentication the app needs. Implemented over Supabase Auth
 * (`supabaseAuth.ts`), by a local-only stand-in when no server is configured,
 * and by fakes in tests. Methods throw `Error`s with plain-language messages.
 */
export interface AuthClient {
  /** 'server' = Supabase; 'local' = no server configured, nothing leaves the device. */
  mode: 'server' | 'local';
  getUser(): Promise<AuthUser | null>;
  onChange(cb: (user: AuthUser | null) => void): () => void;
  signInWithGoogle(): Promise<void>;
  /** Emails a 6-digit code (the same email also carries a sign-in link). */
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

/** Face ID / Touch ID for the app lock (WebAuthn in the app, fakes in tests). */
export interface AppLockAuthenticator {
  available(): Promise<boolean>;
  /** Registers a platform credential and returns its id (base64url). */
  register(label: string): Promise<string>;
  /** Resolves when the user passed Face ID / Touch ID; throws a plain Error otherwise. */
  verify(credentialId: string): Promise<void>;
}

export interface SortOutcome {
  ok: boolean;
  error_code: string | null;
  /** Plain-language result to show ("Sorted 3 captures." / why it couldn't). */
  message: string;
}

/** Asks the server to sort waiting captures now (AI batch). */
export interface SortingService {
  sortNow(): Promise<SortOutcome>;
}

/** The user's AI usage and prices (server-side; absent in local mode). */
export interface UsageService {
  monthRows(sinceIso: string): Promise<import('../ai/usage').UsageRow[]>;
  prices(): Promise<import('../ai/usage').PriceRow[]>;
  savePrice(price: Omit<import('../ai/usage').PriceRow, 'id' | 'user_id'>): Promise<void>;
}

export interface ContradictionsOutcome {
  ok: boolean;
  error_code: string | null;
  message: string;
  conflicts: { fact_ids: [string, string]; explanation: string; merged_text: string | null }[];
}

/** Server-side memory checks (one AI call); absent in local mode. */
export interface MemoryService {
  checkContradictions(): Promise<ContradictionsOutcome>;
}

/** Result of a linked-calendar check or refresh (fetch-linked-calendars). */
export interface CalendarOutcome {
  ok: boolean;
  error_code: string | null;
  message: string;
  /** validate: the calendar's own name and how many events it has. */
  name?: string | null;
  count?: number;
}

export interface CalendarsService {
  /** Fetches and parses a pasted link on the server; stores nothing. */
  validate(url: string): Promise<CalendarOutcome>;
  /** Refreshes one linked calendar now (it must have synced to the server). */
  refresh(feedId: string): Promise<CalendarOutcome>;
}

/** A proposed event from import-extract (the device turns these into review rows). */
export interface ExtractedEvent {
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  end_date: string | null;
  venue: string | null;
  notes: string | null;
}

export type ImportOutcome =
  | { ok: true; error_code: null; message: string; kind: 'events'; events: ExtractedEvent[] }
  | { ok: true; error_code: null; message: string; kind: 'ics'; text: string }
  | { ok: false; error_code: string; message: string };

export interface ImportRequest {
  kind: 'text' | 'image' | 'pdf' | 'link';
  text?: string;
  data?: string;
  media_type?: string;
  url?: string;
  instruction: string;
  today: string;
  time_zone: string;
}

export interface ImportsService {
  /** One AI call (or a server fetch for links) to read a schedule (Task 4.10). */
  extract(req: ImportRequest): Promise<ImportOutcome>;
}

export interface PushService {
  /** The server's VAPID public key, or null when push isn't set up there. */
  publicKey(): Promise<string | null>;
  /** A test notification to one device (it must have synced). */
  sendTest(deviceId: string): Promise<{ ok: boolean; message: string }>;
}

export interface BriefsService {
  /** Rebuilds today's brief now (one large-tier AI call, or the fallback list). */
  regenerate(): Promise<{ ok: boolean; message: string }>;
}

/** What Summarise returns (Task 6.7); stored on the note as `data.summary` with `at`. */
export interface NoteSummary {
  /** Handwritten pages only: what is written, as text. */
  transcription: string | null;
  summary: string;
  decisions: string[];
  actions: { title: string; owner: string | null; due_text: string | null }[];
}

export interface SummariseRequest {
  kind: 'typed' | 'ink';
  title: string;
  date: string | null;
  attendees: string[];
  html?: string;
  /** PNG pages as base64, rendered on the device. */
  images?: string[];
}

export type SummariseOutcome =
  | { ok: true; error_code: null; message: string; result: NoteSummary; cost_eur: number }
  | { ok: false; error_code: string; message: string };

export interface NotesService {
  /** One large-tier AI call (vision for handwritten pages). */
  summarise(req: SummariseRequest): Promise<SummariseOutcome>;
}

/** Capture tokens for iOS Shortcuts (Task 7.1); server only, never synced. */
export interface CaptureTokensService {
  list(): Promise<import('../capture/tokens').CaptureTokenRow[]>;
  /** Creates a token and returns it (the only time it is visible). */
  create(label: string): Promise<string>;
  revoke(id: string): Promise<void>;
}

export type WorkshopOutcome =
  | { ok: true; error_code: null; message: string; draft: Record<string, unknown> }
  | { ok: false; error_code: string; message: string };

export type WorkshopTurnOutcome =
  | {
      ok: true;
      error_code: null;
      message: string;
      draft: Record<string, unknown>;
      session: Record<string, unknown>;
    }
  | { ok: false; error_code: string; message: string };

/** The Workshop's AI (Tasks 7.6–7.7); absent in local mode. */
export interface WorkshopService {
  /** Auto flesh-out: one large-tier call; returns the new draft version. */
  fleshOut(itemId: string): Promise<WorkshopOutcome>;
  /** One turn of Work on it together (answer null to start). */
  turn?(itemId: string, answer: string | null): Promise<WorkshopTurnOutcome>;
}

export type AskOutcome =
  | {
      ok: true;
      error_code: null;
      message: string;
      answer: string;
      sources: { n: number; item_id: string; title: string; type: string }[];
    }
  | { ok: false; error_code: string; message: string };

/** Ask Airhead (Task 7.10): hybrid search plus one AI call; absent in local mode. */
export interface AskService {
  ask(question: string): Promise<AskOutcome>;
}

/** The weekly review on demand (Task 8.4); absent in local mode. */
export interface ReviewsService {
  run(): Promise<{ ok: boolean; message: string }>;
}

export interface Services {
  auth: AuthClient;
  appLock: AppLockAuthenticator;
  /** The sync server; null in local mode (nothing leaves the device). */
  remote: Remote | null;
  /** AI sorting on the server; absent in local mode. */
  sorting?: SortingService;
  usage?: UsageService;
  memory?: MemoryService;
  calendars?: CalendarsService;
  imports?: ImportsService;
  push?: PushService;
  briefs?: BriefsService;
  notes?: NotesService;
  captureTokens?: CaptureTokensService;
  workshop?: WorkshopService;
  ask?: AskService;
  reviews?: ReviewsService;
}
