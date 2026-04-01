import { getDB } from "@/lib/db";
import type { DocumentRow } from "@/lib/db";
import { resolveToken } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { DocumentView } from "./document-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ key?: string }>;
}

export default async function DocumentPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { key } = await searchParams;

  if (!key) notFound();

  const db = getDB();
  const resolved = await resolveToken(db, key);
  if (!resolved || resolved.documentId !== id) notFound();

  const doc = await db
    .prepare("SELECT * FROM documents WHERE id = ?")
    .bind(id)
    .first<DocumentRow>();

  if (!doc) notFound();

  return (
    <DocumentView
      document={doc}
      permission={resolved.permission}
      tokenKey={key}
    />
  );
}
