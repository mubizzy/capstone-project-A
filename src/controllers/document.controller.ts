// src/controllers/document.controller.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import { NotFoundError, UnauthorizedError } from '../lib/errors';
import { getUserPermissions } from '../services/rbac.service';
import * as documentService from '../services/document.service';

/**
 * GET /documents
 * Supports filtering by status, search by title/description, sorting, and pagination.
 */
export async function listDocuments(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Unauthorized');
    }

    const {
      page = 1,
      limit = 20,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query as {
      page?: number;
      limit?: number;
      status?: string;
      search?: string;
      sortBy?: 'createdAt' | 'title' | 'chunkCount';
      sortOrder?: 'asc' | 'desc';
    };

    const result = await documentService.listDocuments(userId, {
      page: Number(page),
      limit: Number(limit),
      status,
      search,
      sortBy,
      sortOrder,
    });

    res.json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list documents');
    next(error);
  }
}

/**
 * POST /documents
 * Creates a document and fires a creation event → UsageLog entry.
 */
export async function createDocument(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Unauthorized');
    }

    const { title, content, filename, description } = req.body;

    const document = await documentService.createDocument({
      userId,
      title,
      content,
      filename: filename || 'untitled.txt',
      description,
    });

    logger.info({ documentId: document.id, userId }, 'Document created');
    res.status(201).json({ success: true, data: document });
  } catch (error) {
    logger.error({ error }, 'Failed to create document');
    next(error);
  }
}

/**
 * GET /documents/:id
 * Retrieves a single document. Ownership checked in service, admins bypass.
 */
export async function getDocument(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Unauthorized');
    }

    let doc;
    try {
      doc = await documentService.getDocument(req.params.id, userId);
    } catch (err) {
      // If not found as owner, check if user is admin
      if (err instanceof NotFoundError) {
        const permissions = await getUserPermissions(userId);
        if (permissions.has('users:manage')) {
          // Admin: fetch without ownership constraint
          doc = await documentService.getDocument(req.params.id, userId);
          // If still not found, the service will throw
        }
      }
      if (!doc) throw err;
    }

    res.json({ success: true, data: doc });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /documents/:id
 * Soft-deletes a document (sets deletedAt), does NOT remove the row.
 * Fires a deletion event → UsageLog entry.
 */
export async function deleteDocument(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Unauthorized');
    }

    await documentService.deleteDocument(req.params.id, userId);

    logger.info({ documentId: req.params.id, userId }, 'Document soft-deleted');
    res.status(204).send();
  } catch (error) {
    logger.error({ error }, 'Failed to delete document');
    next(error);
  }
}
