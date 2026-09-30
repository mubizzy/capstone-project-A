import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

async function seedRBAC() {
  // ── 9 Permissions ──────────────────────────────────────────
  // documents CRUD, conversations CR, users RM, roles M
  const permissionDefs = [
    { name: 'documents:create', resource: 'documents', action: 'create',
      description: 'Upload documents' },
    { name: 'documents:read', resource: 'documents', action: 'read',
      description: 'View documents' },
    { name: 'documents:update', resource: 'documents', action: 'update',
      description: 'Edit document metadata' },
    { name: 'documents:delete', resource: 'documents', action: 'delete',
      description: 'Delete documents' },
    { name: 'conversations:create', resource: 'conversations', action: 'create',
      description: 'Start conversations' },
    { name: 'conversations:read', resource: 'conversations', action: 'read',
      description: 'View conversations' },
    { name: 'users:read', resource: 'users', action: 'read',
      description: 'View user list' },
    { name: 'users:manage', resource: 'users', action: 'manage',
      description: 'Manage user accounts' },
    { name: 'roles:manage', resource: 'roles', action: 'manage',
      description: 'Manage roles and permissions' },
  ];

  // Upsert all permissions
  const permissions: Record<string, { id: string }> = {};
  for (const perm of permissionDefs) {
    permissions[perm.name] = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }

  // ── 3 Roles ────────────────────────────────────────────────
  // admin  → all 9 perms
  // member → 5 perms (documents CRU + conversations CR) — isDefault
  // viewer → 2 perms (documents:read + conversations:read)
  const roleDefs = [
    {
      name: 'admin',
      description: 'Full system access',
      isDefault: false,
      permissions: Object.keys(permissions), // All 9
    },
    {
      name: 'member',
      description: 'Standard user',
      isDefault: true,
      permissions: [
        'documents:create', 'documents:read', 'documents:update',
        'conversations:create', 'conversations:read',
      ],
    },
    {
      name: 'viewer',
      description: 'Read-only access',
      isDefault: false,
      permissions: ['documents:read', 'conversations:read'],
    },
  ];

  const roles: Record<string, { id: string }> = {};

  for (const roleDef of roleDefs) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: {},
      create: {
        name: roleDef.name,
        description: roleDef.description,
        isDefault: roleDef.isDefault,
      },
    });
    roles[roleDef.name] = role;

    // Link permissions to role
    for (const permName of roleDef.permissions) {
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
  }

  console.log('✔ RBAC seeded: 3 roles, 9 permissions');
  return roles;
}

async function seedUsers(roles: Record<string, { id: string }>) {
  // ── Admin seed user ────────────────────────────────────────
  const adminHash = await hashPassword('Admin123!');
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@capstone.dev' },
    update: {},
    create: {
      email: 'admin@capstone.dev',
      name: 'Admin User',
      passwordHash: adminHash,
      role: 'admin',
    },
  });

  // Assign admin role
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: roles['admin'].id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: roles['admin'].id,
      assignedBy: 'system-seed',
    },
  });

  // ── Test seed user ─────────────────────────────────────────
  const testHash = await hashPassword('Test1234!');
  const testUser = await prisma.user.upsert({
    where: { email: 'test@capstone.dev' },
    update: {},
    create: {
      email: 'test@capstone.dev',
      name: 'Test User',
      passwordHash: testHash,
      role: 'user',
    },
  });

  // Assign member role (the default role)
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: testUser.id,
        roleId: roles['member'].id,
      },
    },
    update: {},
    create: {
      userId: testUser.id,
      roleId: roles['member'].id,
      assignedBy: 'system-seed',
    },
  });

  console.log('✔ Seed users created: admin@capstone.dev, test@capstone.dev');
}

async function main() {
  console.log('🌱 Seeding database...');
  const roles = await seedRBAC();
  await seedUsers(roles);
  console.log('🌱 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
