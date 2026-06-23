import React from 'react';
import type { AuthUser } from '@/src/types';

const AuthUserContext = React.createContext<AuthUser | null>(null);

export function AuthUserProvider({
  value,
  children,
}: {
  value: AuthUser | null;
  children: React.ReactNode;
}) {
  return <AuthUserContext.Provider value={value}>{children}</AuthUserContext.Provider>;
}

export function useAuthUser() {
  return React.useContext(AuthUserContext);
}
