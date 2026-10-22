import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { LEGAL_DOCUMENTS } from '@/config/legal';

type DocumentPageProps = { params: Promise<{ document: string }> };

async function resolveDocument(params: DocumentPageProps['params']) {
  const { document: id } = await params;
  const document = LEGAL_DOCUMENTS.find((item) => item.id === id);

  if (!document) notFound();

  return document;
}

export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((document) => ({ document: document.id }));
}

export async function generateMetadata({ params }: DocumentPageProps): Promise<Metadata> {
  const document = await resolveDocument(params);

  return { title: document.title, description: document.summary };
}

export default async function DocumentPage({ params }: DocumentPageProps) {
  const document = await resolveDocument(params);

  return <LegalDocument document={document} />;
}
