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
  Dropdown,
  Menu,
  Tooltip
} from 'antd'
import { 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined,
  FolderOpenOutlined,
  BookOutlined
} from '@ant-design/icons'
import { useNavigate, useLocation } from '../services/router'
import { useAuth } from '../contexts/AuthContext'
import { projectAPI, authAPI } from '../services/api'
import dayjs from 'dayjs'
import ProjectEmptyState from '../components/ProjectEmptyState'

const { Header, Content } = Layout
const { TextArea } = Input

const ChangePasswordModal = ({ visible, onCancel, onFinish }) => {
  const [form] = Form.useForm();
  return (
    <Modal
      title="修改密码"
      open={visible}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="确认"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" onFinish={onFinish} name="change_password_workspace">
        <Form.Item
          name="oldPassword"
          label="旧密码"
          rules={[{ required: true, message: '请输入您的旧密码' }]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入您的新密码' },
            { min: 8, max: 128, message: '密码长度需为 8-128 位' }
          ]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入您的新密码' },
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
          <Input.Password />
        </Form.Item>
      </Form>
    </Modal>
  );
};

const Workspace = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingProject, setEditingProject] = useState(null)
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [owners, setOwners] = useState([])
  
  const [form] = Form.useForm()
  
  const defaultProjectType = location.state?.projectType || 'video'

  useEffect(() => {
    loadProjects()
  }, [statusFilter, ownerFilter])

  useEffect(() => {
    const fetchOwners = async () => {
      if (user?.permission === 'global' || user?.permission === 'readonly_global' || user?.role === 'admin') {
        try {
          const res = await authAPI.getUsers()
          setOwners((res && res.users) || [])
        } catch { /* ignore */ }
      }
    }
    fetchOwners()
  }, [user])

  const loadProjects = async () => {
    setLoading(true)
    try {
      const params = {}
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter
      if ((user?.permission === 'global' || user?.permission === 'readonly_global' || user?.role === 'admin') && ownerFilter !== 'all') {
        params.ownerId = ownerFilter
      }
      const response = await projectAPI.getList(params)
      const list = Array.isArray(response.projects) ? response.projects.slice() : []
      const weight = { in_progress: 0, not_started: 1, completed: 2 }
      list.sort((a, b) => {
        const wa = weight[a.status?.trim?.() || 'not_started'] ?? 9
        const wb = weight[b.status?.trim?.() || 'not_started'] ?? 9
        if (wa !== wb) return wa - wb
        const ta = a.last_operation_at ? new Date(a.last_operation_at).getTime() : 0
        const tb = b.last_operation_at ? new Date(b.last_operation_at).getTime() : 0
        return tb - ta
      })
      setProjects(list)
    } catch (error) {
      message.error('加载项目列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleShowModal = (project = null) => {
    if (project) {
      setIsEditing(true)
      setEditingProject(project)
      form.setFieldsValue(project)
    } else {
      setIsEditing(false)
      setEditingProject(null)
      form.resetFields()
      form.setFieldsValue({ type: defaultProjectType })
    }
    setIsModalVisible(true)
  }

  const handleCancel = () => {
    setIsModalVisible(false)
    form.resetFields()
  }

  const handleFormSubmit = async (values) => {
    const dataToSubmit = {
      ...values,
      type: values.type || defaultProjectType,
      status: values.status || 'not_started'
    };

    try {
      if (isEditing) {
        await projectAPI.update(editingProject.id, dataToSubmit)
        message.success('项目更新成功')
      } else {
        await projectAPI.create(dataToSubmit)
        message.success('项目创建成功')
      }
      setIsModalVisible(false)
      loadProjects()
    } catch (error) {
      message.error(isEditing ? '更新失败' : '创建失败')
    }
  }

  const handleDeleteProject = async (id) => {
    try {
      await projectAPI.delete(id)
      message.success('项目删除成功')
      loadProjects()
    } catch (error) {
      message.error('项目删除失败')
    }
  }

  const handleChangePassword = async (values) => {
    try {
      await authAPI.changePassword(values);
      message.success('密码修改成功');
      setPasswordModalVisible(false);
    } catch (error) {
      message.error(error.response?.data?.message || '密码修改失败');
    }
  };

  const handleMenuClick = ({ key }) => {
    if (key === 'logout') {
      logout();
    } else if (key === 'changePassword') {
      setPasswordModalVisible(true);
    } else if (key === 'userManagement') {
      navigate('/user-management');
    } else if (key === 'systemConfig') {
      navigate('/system-config');
    }
  };

  const menu = (
    <Menu onClick={handleMenuClick}>
      {user?.role === 'admin' && (
        <Menu.Item key="userManagement">用户管理</Menu.Item>
      )}
      {user?.role === 'admin' && (
        <Menu.Item key="systemConfig">系统配置</Menu.Item>
      )}
      <Menu.Item key="changePassword">修改密码</Menu.Item>
      <Menu.Item key="logout">退出</Menu.Item>
    </Menu>
  );

  const renderStatusTag = (status) => {
    const map = {
      not_started: { color: '#bfbfbf', text: '未开始' },
      in_progress: { color: '#fa8c16', text: '进行中' },
      completed: { color: '#52c41a', text: '已完成' }
    }
    const normalized = (status || 'not_started').trim()
    const item = map[normalized] || map.not_started
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#595959' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: item.color, display: 'inline-block' }} />
        {item.text}
      </span>
    )
  }

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: {
        showTitle: false,
      },
      render: (text, record) => (
        <Tooltip title={text} placement="topLeft">
          <Button 
            type="link" 
            icon={<FolderOpenOutlined />}
            onClick={() => navigate(`/project/${record.id}`)}
            style={{ 
              padding: 0,
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%',
              display: 'block'
            }}
          >
            {text}
          </Button>
        </Tooltip>
      )
    },
    {
      title: '项目描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    // 只有全局权限用户才显示项目所有者列
    ...(user?.permission === 'global' || user?.permission === 'readonly_global' ? [{
      title: '项目所有者',
      dataIndex: 'owner_name',
      key: 'owner_name',
      render: (name) => name || '未知'
    }] : []),
    {
      title: '项目状态',
      dataIndex: 'status',
      key: 'status',
      render: (s, record) => {
        const items = [
          { key: 'not_started', label: renderStatusTag('not_started') },
          { key: 'in_progress', label: renderStatusTag('in_progress') },
          { key: 'completed', label: renderStatusTag('completed') },
        ]
        return (
          <Dropdown
            trigger={["click"]}
            menu={{
              items,
              onClick: async ({ key }) => {
                try {
                  await projectAPI.update(record.id, { status: key })
                  message.success('状态已更新')
                  loadProjects()
                } catch (e) {
                  message.error('状态更新失败')
                }
              }
            }}
          >
            <div style={{ cursor: 'pointer' }}>{renderStatusTag(s)}</div>
          </Dropdown>
        )
      }
    },
    {
      title: '文件数量',
      dataIndex: 'file_count',
      key: 'file_count',
      render: (count) => count || 0
    },
    {
      title: '最后操作',
      key: 'last_operation',
      render: (record) => {
        const timeText = record.last_operation_at ? dayjs(record.last_operation_at).format('YYYY-MM-DD HH:mm') : '未知'
        const byText = record.last_operator_name ? ` 由 ${record.last_operator_name}` : ' 由未知用户'
        return `${timeText}${byText}`
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => {
        // 根据权限决定是否显示编辑和删除按钮
        const userPermission = user?.permission || 'personal'; // NULL视为personal权限
        
        // 权限检查：确保数据类型一致的比较
        const isOwner = Number(record.user_id) === Number(user?.id);
        
        const canEdit = userPermission === 'global' || 
                       ((userPermission === 'personal' || userPermission === 'readonly_global') && isOwner);
        
        const canDelete = userPermission === 'global' || 
                         ((userPermission === 'personal' || userPermission === 'readonly_global') && isOwner);
        
        return (
          <Space>
            {canEdit && (
              <Button 
                type="link" 
                icon={<EditOutlined />}
                onClick={() => handleShowModal(record)}
              >
                编辑
              </Button>
            )}
            {canDelete && (
              <Popconfirm
                title="确定要删除这个项目吗？"
                description="删除后无法恢复，相关文件也会被删除。"
                onConfirm={() => handleDeleteProject(record.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button 
                  type="link" 
                  danger 
                  icon={<DeleteOutlined />}
                >
                  删除
                </Button>
              </Popconfirm>
            )}
            {!canEdit && !canDelete && (
              <span style={{ color: '#999', fontStyle: 'italic' }}>只读</span>
            )}
          </Space>
        )
      }
    }
  ]

  return (
    <Layout className="workspace-layout" style={{ minHeight: '100vh' }}>
      <Header className="workspace-header">
        <div>
          <Button 
            icon={<BookOutlined />} 
            onClick={() => navigate('/knowledge-base')}
          >
            知识库
          </Button>
        </div>
        <div className="header-right">
          <Dropdown overlay={menu} trigger={['click']}>
            <Button type="link" className="user-menu-button">
              👋 {user?.username}
            </Button>
          </Dropdown>
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
              <h2 style={{ margin: 0, marginBottom: 8 }}>短剧项目工作台</h2>
              <p style={{ color: '#666', margin: 0 }}>
                从分集视频上传开始，集中查看解析、图谱和剧本整理进度。
              </p>
            </div>
            <Space>
              {(user?.permission === 'global' || user?.permission === 'readonly_global' || user?.role === 'admin') && (
                <Select
                  size="small"
                  style={{ width: 160 }}
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  placeholder="项目所有者"
                >
                  <Select.Option value="all">全部所有者</Select.Option>
                  {owners.map(u => (
                    <Select.Option key={u.id} value={u.id}>{u.username}</Select.Option>
                  ))}
                </Select>
              )}
              <Select
                size="small"
                style={{ width: 140 }}
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="项目状态"
              >
                <Select.Option value="all">全部状态</Select.Option>
                <Select.Option value="not_started">未开始</Select.Option>
                <Select.Option value="in_progress">进行中</Select.Option>
                <Select.Option value="completed">已完成</Select.Option>
              </Select>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => handleShowModal()}
              >
                新建短剧项目
              </Button>
            </Space>
          </div>
        </div>

        <Table 
          columns={columns}
          dataSource={projects}
          loading={loading}
          rowKey="id"
          locale={{
            emptyText: <ProjectEmptyState onCreate={() => handleShowModal()} />
          }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 个项目`
          }}
        />

        <Modal
          title={isEditing ? '编辑项目' : '创建新项目'}
          open={isModalVisible}
          onCancel={handleCancel}
          footer={null}
          width={500}
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={handleFormSubmit}
          >
            <Form.Item
              name="name"
              label="项目名称"
              rules={[{ required: true, message: '请输入项目名称' }]}
            >
              <Input placeholder="请输入项目名称" />
            </Form.Item>
            
            <Form.Item
              name="description"
              label="项目描述"
            >
              <TextArea rows={4} placeholder="请输入项目描述（可选）" />
            </Form.Item>

            <Form.Item name="type" hidden>
              <Input />
            </Form.Item>

            {/* 状态默认未开始，不在弹窗中编辑 */}

            <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
              <Space>
                <Button onClick={handleCancel}>取消</Button>
                <Button type="primary" htmlType="submit">
                  {isEditing ? '保存' : '创建'}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Modal>
        <ChangePasswordModal
          visible={passwordModalVisible}
          onCancel={() => setPasswordModalVisible(false)}
          onFinish={handleChangePassword}
        />
      </Content>
    </Layout>
  )
}

export default Workspace
