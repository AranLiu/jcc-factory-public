import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Form, Input, message } from 'antd'
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate } from '../services/router'
import {
  createSubmissionLock,
  fetchSetupStatus,
  setupErrorAction,
  shouldRedirectToSetup,
  submitInitialAdmin,
} from '../services/setup'
import shibaLogo from '../assets/shiba-logo.png.png'

const FirstRunSetup = () => {
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [setupStatus, setSetupStatus] = useState(null)
  const [statusError, setStatusError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useRef(true)
  const submissionLockRef = useRef(null)

  if (!submissionLockRef.current) submissionLockRef.current = createSubmissionLock()

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const checkSetupStatus = useCallback(async () => {
    if (!mountedRef.current) return
    setChecking(true)
    setStatusError(false)
    setSetupStatus(null)
    try {
      const status = await fetchSetupStatus()
      if (!mountedRef.current) return
      if (shouldRedirectToSetup(status)) setSetupStatus(status)
      else navigate('/login', { replace: true })
    } catch {
      if (!mountedRef.current) return
      setStatusError(true)
      message.error('无法确认系统初始化状态，请稍后重试')
    } finally {
      if (mountedRef.current) setChecking(false)
    }
  }, [navigate])

  useEffect(() => {
    checkSetupStatus()
  }, [checkSetupStatus])

  const onFinish = async (values) => {
    const submissionLock = submissionLockRef.current
    if (!submissionLock.tryAcquire()) return

    setSubmitting(true)
    try {
      await submitInitialAdmin(values)
      if (!mountedRef.current) return
      message.success('管理员账号已创建，请登录')
      // API setup remains authenticated-only, so account creation always returns to login first.
      navigate('/login', { replace: true })
    } catch (error) {
      if (!mountedRef.current) return
      const action = setupErrorAction(error)
      message.error(action.message)
      if (action.redirectToLogin) {
        navigate('/login', { replace: true })
      } else if (action.refreshStatus) {
        await checkSetupStatus()
      }
    } finally {
      submissionLock.release()
      if (mountedRef.current) setSubmitting(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-form">
        <div className="logo-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <img src={shibaLogo} alt="剧柴柴 Logo" style={{ width: 43, marginRight: 13 }} />
            <h1 className="logo-title" style={{ margin: 0, fontSize: 27 }}>剧柴柴短剧本工坊</h1>
          </div>
          <p className="logo-subtitle" style={{ marginBottom: 24 }}>首次使用，请创建系统管理员账号</p>
        </div>

        <h2 style={{ textAlign: 'center', marginBottom: 32, color: '#262626', fontSize: 20, fontWeight: 400 }}>
          初始化管理员
        </h2>

        {shouldRedirectToSetup(setupStatus) ? (
        <Form form={form} name="first-run-setup" onFinish={onFinish} autoComplete="off" size="large">
          <Form.Item name="username" rules={[
            { required: true, message: '请输入用户名' },
            { min: 3, max: 50, message: '用户名长度需为 3-50 个字符' },
          ]} style={{ marginBottom: 20 }}>
            <Input prefix={<UserOutlined />} placeholder="管理员用户名" disabled={checking || submitting} />
          </Form.Item>

          <Form.Item name="password" rules={[
            { required: true, message: '请输入密码' },
            { min: 8, max: 128, message: '密码长度需为 8-128 个字符' },
          ]} style={{ marginBottom: 20 }}>
            <Input.Password prefix={<LockOutlined />} placeholder="设置密码（8-128 个字符）" disabled={checking || submitting} />
          </Form.Item>

          <Form.Item name="confirmPassword" dependencies={['password']} rules={[
            { required: true, message: '请再次输入密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue('password') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('两次输入的密码不一致'))
              },
            }),
          ]} style={{ marginBottom: 24 }}>
            <Input.Password prefix={<SafetyCertificateOutlined />} placeholder="确认密码" disabled={checking || submitting} />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={checking || submitting} style={{ height: 48, fontSize: 16, fontWeight: 500 }}>
              创建管理员账号
            </Button>
          </Form.Item>
        </Form>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <Button type={statusError ? 'primary' : 'default'} loading={checking} disabled={!statusError} onClick={checkSetupStatus}>
              {statusError ? '重试状态检查' : '正在检查初始化状态'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default FirstRunSetup
