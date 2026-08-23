/**
 * Tipos base compartilhados por todo o domínio.
 * Esta camada é pura: não importa React, Next nem infraestrutura (DIP).
 */

/** Identificador opaco de uma entidade. */
export type Id = string;

/** Data no formato ISO 8601 (sempre em UTC na fronteira do domínio). */
export type IsoDateTime = string;

/** Toda entidade pertence a uma conta (workspace) — raiz do isolamento multi-tenant. */
export interface AccountScoped {
  readonly accountId: Id;
}

export interface Entity extends AccountScoped {
  readonly id: Id;
}

/** Paginação de listagens. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Resultado explícito para operações que podem falhar sem exceção. */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string = 'DOMAIN_ERROR',
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: Id) {
    super(`${resource} não encontrado: ${id}`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Acesso negado para este recurso.') {
    super(message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

/** A operação é válida, mas o estado atual a impede (dependência, duplicidade). */
export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}
