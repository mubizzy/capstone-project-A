// src/routes/conversations.ts
import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePermission } from '../middleware/authorize';
import {
  createConversationSchema,
  sendMessageSchema,
} from '../validators/conversation.validator';
import { logger } from '../lib/logger';
import * as conversationService from '../services/conversation.service';

const router = Router();
router.use(authenticate); // All conversation routes require auth

/**
 * GET /conversations
 * Returns conversations with last message preview and message count (no N+1).
 * Paginated with meta (page, limit, total).
 */
router.get(
  '/',
  requirePermission('conversations:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await conversationService.listConversations(userId, {
        page,
        limit,
      });

      res.json({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /conversations
 * Creates a new conversation.
 */
router.post(
  '/',
  requirePermission('conversations:create'),
  validate(createConversationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { title } = req.body;

      const conversation = await conversationService.createConversation({
        userId,
        title,
      });

      logger.info(
        { conversationId: conversation.id, userId },
        'Conversation created'
      );
      res.status(201).json({ success: true, data: conversation });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /conversations/:id/messages
 * Creates both user and assistant messages in one transaction.
 * Uses $transaction for message creation + conversation update + usage log.
 */
router.post(
  '/:id/messages',
  requirePermission('conversations:create'),
  validate(sendMessageSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;
      const { content, documentId } = req.body;

      const result = await conversationService.sendMessage({
        conversationId,
        userId,
        content,
        documentId,
      });

      logger.info(
        { conversationId, userId },
        'Message sent'
      );
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
