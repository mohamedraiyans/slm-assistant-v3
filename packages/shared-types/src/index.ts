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
  uploadedBy: string;
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
