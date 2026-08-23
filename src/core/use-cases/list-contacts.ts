import type { Contact } from '../domain/contact';
import type { Id } from '../domain/shared';
import type { ContactFilter, ContactReader } from '../ports/contact-repository';

export const createListContacts =
  (repository: ContactReader) =>
  async (accountId: Id, filter?: ContactFilter): Promise<readonly Contact[]> => {
    const contacts = await repository.list(accountId, filter);
    const term = filter?.search?.trim().toLowerCase() ?? '';
    if (!term) return contacts;

    return contacts.filter((contact) =>
      [contact.name, contact.email ?? '', contact.company ?? '', contact.phone]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  };
