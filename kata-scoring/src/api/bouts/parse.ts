import { BadRequestException } from '@nestjs/common';
import type { Side } from '../../rules/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BadRequestException({ code: 'INVALID_ID', message: `${field} invalide` });
  }
  return value;
}

export function parseSide(value: unknown): Side {
  if (value === 'AKA' || value === 'AO') return value;
  throw new BadRequestException({ code: 'INVALID_SIDE', message: 'side doit valoir AKA ou AO' });
}

export function oppositeSide(side: Side): Side {
  return side === 'AKA' ? 'AO' : 'AKA';
}
