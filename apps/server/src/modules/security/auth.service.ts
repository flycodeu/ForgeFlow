import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AiScope, AiTokenSummary, CreatedAiToken, OwnerIdentity } from '@forgeflow/contracts';
import { ApiError } from '../../shared/api-error.js';
import { AuthRepository } from './auth.repository.js';

export const SESSION_COOKIE = 'forgeflow_session';
export const SESSION_MAX_AGE = 12 * 60 * 60;
const SCOPES: AiScope[] = [
  'project:read', 'project:write', 'spec:read', 'spec:write', 'planning:write', 'task:read', 'run:write',
];
export type AiTokenPrincipal = { kind: 'ai_token'; id: string; name: string; scopes: AiScope[] };
type Principal = OwnerIdentity
  | { kind: 'local_web'; id: 'local'; name: 'ForgeFlow Local' }
  | AiTokenPrincipal;

function isLoopback(address: string) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, result) => error ? reject(error) : resolve(result));
  });
}

function tokenView(token: ReturnType<AuthRepository['listTokens']>[number]): AiTokenSummary {
  return {
    id: token.id, name: token.name, scopes: JSON.parse(token.scopes) as AiScope[],
    createdAt: token.createdAt.toISOString(), lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  };
}

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  status() { return { initialized: Boolean(this.repository.findOwner()) }; }

  async initialize(username: string, password: string) {
    if (this.repository.findOwner()) throw new ApiError(409, 'OWNER_EXISTS', 'Owner 已初始化');
    const salt = randomBytes(16);
    const passwordHash = (await derive(password, salt)).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const now = new Date();
    this.repository.transaction(() => {
      if (this.repository.findOwner()) throw new ApiError(409, 'OWNER_EXISTS', 'Owner 已初始化');
      this.repository.insertOwner({ id: 1, username, passwordHash, passwordSalt: salt.toString('hex'), createdAt: now });
      this.repository.insertSession({ sessionHash: hash(secret), ownerId: 1, createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_MAX_AGE * 1000) });
    });
    return { identity: { kind: 'owner' as const, id: 1 as const, username }, secret };
  }

  async login(username: string, password: string) {
    const owner = this.repository.findOwner();
    if (!owner || username !== owner.username) throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
    const actual = await derive(password, Buffer.from(owner.passwordSalt, 'hex'));
    if (!timingSafeEqual(actual, Buffer.from(owner.passwordHash, 'hex'))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
    }
    const secret = randomBytes(32).toString('base64url');
    const now = new Date();
    this.repository.insertSession({ sessionHash: hash(secret), ownerId: 1, createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_MAX_AGE * 1000) });
    return { identity: { kind: 'owner' as const, id: 1 as const, username: owner.username }, secret };
  }

  logout(secret: string | undefined) {
    if (secret) this.repository.revokeSession(hash(secret), new Date());
  }

  async require(request: FastifyRequest, permission: 'owner' | AiScope, allowLocalWeb = false): Promise<Principal> {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      const match = /^Bearer (ffai_[A-Za-z0-9_-]+)$/.exec(authorization);
      if (!match) throw new ApiError(401, 'UNAUTHENTICATED', 'Bearer Token 无效');
      const token = this.repository.findTokenByHash(hash(match[1]!));
      if (!token || token.revokedAt) throw new ApiError(401, 'UNAUTHENTICATED', 'Bearer Token 无效');
      const scopes = JSON.parse(token.scopes) as AiScope[];
      if (permission === 'owner' || !scopes.includes(permission)) {
        throw new ApiError(403, 'FORBIDDEN', '权限不足');
      }
      this.repository.touchToken(token.id, new Date());
      return { kind: 'ai_token', id: token.id, name: token.name, scopes };
    }
    const secret = request.cookies[SESSION_COOKIE];
    if (secret) {
      const session = this.repository.findSession(hash(secret));
      if (session && !session.revokedAt && session.expiresAt.getTime() > Date.now()) {
        const owner = this.repository.findOwner();
        if (owner) return { kind: 'owner', id: 1, username: owner.username };
      }
    }
    if (allowLocalWeb && isLoopback(request.ip)) {
      return { kind: 'local_web', id: 'local', name: 'ForgeFlow Local' };
    }
    if (secret) throw new ApiError(401, 'UNAUTHENTICATED', 'Session 已失效，请重新登录');
    throw new ApiError(401, 'UNAUTHENTICATED', '请先登录');
  }

  requireAiToken(request: FastifyRequest, permissions: AiScope[] = []): AiTokenPrincipal {
    const authorization = request.headers.authorization;
    const match = authorization && /^Bearer (ffai_[A-Za-z0-9_-]+)$/.exec(authorization);
    if (!match) throw new ApiError(401, 'UNAUTHENTICATED', 'MCP 需要有效的 AI Bearer Token');
    const token = this.repository.findTokenByHash(hash(match[1]!));
    if (!token || token.revokedAt) throw new ApiError(401, 'UNAUTHENTICATED', 'Bearer Token 无效或已撤销');
    const scopes = JSON.parse(token.scopes) as AiScope[];
    if (permissions.some((permission) => !scopes.includes(permission))) {
      throw new ApiError(403, 'FORBIDDEN', 'AI Token 缺少 MCP Tool 所需 Scope');
    }
    this.repository.touchToken(token.id, new Date());
    return { kind: 'ai_token', id: token.id, name: token.name, scopes };
  }

  listTokens() { return this.repository.listTokens().map(tokenView); }

  createToken(name: string, scopes: AiScope[]): CreatedAiToken {
    if (!scopes.length || new Set(scopes).size !== scopes.length || scopes.some((scope) => !SCOPES.includes(scope))) {
      throw new ApiError(400, 'INVALID_INPUT', '请选择有效且不重复的 Scope');
    }
    this.ensureCompatibilityOwner();
    const secret = `ffai_${randomBytes(32).toString('base64url')}`;
    const token = { id: randomUUID(), ownerId: 1, name, tokenHash: hash(secret),
      scopes: JSON.stringify(scopes), createdAt: new Date(), lastUsedAt: null, revokedAt: null };
    this.repository.insertToken(token);
    return { ...tokenView(token), token: secret };
  }

  revokeToken(id: string) {
    const token = this.repository.findToken(id);
    if (!token) throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token 不存在');
    if (!token.revokedAt) this.repository.revokeToken(id, new Date());
    return tokenView(this.repository.findToken(id)!);
  }

  private ensureCompatibilityOwner() {
    if (this.repository.findOwner()) return;
    this.repository.transaction(() => {
      if (this.repository.findOwner()) return;
      this.repository.insertOwner({
        id: 1,
        username: 'local',
        passwordHash: randomBytes(64).toString('hex'),
        passwordSalt: randomBytes(16).toString('hex'),
        createdAt: new Date(),
      });
    });
  }
}
