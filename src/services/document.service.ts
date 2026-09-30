// src/services/document.service.ts

import { DOC_EVENTS } from '../events/document.events';
import { NotFoundError } from '../lib/errors';
import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';

interface ListDocumentsOptions {
  page: number;
  limit: number;
  status?: string;
  search?: string;
  sortBy?: 'createdAt' | 'title' | 'chunkCount';
  sortOrder?: 'asc' | 'desc';
}

/**
 * List documents for a user with filtering, search, sorting, and pagination.
 * All queries exclude soft-deleted documents (deletedAt: null).
 */
export async function listDocuments(
  userId: string,
  options: ListDocumentsOptions
) {
  const {
    page,
    limit,
    status,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;

  // Build the where clause dynamically
  const where: any = {
    userId,
    deletedAt: null, // Soft delete filter
  };

  if (status) {
    where.status = status;
  }

  // Search uses OR across title and description
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        title: true,
        filename: true,
        description: true,
        status: true,
        chunkCount: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    data: documents,
    meta: { page, limit, total },
  };
}

/**
 * Get a single document by ID.
 * Excludes soft-deleted documents.
 */
export async function getDocument(documentId: string, userId: string) {
  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      userId,
      deletedAt: null,
    },
  });

  if (!doc) {
    throw new NotFoundError('Document not found');
  }

  return doc;
}

/**
 * Create a new document and emit a creation event.
 * Chunks are managed through this service (aggregate root).
 */
export async function createDocument(data: {
  userId: string;
  title: string;
  filename: string;
  content: string;
  description?: string;
}) {
  const doc = await prisma.document.create({
    data: {
      userId: data.userId,
      title: data.title,
      filename: data.filename,
      content: data.content,
      description: data.description,
      status: 'pending',
    },
  });

  // Fire document created event → logs to UsageLog
  appEvents.emit(DOC_EVENTS.CREATED, {
    userId: data.userId,
    documentId: doc.id,
    title: doc.title,
    fileSizeBytes: Buffer.byteLength(data.content, 'utf8'),
  });

  return doc;
}

/**
 * Soft-delete a document by setting deletedAt and deletedBy.
 * Does NOT remove the row from the database.
 */
export async function deleteDocument(documentId: string, userId: string) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!doc || doc.deletedAt) {
    throw new NotFoundError('Document not found');
  }

  // Ownership check
  if (doc.userId !== userId) {
    throw new NotFoundError('Document not found');
  }

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: {
      deletedAt: new Date(),
      deletedBy: userId,
    },
  });

  // Fire document deleted event → logs to UsageLog
  appEvents.emit(DOC_EVENTS.DELETED, {
    deletedBy: userId,
    documentId: doc.id,
    title: doc.title,
  });

  return updated;
}
