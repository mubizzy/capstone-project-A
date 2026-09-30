// src/services/rbac.service.ts
import { prisma } from '../lib/prisma';

/**
 * Loads all permissions for a user by traversing:
 *   UserRole → Role → RolePermission → Permission
 * Returns a flat Set of permission names like 'documents:create'.
 */
export async function getUserPermissions(
  userId: string
): Promise<Set<string>> {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  const permissions = new Set<string>();
  for (const ur of userRoles) {
    for (const rp of ur.role.permissions) {
      permissions.add(rp.permission.name);
    }
  }

  return permissions;
}
