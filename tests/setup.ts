// tests/helpers/setup.ts

import { prisma } from '../src/lib/prisma';


export async function resetDatabase() {
  // Delete in order that respects foreign key constraints
  // await prisma.usageLog.deleteMany();
  // await prisma.message.deleteMany();
  // await prisma.conversation.deleteMany();
  // await prisma.chunk.deleteMany();
  // await prisma.document.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

export async function createTestUser(overrides = {}) {
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash('TestPassword1!', 4); // Low rounds for speed
  return prisma.user.create({
    data: {
      name: 'Test User',
      email: 'test@docuchat.dev',
      passwordHash: hash,
      ...overrides,
    },
  });
}
