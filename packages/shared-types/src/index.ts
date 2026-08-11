export interface HealthStatus {
  status: "ok";
  service: string;
}

export type Role = "ADMIN" | "USER";

export type ProviderName = "GROQ" | "AZURE_OPENAI" | "ANTHROPIC";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: Role;
}

export interface ProviderCredentialPublic {
  id: string;
  provider: ProviderName;
  label: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  chunkCount: number;
  uploadedBy: string | null;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: Role;
  createdAt: string;
}

export interface ChatSourceMatch {
  filename: string;
  text: string;
  score: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FaqEntry {
  /** Normalized question text (lowercased, trimmed, punctuation-stripped) */
  question: string;
  count: number;
}

export interface ProviderUsageWindow {
  limit: number | null;
  remaining: number | null;
  /** Raw reset value from the provider's header (format varies by provider) */
  resetHint: string | null;
}

export interface ProviderUsageSnapshot {
  provider: ProviderName;
  requests: ProviderUsageWindow;
  tokens: ProviderUsageWindow;
  /** null until at least one chat call has been made against this provider since server start */
  updatedAt: string | null;
}
