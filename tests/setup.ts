// tests/helpers/setup.ts

import { prisma } from '../src/lib/prisma';

/**
 * Seed the minimum RBAC data needed for tests.
 * Creates a default "member" role with the standard permissions.
 * Idempotent — safe to call multiple times.
 */
export async function seedTestRBAC() {
  const permissionDefs = [
    { name: 'documents:create', resource: 'documents', action: 'create' },
    { name: 'documents:read', resource: 'documents', action: 'read' },
    { name: 'documents:update', resource: 'documents', action: 'update' },
    { name: 'documents:delete', resource: 'documents', action: 'delete' },
    { name: 'conversations:create', resource: 'conversations', action: 'create' },
    { name: 'conversations:read', resource: 'conversations', action: 'read' },
  ];

  const permissions: Record<string, { id: string }> = {};
  for (const perm of permissionDefs) {
    permissions[perm.name] = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }

  const role = await prisma.role.upsert({
    where: { name: 'member' },
    update: {},
    create: {
      name: 'member',
      description: 'Standard user',
      isDefault: true,
    },
  });

  for (const permName of Object.keys(permissions)) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: permissions[permName].id,
        },
      },
      update: {},
      create: {
        roleId: role.id,
        permissionId: permissions[permName].id,
      },
    });
  }

  return role;
}

export async function resetDatabase() {
  // Delete in order that respects foreign key constraints
  await prisma.usageLog.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.document.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();

  // Re-seed RBAC so test users get the default role
  await seedTestRBAC();
}

export async function createTestUser(overrides: Record<string, any> = {}) {
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash('TestPassword1!', 4);

  const user = await prisma.user.create({
    data: {
      name: 'Test User',
      email: 'test@docuchat.dev',
      passwordHash: hash,
      ...overrides,
    },
  });

  const defaultRole = await prisma.role.findFirst({
    where: { isDefault: true },
  });

  if (defaultRole) {
    await prisma.userRole.create({
      data: { userId: user.id, roleId: defaultRole.id },
    });
  }

  return user;
}
