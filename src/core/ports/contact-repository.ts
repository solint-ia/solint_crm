import type { Contact } from '../domain/contact';
import type { Id } from '../domain/shared';

export interface ContactFilter {
  readonly search?: string;
  readonly labelId?: Id;
  readonly ownerName?: string;
  readonly kind?: 'pessoa' | 'empresa' | 'grupo';
}

export interface ContactReader {
  list(accountId: Id, filter?: ContactFilter): Promise<readonly Contact[]>;
  findById(accountId: Id, contactId: Id): Promise<Contact | null>;
}

export interface ContactWriter {
  create(accountId: Id, contact: Omit<Contact, 'id' | 'accountId'>): Promise<Contact>;
  update(accountId: Id, contactId: Id, patch: Partial<Contact>): Promise<Contact>;
  merge(accountId: Id, primaryId: Id, duplicateId: Id): Promise<Contact>;
  /**
   * Tira o contato da agenda. Devolve o que de fato aconteceu: `apagado` quando
   * não havia histórico a perder, `arquivado` quando havia conversa e a linha
   * foi só marcada. Ver a implementação em `PrismaContactRepository`.
   */
  delete(accountId: Id, contactId: Id): Promise<'apagado' | 'arquivado'>;
}

export interface ContactRepository extends ContactReader, ContactWriter {}

