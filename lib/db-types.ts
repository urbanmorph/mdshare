export interface DocumentRow {
  id: string;
  title: string;
  content: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}
