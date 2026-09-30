// tests/integration/rbac.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/lib/password';

// ── Helpers ──────────────────────────────────────────────────

/** Seed RBAC roles & permissions (mirrors prisma/seed.ts) */
async function seedRBAC() {
  const permissionDefs = [
    { name: 'documents:create', resource: 'documents', action: 'create', description: 'Upload documents' },
    { name: 'documents:read', resource: 'documents', action: 'read', description: 'View documents' },
    { name: 'documents:update', resource: 'documents', action: 'update', description: 'Edit document metadata' },
    { name: 'documents:delete', resource: 'documents', action: 'delete', description: 'Delete documents' },
    { name: 'conversations:create', resource: 'conversations', action: 'create', description: 'Start conversations' },
    { name: 'conversations:read', resource: 'conversations', action: 'read', description: 'View conversations' },
    { name: 'users:read', resource: 'users', action: 'read', description: 'View user list' },
    { name: 'users:manage', resource: 'users', action: 'manage', description: 'Manage user accounts' },
    { name: 'roles:manage', resource: 'roles', action: 'manage', description: 'Manage roles and permissions' },
  ];

  const permissions: Record<string, { id: string }> = {};
  for (const perm of permissionDefs) {
    permissions[perm.name] = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }

  const roleDefs = [
    { name: 'admin', description: 'Full system access', isDefault: false, permissions: Object.keys(permissions) },
    { name: 'member', description: 'Standard user', isDefault: true, permissions: ['documents:create', 'documents:read', 'documents:update', 'conversations:create', 'conversations:read'] },
    { name: 'viewer', description: 'Read-only access', isDefault: false, permissions: ['documents:read', 'conversations:read'] },
  ];

  const roles: Record<string, { id: string }> = {};
  for (const roleDef of roleDefs) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: {},
      create: { name: roleDef.name, description: roleDef.description, isDefault: roleDef.isDefault },
    });
    roles[roleDef.name] = role;

    for (const permName of roleDef.permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permissions[permName].id } },
        update: {},
        create: { roleId: role.id, permissionId: permissions[permName].id },
      });
    }
  }

  return roles;
}

/** Create a user with a specific role and return their access token */
async function createUserWithRole(
  email: string,
  roleName: string,
  roles: Record<string, { id: string }>
) {
  const passwordHash = await hashPassword('TestPassword1!');
  const user = await prisma.user.create({
    data: { email, name: email.split('@')[0], passwordHash },
  });

  await prisma.userRole.create({
    data: { userId: user.id, roleId: roles[roleName].id },
  });

  // Login to get token
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'TestPassword1!' });

  return { user, accessToken: res.body.accessToken };
}

/** Clean all user-related data and re-seed RBAC (roles may have been wiped by other test files) */
async function cleanAndSeed() {
  // Clean everything in FK-safe order
  await prisma.usageLog.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();

  // Re-seed RBAC
  return seedRBAC();
}

// ── Tests ────────────────────────────────────────────────────

