export interface AuthenticatedUserIdentity {
  userId: string;
  email: string;
  name?: string | null;
}
