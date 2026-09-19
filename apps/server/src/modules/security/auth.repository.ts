import { and, desc, eq, isNull } from 'drizzle-orm';
import type { openDatabase } from '../../db/client.js';
import { aiTokens, owner, ownerSessions } from '../../db/schema.js';

type Connection = ReturnType<typeof openDatabase>;

export class AuthRepository {
  constructor(private readonly connection: Connection) {}

  transaction<T>(work: () => T): T {
    return this.connection.sqlite.transaction(work).immediate();
  }

  findOwner() {
    return this.connection.db.select().from(owner).where(eq(owner.id, 1)).get();
  }

  insertOwner(value: typeof owner.$inferInsert) {
    this.connection.db.insert(owner).values(value).run();
  }

  insertSession(value: typeof ownerSessions.$inferInsert) {
    this.connection.db.insert(ownerSessions).values(value).run();
  }

  findSession(sessionHash: string) {
    return this.connection.db.select().from(ownerSessions)
      .where(eq(ownerSessions.sessionHash, sessionHash)).get();
  }

  revokeSession(sessionHash: string, at: Date) {
    this.connection.db.update(ownerSessions).set({ revokedAt: at })
      .where(and(eq(ownerSessions.sessionHash, sessionHash), isNull(ownerSessions.revokedAt))).run();
  }

  insertToken(value: typeof aiTokens.$inferInsert) {
    this.connection.db.insert(aiTokens).values(value).run();
  }

  listTokens() {
    return this.connection.db.select().from(aiTokens)
      .where(eq(aiTokens.ownerId, 1)).orderBy(desc(aiTokens.createdAt)).all();
  }

  findToken(id: string) {
    return this.connection.db.select().from(aiTokens)
      .where(and(eq(aiTokens.id, id), eq(aiTokens.ownerId, 1))).get();
  }

  findTokenByHash(tokenHash: string) {
    return this.connection.db.select().from(aiTokens)
      .where(eq(aiTokens.tokenHash, tokenHash)).get();
  }

  touchToken(id: string, at: Date) {
    this.connection.db.update(aiTokens).set({ lastUsedAt: at })
      .where(and(eq(aiTokens.id, id), isNull(aiTokens.revokedAt))).run();
  }

  revokeToken(id: string, at: Date) {
    this.connection.db.update(aiTokens).set({ revokedAt: at })
      .where(and(eq(aiTokens.id, id), isNull(aiTokens.revokedAt))).run();
  }
}
