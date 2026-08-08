import React from 'react'
import { Button, Empty, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'

const { Paragraph } = Typography

const ProjectEmptyState = ({ onCreate }) => (
  <Empty
    image={Empty.PRESENTED_IMAGE_SIMPLE}
    description={
      <div>
        <div style={{ color: '#262626', fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
          还没有短剧项目
        </div>
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          先创建项目，再上传分集视频进行批量解析和剧本整理。
        </Paragraph>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          创建短剧项目
        </Button>
      </div>
    }
  />
)

export default ProjectEmptyState
