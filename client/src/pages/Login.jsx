import React, { useState, useEffect } from 'react'
import { Form, Input, Button, Checkbox, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from '../services/router'
import { fetchSetupStatus, shouldRedirectToSetup } from '../services/setup'
import shibaLogo from '../assets/shiba-logo.png.png';

const Login = () => {
  const [loading, setLoading] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [form] = Form.useForm()
  const { login } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    let active = true

    fetchSetupStatus()
      .then((status) => {
        if (active && shouldRedirectToSetup(status)) navigate('/setup', { replace: true })
      })
      .catch(() => {
        // The login form remains available when the public status check fails.
      })

    return () => { active = false }
  }, [navigate])

  // 组件加载时检查是否有保存的登录信息
  useEffect(() => {
    const savedCredentials = localStorage.getItem('loginCredentials')
    if (savedCredentials) {
      try {
        const { username, remember } = JSON.parse(savedCredentials)
        form.setFieldsValue({ username })
        setRememberMe(Boolean(remember))
        localStorage.setItem('loginCredentials', JSON.stringify({ username, remember: Boolean(remember) }))
      } catch {
        localStorage.removeItem('loginCredentials')
      }
    }
  }, [form])

  const onFinish = async (values) => {
    setLoading(true)
    try {
      const result = await login(values)
      if (result.success) {
        // 如果勾选了记住我，保存登录信息
        if (rememberMe) {
          localStorage.setItem('loginCredentials', JSON.stringify({
            username: values.username,
            remember: true
          }))
        } else {
          // 如果没有勾选记住我，清除保存的信息
          localStorage.removeItem('loginCredentials')
        }
        message.success(result.message)
      } else {
        message.error(result.message)
      }
    } catch (error) {
      message.error('登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-form">
        <div className="logo-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
            <img src={shibaLogo} alt="剧柴柴 Logo" style={{ width: '43px', marginRight: '13px' }} />
            <h1 className="logo-title" style={{ margin: 0, fontSize: '27px' }}>剧柴柴-短剧本工坊</h1>
          </div>
          <p className="logo-subtitle" style={{ marginBottom: '24px' }}>解构爆款基因，为创作添薪加柴</p>
        </div>
        
        <h2 style={{ textAlign: 'center', marginBottom: '32px', color: '#262626', fontSize: '20px', fontWeight: 400 }}>
          嗨，欢迎回来~
        </h2>
        
        <Form
          form={form}
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名或邮箱' }]}
            style={{ marginBottom: '20px' }}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder="用户名/邮箱" 
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
            style={{ marginBottom: '16px' }}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="密码" 
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: '24px' }}>
            <Checkbox 
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            >
              记住我
            </Checkbox>
          </Form.Item>

          <Form.Item style={{ marginBottom: '20px' }}>
            <Button 
              type="primary" 
              htmlType="submit" 
              block 
              loading={loading}
              style={{ 
                height: 48,
                fontSize: 16,
                fontWeight: 500
              }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
        
        <div style={{ textAlign: 'center', color: '#8c8c8c', fontSize: 12 }}>
          内部系统，如需账号请联系管理员
        </div>
      </div>
    </div>
  )
}

export default Login
