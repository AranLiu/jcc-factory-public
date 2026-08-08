import React, { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'
import { applySessionSecurity, createAuthResponseErrorHandler } from '../services/httpSecurity'

const AuthContext = createContext()

// 配置axios默认设置
axios.defaults.baseURL = ''
axios.defaults.withCredentials = true
axios.interceptors.request.use(applySessionSecurity)

axios.interceptors.response.use(
  (response) => response,
  createAuthResponseErrorHandler()
)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const initAuth = async () => {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      try {
        const response = await axios.get('/api/auth/verify')
        setUser(response.data.user)
      } catch {
        setUser(null)
      } finally {
        setLoading(false)
      }
    }

    initAuth()
  }, [])

  const login = async (credentials) => {
    try {
      const response = await axios.post('/api/auth/login', credentials)
      const { user } = response.data
      setUser(user)
      
      return { success: true, message: response.data.message }
    } catch (error) {
      const message = error.response?.data?.message || '登录失败'
      return { success: false, message }
    }
  }

  const logout = async () => {
    try {
      await axios.post('/api/auth/logout')
    } finally {
      sessionStorage.clear()
      setUser(null)
    }
  }

  const markApiOnboardingComplete = () => {
    setUser((currentUser) => {
      if (!currentUser || currentUser.role !== 'admin') return currentUser
      return { ...currentUser, apiOnboardingRequired: false }
    })
  }

  const value = {
    user,
    loading,
    login,
    logout,
    markApiOnboardingComplete
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
