import React, { useState, useEffect } from 'react'
import api from '../services/api'
import { AuthContext, User } from '../hooks/useAuth'

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
      const normalized = (typeof password === 'string' ? password.trim().toUpperCase() : '')
      const response = await api.post('/api/auth/login', { password: normalized })
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
