// src/controllers/document.controller.ts
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { NotFoundError, UnauthorizedError } from '../lib/errors';
import { prisma } from '../lib/prisma';  

// const prisma = new PrismaClient();

export async function listDocuments(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    const { page, limit, status } = req.query as {
      page: string;
      limit: string;
      status?: string;
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = { userId };
    if (status) {
      where.status = status;
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.document.count({ where }),
    ]);

    res.json({
      data: documents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list documents');
    next(error);
  }
}

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
    const { title, content } = req.body;

    const document = await prisma.document.create({
      data: {
        title,
        content,
        userId,
        status: 'pending',
      },
    });

    logger.info({ documentId: document.id, userId }, 'Document created');
    res.status(201).json({ data: document });
  } catch (error) {
    logger.error({ error }, 'Failed to create document');
    next(error);
  }
}

export async function getDocument(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const document = await prisma.document.findFirst({
      where: {
        id,
        userId,
      },
    });
    if (!document) {
      throw new NotFoundError('Document not found');
    }

    res.json({ data: document });
  } catch (error) {
    logger.error({ error }, 'Failed to get document');
    next(error);
  }
}

export async function deleteDocument(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const document = await prisma.document.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    await prisma.document.delete({
      where: { id },
    });

    logger.info({ documentId: id, userId }, 'Document deleted');
    res.status(204).send();
  } catch (error) {
    logger.error({ error }, 'Failed to delete document');
    next(error);
  }
}
