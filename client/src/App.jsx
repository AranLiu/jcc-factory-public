import React, { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from './services/router'
import { message } from 'antd'
import logger from './utils/logger'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { onboardingDestination } from './services/apiOnboarding'

const Login = lazy(() => import('./pages/Login'))
const FirstRunSetup = lazy(() => import('./pages/FirstRunSetup'))
const ApiOnboarding = lazy(() => import('./pages/ApiOnboarding'))
const Workspace = lazy(() => import('./pages/Workspace'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const CharacterRegistry = lazy(() => import('./pages/CharacterRegistry'))
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'))
const UserManagement = lazy(() => import('./pages/UserManagement'))
const SystemConfig = lazy(() => import('./pages/SystemConfig'))

// 受保护的路由组件
const ProtectedRoute = ({ children, allowApiOnboarding = false, adminOnly = false }) => {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <div>加载中...</div>
  }
  
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/workspace" replace />
  if (!allowApiOnboarding && onboardingDestination(user, '/workspace') === '/setup/api') {
    return <Navigate to="/setup/api" replace />
  }
  return children
}

// 公开路由组件（已登录用户重定向）
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <div>加载中...</div>
  }
  
  return user ? <Navigate to={onboardingDestination(user, '/workspace')} replace /> : children
}

// 路由监听组件 - 只记录重要页面
const RouteLogger = () => {
  const location = useLocation()
  
  useEffect(() => {
    const pageName = getPageName(location.pathname)
    // 只记录重要页面的访问，减少日志噪音
    const importantPages = ['登录页', '工作台', '知识库', '系统配置', '用户管理']
    if (importantPages.includes(pageName)) {
      logger.pageView(pageName, location.pathname)
    }
  }, [location])
  
  return null
}

// 获取页面名称
const getPageName = (pathname) => {
  const routes = {
    '/': '工作台入口',
    '/login': '登录页',
    '/workspace': '工作台',
    '/knowledge-base': '知识库',
    '/user-management': '用户管理',
    '/system-config': '系统配置'
  }
  
  if (pathname.startsWith('/project/')) {
    return '项目详情'
  }
  
  return routes[pathname] || '未知页面'
}

function App() {
  useEffect(() => {
    logger.info('SYSTEM', '应用启动', { 
      userAgent: navigator.userAgent,
      startTime: new Date().toLocaleString('zh-CN', { hour12: false })
    })
  }, [])

  // 配置全局消息
  message.config({
    top: 100,
    duration: 3,
    maxCount: 3,
  })

  return (
    <AuthProvider>
      <RouteLogger />
      <Suspense fallback={<div>加载中...</div>}>
      <Routes>
        {/* 公开路由 */}
        <Route 
          path="/login" 
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          } 
        />

        <Route
          path="/setup"
          element={
            <PublicRoute>
              <FirstRunSetup />
            </PublicRoute>
          }
        />

        <Route
          path="/setup/api"
          element={
            <ProtectedRoute allowApiOnboarding adminOnly>
              <ApiOnboarding />
            </ProtectedRoute>
          }
        />
        
        {/* 受保护的路由 */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <Navigate to="/workspace" replace />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/workspace" 
          element={
            <ProtectedRoute>
              <Workspace />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/project/:id" 
          element={
            <ProtectedRoute>
              <ProjectDetail />
            </ProtectedRoute>
          } 
        />

        <Route
          path="/project/:id/characters"
          element={
            <ProtectedRoute>
              <CharacterRegistry />
            </ProtectedRoute>
          }
        />
        
        <Route 
          path="/knowledge-base" 
          element={
            <ProtectedRoute>
              <KnowledgeBase />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/user-management" 
          element={
            <ProtectedRoute>
              <UserManagement />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/system-config" 
          element={
            <ProtectedRoute>
              <SystemConfig />
            </ProtectedRoute>
          } 
        />
        
        {/* 默认重定向 */}
        <Route path="*" element={<Navigate to="/workspace" replace />} />
      </Routes>
      </Suspense>
    </AuthProvider>
  )
}

export default App
