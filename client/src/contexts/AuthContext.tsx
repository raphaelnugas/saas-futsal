import React, { createContext, useContext, useState, useEffect } from 'react'
import api from '../services/api'

interface User {
  id: number
  name: string
  role: 'admin' | 'user'
}

interface AuthContextType {
  user: User | null
  login: (password: string) => Promise<boolean>
  logout: () => void
  isAuthenticated: boolean
  isAdmin: boolean
  loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('token')
      if (token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`
        const verify = await api.get('/api/auth/verify')
        if (verify.data?.valid) {
          const role = verify.data?.user?.role === 'admin' ? 'admin' : 'user'
          setUser({ id: 1, name: 'Admin', role })
        } else {
          localStorage.removeItem('token')
          delete api.defaults.headers.common['Authorization']
        }
      }
    } catch (error) {
      localStorage.removeItem('token')
      delete api.defaults.headers.common['Authorization']
    } finally {
      setLoading(false)
    }
  }

  const login = async (password: string): Promise<boolean> => {
    try {
      const response = await api.post('/api/auth/login', { password })
      const { token, user: u } = response.data
      
      localStorage.setItem('token', token)
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
      const role = u?.role === 'admin' ? 'admin' : 'user'
      setUser({ id: 1, name: 'Admin', role })
      
      return true
    } catch (error) {
      return false
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    delete api.defaults.headers.common['Authorization']
    setUser(null)
  }

  const value = {
    user,
    login,
    logout,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    loading
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
