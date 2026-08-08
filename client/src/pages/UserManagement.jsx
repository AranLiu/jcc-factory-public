import React, { useState, useEffect } from 'react'
import { 
  Layout, 
  Button, 
  Table, 
  Modal, 
  Form, 
  Input, 
  Select, 
  message,
  Space,
  Popconfirm,
  Tag,
  Dropdown,
  Menu
} from 'antd'
import { 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined,
  ArrowLeftOutlined,
  UserOutlined,
  KeyOutlined,
  StopOutlined,
  PlayCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  MoreOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { useNavigate } from '../services/router'
import { useAuth } from '../contexts/AuthContext'
import { authAPI } from '../services/api'
import dayjs from 'dayjs'

const { Header, Content } = Layout
const { Option } = Select

const UserManagement = () => {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false)
  const [isResetPasswordModalVisible, setIsResetPasswordModalVisible] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [editingRemarks, setEditingRemarks] = useState(null) // 正在编辑备注的用户ID
  const [tempRemarks, setTempRemarks] = useState('') // 临时备注内容
  
  const [createForm] = Form.useForm()
  const [resetPasswordForm] = Form.useForm()

  useEffect(() => {
    // 检查是否是管理员
    if (user?.role !== 'admin') {
      message.error('您没有访问此页面的权限')
      navigate('/')
      return
    }
    
    loadUsers()
  }, [user, navigate])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const response = await authAPI.getUsers()
      setUsers(response.users || [])
    } catch (error) {
      message.error('加载用户列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateUser = async (values) => {
    try {
      await authAPI.createUser(values)
      message.success('用户创建成功')
      setIsCreateModalVisible(false)
      createForm.resetFields()
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || '创建用户失败')
    }
  }

  const handleResetPassword = async (values) => {
    try {
      await authAPI.resetUserPassword(selectedUser.id, values.newPassword)
      message.success('密码重置成功')
      setIsResetPasswordModalVisible(false)
      resetPasswordForm.resetFields()
      setSelectedUser(null)
    } catch (error) {
      message.error(error.response?.data?.message || '重置密码失败')
    }
  }

  const handleDeleteUser = async (userId) => {
    try {
      await authAPI.deleteUser(userId)
      message.success('用户删除成功')
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || '删除用户失败')
    }
  }

  const handleUpdateUserStatus = async (userId, status) => {
    try {
      await authAPI.updateUserStatus(userId, status)
      const action = status === 'active' ? '启用' : '停用'
      message.success(`用户${action}成功`)
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || '操作失败')
    }
  }

  const handleUpdateRemarks = async (userId, remarks) => {
    try {
      await authAPI.updateUserRemarks(userId, remarks)
      // 更新本地状态，避免重新加载整个列表
      setUsers(prevUsers => 
        prevUsers.map(user => 
          user.id === userId ? { ...user, remarks } : user
        )
      )
      // 退出编辑模式
      setEditingRemarks(null)
      setTempRemarks('')
      message.success('备注更新成功')
    } catch (error) {
      message.error(error.response?.data?.message || '更新备注失败')
    }
  }

  const startEditRemarks = (userId, currentRemarks) => {
    setEditingRemarks(userId)
    setTempRemarks(currentRemarks || '')
  }

  const cancelEditRemarks = () => {
    setEditingRemarks(null)
    setTempRemarks('')
  }

  const saveRemarks = (userId) => {
    handleUpdateRemarks(userId, tempRemarks)
  }

  const handleUpdateUserPermission = async (userId, permission) => {
    try {
      await authAPI.updateUserPermission(userId, permission)
      message.success('权限更新成功')
      loadUsers()
    } catch (error) {
      message.error(error.response?.data?.message || '权限更新失败')
    }
  }



  const getPermissionText = (permission) => {
    const map = {
      'personal': '个人',
      'readonly_global': '全局只读',
      'global': '全局'
    }
    return map[permission] || permission
  }

  const getPermissionColor = (permission) => {
    const map = {
      'personal': 'default',
      'readonly_global': 'processing',
      'global': 'success'
    }
    return map[permission] || 'default'
  }

  const showResetPasswordModal = (user) => {
    setSelectedUser(user)
    setIsResetPasswordModalVisible(true)
  }

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text) => <Space><UserOutlined />{text}</Space>
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email'
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role) => (
        <Tag color={role === 'admin' ? 'red' : 'blue'}>
          {role === 'admin' ? '管理员' : '普通用户'}
        </Tag>
      )
    },
    {
      title: '权限',
      dataIndex: 'permission',
      key: 'permission',
      render: (permission) => (
        <Tag color={getPermissionColor(permission)}>
          {getPermissionText(permission)}
        </Tag>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => (
        <Tag color={status === 'active' ? 'green' : 'volcano'}>
          {status === 'active' ? '启用' : '停用'}
        </Tag>
      )
    },
    {
      title: '项目数量',
      dataIndex: 'project_count',
      key: 'project_count',
      render: (count) => count || 0
    },
    {
      title: '知识库条目',
      dataIndex: 'kb_count',
      key: 'kb_count',
      render: (count) => count || 0
    },
    {
      title: '备注',
      dataIndex: 'remarks',
      key: 'remarks',
      width: 250,
      render: (remarks, record) => {
        const isEditing = editingRemarks === record.id
        
        return (
          <div style={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>
            {isEditing ? (
              <>
                <Input.TextArea
                  value={tempRemarks}
                  onChange={(e) => setTempRemarks(e.target.value)}
                  placeholder="请输入备注..."
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  style={{ flex: 1, marginRight: 8 }}
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button
                    type="link"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={() => saveRemarks(record.id)}
                    style={{ color: '#52c41a', padding: 4 }}
                    title="保存"
                  />
                  <Button
                    type="link"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={cancelEditRemarks}
                    style={{ color: '#ff4d4f', padding: 4 }}
                    title="取消"
                  />
                </div>
              </>
            ) : (
              <>
                <div style={{ 
                  flex: 1, 
                  padding: '4px 0',
                  minHeight: 24,
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  {remarks ? (
                    <span style={{ color: '#333' }}>{remarks}</span>
                  ) : (
                    <span style={{ color: '#bbb', fontStyle: 'italic' }}>暂无备注</span>
                  )}
                </div>
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => startEditRemarks(record.id, remarks)}
                  style={{ color: '#999', padding: 4, opacity: 0.6 }}
                  title="编辑备注"
                />
              </>
            )}
          </div>
        )
      }
    },
    {
      title: '修改时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (time) => dayjs(time).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      render: (_, record) => {
        const menuItems = [
          {
            key: 'resetPassword',
            label: '重置密码',
            icon: <KeyOutlined />,
            onClick: () => showResetPasswordModal(record)
          },
          {
            key: 'permission',
            label: '管理权限',
            icon: <SettingOutlined />,
            children: [
              {
                key: 'personal',
                label: '个人权限',
                onClick: () => handleUpdateUserPermission(record.id, 'personal')
              },
              {
                key: 'readonly_global',
                label: '全局只读权限',
                onClick: () => handleUpdateUserPermission(record.id, 'readonly_global')
              },
              {
                key: 'global',
                label: '全局权限',
                onClick: () => handleUpdateUserPermission(record.id, 'global')
              }
            ]
          }
        ]

        // 如果不是当前用户，添加启用/停用和删除选项
        if (record.id !== user?.id) {
          menuItems.push({
            key: 'status',
            label: record.status === 'active' ? '停用账号' : '启用账号',
            icon: record.status === 'active' ? <StopOutlined /> : <PlayCircleOutlined />,
            onClick: () => handleUpdateUserStatus(record.id, record.status === 'active' ? 'inactive' : 'active')
          })

          if (record.project_count > 0 || record.kb_count > 0) {
            menuItems.push({
              key: 'delete',
              label: '删除用户',
              icon: <DeleteOutlined />,
              disabled: true,
              title: `该用户有 ${record.project_count} 个项目和 ${record.kb_count} 个知识库条目，无法删除`
            })
          } else {
            menuItems.push({
              key: 'delete',
              label: '删除用户',
              icon: <DeleteOutlined />,
              danger: true,
              onClick: () => {
                Modal.confirm({
                  title: '确定要删除这个用户吗？',
                  content: '该用户没有关联的项目和知识库数据，删除后无法恢复。',
                  onOk: () => handleDeleteUser(record.id),
                  okText: '确定',
                  cancelText: '取消'
                })
              }
            })
          }
        }
        
        return (
          <Dropdown 
            menu={{ items: menuItems }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button 
              type="link" 
              icon={<MoreOutlined />}
              style={{ padding: 4 }}
            />
          </Dropdown>
        )
      }
    }
  ]

  return (
    <Layout className="workspace-layout" style={{ minHeight: '100vh' }}>
      <Header className="workspace-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Button 
            icon={<ArrowLeftOutlined />} 
            onClick={() => navigate('/workspace')}
            style={{ marginRight: 16 }}
          >
            返回工作台
          </Button>
          <h3 style={{ margin: 0, color: 'white' }}>用户管理</h3>
        </div>
        <div className="header-right">
          <span style={{ color: '#000', marginRight: 16 }}>👋 {user?.username}</span>
          <Button type="link" onClick={logout} style={{ color: '#000' }}>退出</Button>
        </div>
      </Header>

      <Content className="workspace-content">
        <div style={{ marginBottom: 24 }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: 16 
          }}>
            <div>
              <h2 style={{ margin: 0, marginBottom: 8 }}>用户管理</h2>
              <p style={{ color: '#666', margin: 0 }}>
                管理系统用户账号，创建新用户和重置密码。
              </p>
            </div>
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => setIsCreateModalVisible(true)}
            >
              新建用户
            </Button>
          </div>
        </div>

        <Table 
          columns={columns}
          dataSource={users}
          loading={loading}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 个用户`
          }}
        />

        {/* 创建用户弹窗 */}
        <Modal
          title="创建新用户"
          open={isCreateModalVisible}
          onCancel={() => {
            setIsCreateModalVisible(false)
            createForm.resetFields()
          }}
          footer={null}
          width={500}
        >
          <Form
            form={createForm}
            layout="vertical"
            onFinish={handleCreateUser}
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[
                { required: true, message: '请输入用户名' },
                { min: 3, message: '用户名至少3个字符' },
                { max: 20, message: '用户名最多20个字符' }
              ]}
            >
              <Input placeholder="请输入用户名" />
            </Form.Item>
            
            <Form.Item
              name="email"
              label="邮箱（可选）"
              rules={[
                { type: 'email', message: '请输入有效的邮箱地址' }
              ]}
            >
              <Input placeholder="选填；项目未接入邮件验证" />
            </Form.Item>

            <Form.Item
              name="password"
              label="初始密码"
              rules={[
                { required: true, message: '请输入初始密码' },
                { min: 8, max: 128, message: '密码长度需为 8-128 个字符' }
              ]}
            >
              <Input.Password placeholder="请输入初始密码" />
            </Form.Item>

            <Form.Item
              name="role"
              label="用户角色"
              initialValue="user"
              rules={[{ required: true, message: '请选择用户角色' }]}
            >
              <Select placeholder="请选择用户角色">
                <Option value="user">普通用户</Option>
                <Option value="admin">管理员</Option>
              </Select>
            </Form.Item>

            <Form.Item
              name="permission"
              label="用户权限"
              initialValue="personal"
              rules={[{ required: true, message: '请选择用户权限' }]}
            >
              <Select placeholder="请选择用户权限">
                <Option value="personal">个人权限</Option>
                <Option value="readonly_global">全局只读权限</Option>
                <Option value="global">全局权限</Option>
              </Select>
            </Form.Item>

            <Form.Item
              name="remarks"
              label="备注"
            >
              <Input.TextArea 
                placeholder="请输入用户备注（可选）" 
                autoSize={{ minRows: 2, maxRows: 4 }}
              />
            </Form.Item>

            <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
              <Space>
                <Button onClick={() => {
                  setIsCreateModalVisible(false)
                  createForm.resetFields()
                }}>
                  取消
                </Button>
                <Button type="primary" htmlType="submit">
                  创建
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Modal>

        {/* 重置密码弹窗 */}
        <Modal
          title={`重置密码 - ${selectedUser?.username}`}
          open={isResetPasswordModalVisible}
          onCancel={() => {
            setIsResetPasswordModalVisible(false)
            resetPasswordForm.resetFields()
            setSelectedUser(null)
          }}
          footer={null}
          width={400}
        >
          <Form
            form={resetPasswordForm}
            layout="vertical"
            onFinish={handleResetPassword}
          >
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, max: 128, message: '密码长度需为 8-128 个字符' }
              ]}
            >
              <Input.Password placeholder="请输入新密码" />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请确认新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password placeholder="请再次输入新密码" />
            </Form.Item>

            <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
              <Space>
                <Button onClick={() => {
                  setIsResetPasswordModalVisible(false)
                  resetPasswordForm.resetFields()
                  setSelectedUser(null)
                }}>
                  取消
                </Button>
                <Button type="primary" htmlType="submit">
                  重置密码
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  )
}

export default UserManagement
