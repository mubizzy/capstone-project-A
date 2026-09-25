// In src/services/auth.service.ts, add at the top:
// import { hashPassword, verifyPassword } from '../lib/password';
import { appEvents } from '../lib/events';
import { AUTH_EVENTS } from '../events/auth.events';
// import { prisma } from '../lib/prisma';
import { prisma } from '../lib/prisma';
import { hashPassword, verifyPassword } from '../lib/password';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../lib/tokens';
import crypto from 'crypto';
// at top of auth.service.ts, add:
import { ConflictError, UnauthorizedError } from '../lib/errors';



// ── [COMMENTED OUT] First register/login versions ──────────────────
// These were incomplete stubs (login had undefined tokens and invalid
// spread syntax in the return). The complete versions below are kept.
//
// export async function register(data: {
//   email: string;
//   password: string;
// }) {
//   const existing = await prisma.user.findUnique({
//     where: { email: data.email.toLowerCase().trim() },
//   });
//   if (existing) throw new Error('Email already registered');
//   const passwordHash = await hashPassword(data.password);
//   const user = await prisma.user.create({
//     data: {
//       email: data.email.toLowerCase().trim(),
//       passwordHash,
//     },
//   });
//
//   appEvents.emit(AUTH_EVENTS.USER_REGISTERED, {
//     id: user.id,
//     email: user.email,
//     tier: user.tier,
//   });
//
//   return { id: user.id, email: user.email, tier: user.tier };
// }
//
// export async function login(data: {
//   email: string;
//   password: string;
//   deviceInfo?: string;
// }) {
//   const user = await prisma.user.findUnique({
//     where: { email: data.email.toLowerCase().trim() },
//   });
//
//   if (!user || !user.isActive) {
//     appEvents.emit(AUTH_EVENTS.LOGIN_FAILED, {
//       email: data.email,
//       deviceInfo: data.deviceInfo,
//       reason: 'user_not_found',
//     });
//     throw new Error('Invalid credentials');
//   }
//
//   const valid = await verifyPassword(data.password, user.passwordHash);
//   if (!valid) {
//     appEvents.emit(AUTH_EVENTS.LOGIN_FAILED, {
//       email: data.email,
//       deviceInfo: data.deviceInfo,
//       reason: 'wrong_password',
//     });
//     throw new Error('Invalid credentials');
//   }
//
//   appEvents.emit(AUTH_EVENTS.USER_LOGGED_IN, {
//     userId: user.id,
//     deviceInfo: data.deviceInfo,
//   });
//
//   return { accessToken, refreshToken, user: { ... } };
// }
//
// appEvents.on(AUTH_EVENTS.USER_REGISTERED, async (user) => {
//   try {
//     await Promise.race([
//       notifySlack(`New signup: ${user.email}`),
//       new Promise((_, reject) =>
//         setTimeout(() => reject(new Error('Slack timeout')), 3000)
//       ),
//     ]);
//   } catch (error) {
//     console.error('Slack notification failed or timed out:', error);
//   }
// });

// ── Register ────────────────────────────────────────────────

export async function register(data: {
  email: string;
  password: string;
  name?: string;
}) {
  // Check if user already exists
  const existing = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase().trim() },
  });
  if (existing) {
    throw new ConflictError('Email already registered');
  }

  const passwordHash = await hashPassword(data.password);

  // Use provided name or generate one from email
  const name = data.name?.trim() || data.email.split('@')[0];

  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase().trim(),
      passwordHash,
      name,
    },
  });

  // Emit and move on. Don't wait for listeners.
  appEvents.emit(AUTH_EVENTS.USER_REGISTERED, {
    id: user.id,
    email: user.email,
    tier: user.tier,
  });

  // Don't return the hash
  return { id: user.id, email: user.email, tier: user.tier};
}

// ── Login ─────────────────────────────────────────────────

export async function login(data: {
  email: string;
  password: string;
  deviceInfo?: string;
}) {
  const user = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase().trim() },
  });

  // Same error for "user not found" and "wrong password"
  // This prevents user enumeration attacks
  if (!user || !user.isActive) {
    appEvents.emit(AUTH_EVENTS.LOGIN_FAILED, {
      email: data.email,
      deviceInfo: data.deviceInfo,
      reason: 'user_not_found',
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  const valid = await verifyPassword(data.password, user.passwordHash);
  if (!valid) {
    appEvents.emit(AUTH_EVENTS.LOGIN_FAILED, {
      email: data.email,
      deviceInfo: data.deviceInfo,
      reason: 'wrong_password',
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Store the refresh token hash (never store the raw token)
  const tokenHash = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');

  // We need a RefreshToken model for this.
  // Add it to your schema if you haven't already.
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Emit success event
  appEvents.emit(AUTH_EVENTS.USER_LOGGED_IN, {
    userId: user.id,
    deviceInfo: data.deviceInfo,
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, tier: user.tier },
  };
}


// ── Refresh ───────────────────────────────────────────────

export async function refresh(rawRefreshToken: string) {
  // Verify the JWT signature and expiration
  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new UnauthorizedError('Invalid refresh token');
  }

  if (payload.type !== 'refresh') {
    throw new UnauthorizedError('Invalid token type');
  }

  // Check if this token exists in the database (not revoked)
  const tokenHash = crypto
    .createHash('sha256')
    .update(rawRefreshToken)
    .digest('hex');

  const stored = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
  });

  if (!stored || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expired or revoked');
  }

  // Get the user
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
  });
  if (!user || !user.isActive) {
    throw new UnauthorizedError('User not found or inactive');
  }

  // Rotate: delete the old token, create a new one
  await prisma.refreshToken.delete({ where: { token: tokenHash } });

  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);
  const newHash = crypto
    .createHash('sha256')
    .update(newRefreshToken)
    .digest('hex');

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: newHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

// ── Logout ────────────────────────────────────────────────

export async function logout(rawRefreshToken: string) {
  const tokenHash = crypto
    .createHash('sha256')
    .update(rawRefreshToken)
    .digest('hex');

  // Delete the token. If it doesn't exist, that's fine.
  await prisma.refreshToken.deleteMany({
    where: { token: tokenHash },
  });
}