describe('RBAC Integration Tests', () => {
  let roles: Record<string, { id: string }>;

  // ──────────────────────────────────────────────────────────
  // Admin Routes
  // ──────────────────────────────────────────────────────────
  describe('Admin Routes (/api/v1/admin)', () => {
    let adminToken: string;
    let adminUser: any;
    let memberToken: string;
    let memberUser: any;

    beforeEach(async () => {
      roles = await cleanAndSeed();
      const admin = await createUserWithRole('admin@test.dev', 'admin', roles);
      adminToken = admin.accessToken;
      adminUser = admin.user;

      const member = await createUserWithRole('member@test.dev', 'member', roles);
      memberToken = member.accessToken;
      memberUser = member.user;
    });

    // ── GET /api/v1/admin/roles ──────────────────────────────
    it('admin can list roles with permissions and user counts', async () => {
      const res = await request(app)
        .get('/api/v1/admin/roles')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const adminRole = res.body.data.find((r: any) => r.name === 'admin');
      expect(adminRole).toBeDefined();
      expect(adminRole.permissions).toHaveLength(9);
      expect(adminRole.userCount).toBeGreaterThanOrEqual(1);

      const memberRole = res.body.data.find((r: any) => r.name === 'member');
      expect(memberRole).toBeDefined();
      expect(memberRole.permissions).toHaveLength(5);
      expect(memberRole.isDefault).toBe(true);

      const viewerRole = res.body.data.find((r: any) => r.name === 'viewer');
      expect(viewerRole).toBeDefined();
      expect(viewerRole.permissions).toHaveLength(2);
    });

    // ── POST /api/v1/admin/users/:userId/roles ───────────────
    it('admin can assign a role to a user', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/users/${memberUser.id}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleName: 'viewer' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify the role was assigned in the database
      const userRoles = await prisma.userRole.findMany({
        where: { userId: memberUser.id },
        include: { role: true },
      });
      const roleNames = userRoles.map((ur) => ur.role.name);
      expect(roleNames).toContain('viewer');
    });

    it('role assignment fires an audit event (logged to UsageLog)', async () => {
      await request(app)
        .post(`/api/v1/admin/users/${memberUser.id}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleName: 'viewer' });

      // Wait briefly for async event listener
      await new Promise((r) => setTimeout(r, 100));

      const auditLog = await prisma.usageLog.findFirst({
        where: { userId: adminUser.id, action: 'role_assigned' },
      });
      expect(auditLog).toBeTruthy();
      const metadata = JSON.parse(auditLog!.metadata!);
      expect(metadata.targetUserId).toBe(memberUser.id);
      expect(metadata.roleName).toBe('viewer');
    });

    // ── DELETE /api/v1/admin/users/:userId/roles/:roleName ───
    it('admin can revoke a role from a user', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/users/${memberUser.id}/roles/member`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify the role was removed
      const userRoles = await prisma.userRole.findMany({
        where: { userId: memberUser.id },
        include: { role: true },
      });
      const roleNames = userRoles.map((ur) => ur.role.name);
      expect(roleNames).not.toContain('member');
    });

    it('role revocation fires an audit event (logged to UsageLog)', async () => {
      await request(app)
        .delete(`/api/v1/admin/users/${memberUser.id}/roles/member`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Wait briefly for async event listener
      await new Promise((r) => setTimeout(r, 100));

      const auditLog = await prisma.usageLog.findFirst({
        where: { userId: adminUser.id, action: 'role_revoked' },
      });
      expect(auditLog).toBeTruthy();
      const metadata = JSON.parse(auditLog!.metadata!);
      expect(metadata.targetUserId).toBe(memberUser.id);
      expect(metadata.roleName).toBe('member');
    });

    // ── Non-admin gets 403 ───────────────────────────────────
    it('non-admin gets 403 on admin endpoints', async () => {
      const res = await request(app)
        .get('/api/v1/admin/roles')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Permission Enforcement: Member Role
  // ──────────────────────────────────────────────────────────
  describe('Member permissions', () => {
    let memberToken: string;

    beforeEach(async () => {
      roles = await cleanAndSeed();
      const member = await createUserWithRole('member@test.dev', 'member', roles);
      memberToken = member.accessToken;
    });

    it('member can create documents', async () => {
      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: 'Test Doc', content: 'Hello world' });

      expect(res.status).toBe(201);
    });

    it('member can read documents', async () => {
      const res = await request(app)
        .get('/api/v1/documents')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
    });

    it('member cannot delete documents (no documents:delete permission)', async () => {
      // Create a document first
      const createRes = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: 'To Delete', content: 'Content' });

      const docId = createRes.body.data.id;

      const res = await request(app)
        .delete(`/api/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Permission Enforcement: Viewer Role
  // ──────────────────────────────────────────────────────────
  describe('Viewer permissions', () => {
    let viewerToken: string;

    beforeEach(async () => {
      roles = await cleanAndSeed();
      const viewer = await createUserWithRole('viewer@test.dev', 'viewer', roles);
      viewerToken = viewer.accessToken;
    });

    it('viewer can read documents', async () => {
      const res = await request(app)
        .get('/api/v1/documents')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
    });

    it('viewer cannot create documents', async () => {
      const res = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Test', content: 'Denied' });

      expect(res.status).toBe(403);
    });

    it('viewer cannot delete documents', async () => {
      const res = await request(app)
        .delete('/api/v1/documents/some-id')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Resource Ownership: 404 not 403
  // ──────────────────────────────────────────────────────────
  describe('Document ownership check', () => {
    it('user accessing another user\'s document gets 404 (not 403)', async () => {
      roles = await cleanAndSeed();

      // Create two member users
      const userA = await createUserWithRole('usera@test.dev', 'member', roles);
      const userB = await createUserWithRole('userb@test.dev', 'member', roles);

      // User A creates a document
      const createRes = await request(app)
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'Private Doc', content: 'Secret stuff' });

      const docId = createRes.body.data.id;

      // User B tries to access User A's document
      const res = await request(app)
        .get(`/api/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
