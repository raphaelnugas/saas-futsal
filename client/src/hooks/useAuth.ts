import { createContext, useContext } from 'react'

export interface User {
  id: number
  name: string
  role: 'admin' | 'user'
}

export interface AuthContextType {
  user: User | null
  login: (password: string) => Promise<boolean>
  logout: () => void
  isAuthenticated: boolean
  isAdmin: boolean
  loading: boolean
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
