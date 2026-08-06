import type { Role } from '@slm/shared-types';

export interface RequestUser {
  id: string;
  email: string;
  role: Role;
}
