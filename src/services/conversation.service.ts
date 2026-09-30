// src/services/conversation.service.ts

import { NotFoundError } from '../lib/errors';
import { prisma } from '../lib/prisma';

/**
 * List conversations for a user with the latest message preview and message count.
 * Uses Prisma include + _count to avoid N+1 queries.
 */
export async function listConversations(
  userId: string,
  options: { page: number; limit: number }
) {
  const { page, limit } = options;

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Only the latest message — no N+1
          select: {
            content: true,
            role: true,
            createdAt: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    }),
    prisma.conversation.count({ where: { userId } }),
  ]);

  return {
    data: conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      messageCount: conv._count.messages,
      lastMessage: conv.messages[0] || null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    })),
    meta: {
      page,
      limit,
      total,
    },
  };
}

/**
 * Create a new conversation for a user.
 */
export async function createConversation(data: {
  userId: string;
  title?: string;
}) {
  const conversation = await prisma.conversation.create({
    data: {
      userId: data.userId,
      title: data.title || 'New Conversation',
    },
  });

  return conversation;
}

/**
 * Send a message in a conversation.
 * Uses $transaction to atomically:
 *   1. Verify conversation ownership
 *   2. Optionally verify document exists and is not soft-deleted
 *   3. Create the user message
 *   4. Touch conversation updatedAt
 *   5. Create a placeholder assistant message
 *   6. Log usage
 *
 * All operations use the tx client, not the global prisma.
 * Transaction rolls back completely if any step fails.
 */
export async function sendMessage(data: {
  conversationId: string;
  userId: string;
  content: string;
  documentId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    // 1. Verify the conversation belongs to this user
    const conversation = await tx.conversation.findUnique({
      where: { id: data.conversationId },
    });

    if (!conversation || conversation.userId !== data.userId) {
      throw new NotFoundError('Conversation not found');
    }

    // 2. If a documentId is provided, verify it exists and is not soft-deleted
    if (data.documentId) {
      const doc = await tx.document.findFirst({
        where: {
          id: data.documentId,
          deletedAt: null,
        },
      });

      if (!doc) {
        throw new NotFoundError('Document not found');
      }
    }

    // 3. Create the user's message
    const userMessage = await tx.message.create({
      data: {
        conversationId: data.conversationId,
        documentId: data.documentId,
        role: 'user',
        content: data.content,
      },
    });

    // 4. Touch the conversation's updatedAt
    await tx.conversation.update({
      where: { id: data.conversationId },
      data: { updatedAt: new Date() },
    });

    // 5. Create a placeholder assistant message (RAG pipeline in Week 4)
    const assistantMessage = await tx.message.create({
      data: {
        conversationId: data.conversationId,
        documentId: data.documentId,
        role: 'assistant',
        content: 'AI response placeholder (Week 4)',
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
      },
    });

    // 6. Log usage
    await tx.usageLog.create({
      data: {
        userId: data.userId,
        action: 'chat',
        tokens: 0, // Placeholder until Week 4
        costUsd: 0,
      },
    });

    return { userMessage, assistantMessage };
  });
}