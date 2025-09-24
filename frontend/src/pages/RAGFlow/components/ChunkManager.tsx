import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
  Tag,
  Typography
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,

  ReloadOutlined
} from '@ant-design/icons';
import { useRAGFlowStore } from '../../../stores/ragflowStore';
import type { Chunk, Document, Dataset } from '../../../types/ragflow';
import type { ColumnsType } from 'antd/es/table';

const { TextArea } = Input;
const { Text } = Typography;

interface ChunkManagerProps {
  dataset: Dataset;
  document: Document;
}

const ChunkManager: React.FC<ChunkManagerProps> = ({ dataset, document }) => {
  const {
    chunks,
    loading,
    loadChunks,
    updateChunk,
    deleteChunks
  } = useRAGFlowStore();

  const [selectedChunks, setSelectedChunks] = useState<string[]>([]);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingChunk, setEditingChunk] = useState<Chunk | null>(null);
  const [editForm] = Form.useForm();

  // 加载分块数据
  useEffect(() => {
    if (dataset?.id && document?.id) {
      loadChunks(dataset.id, document.id).catch(err => {
        message.error('加载分块失败');
        console.error(err);
      });
    }
  }, [dataset?.id, document?.id, loadChunks]);

  // 编辑分块
  const handleEdit = (chunk: Chunk) => {
    setEditingChunk(chunk);
    editForm.setFieldsValue({
      content: chunk.content,
      important_keywords: chunk.important_keywords?.join(', ') || ''
    });
    setEditModalVisible(true);
  };

  // 更新分块
  const handleUpdate = async () => {
    if (!editingChunk) return;

    try {
      const values = await editForm.validateFields();
      const params = {
        content: values.content,
        important_keywords: values.important_keywords
          ? values.important_keywords.split(',').map((kw: string) => kw.trim()).filter(Boolean)
          : []
      };

      await updateChunk(dataset.id, document.id, editingChunk.id, params);
      message.success('分块更新成功');
      setEditModalVisible(false);
      setEditingChunk(null);
      editForm.resetFields();
    } catch (error) {
      message.error('更新分块失败');
      console.error(error);
    }
  };

  // 删除分块
  const handleDelete = async (chunkIds: string[]) => {
    try {
      await deleteChunks(dataset.id, document.id, chunkIds);
      message.success('删除成功');
      setSelectedChunks([]);
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  // 刷新数据
  const handleRefresh = () => {
    loadChunks(dataset.id, document.id).catch(err => {
      message.error('刷新失败');
      console.error(err);
    });
  };

  // 表格列定义
  const columns: ColumnsType<Chunk> = [
    {
      title: '分块内容',
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
      render: (text: string) => (
        <div style={{ maxWidth: 400 }}>
          {text.length > 100 ? `${text.substring(0, 100)}...` : text}
        </div>
      ),
    },
    {
      title: '关键词',
      dataIndex: 'important_keywords',
      key: 'important_keywords',
      width: 200,
      render: (keywords: string[]) => (
        <Space wrap>
          {keywords?.slice(0, 3).map((keyword, index) => (
            <Tag key={index} color="blue">
              {keyword}
            </Tag>
          ))}
          {keywords?.length > 3 && (
            <Tag color="default">+{keywords.length - 3}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'create_time',
      key: 'create_time',
      width: 180,
      render: (time: string) => time ? new Date(time).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, record: Chunk) => (
        <Space size="small">
          <Button 
            type="text" 
            icon={<EditOutlined />} 
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确定要删除这个分块吗？"
            onConfirm={() => handleDelete([record.id])}
            okText="确定"
            cancelText="取消"
          >
            <Button 
              type="text" 
              danger 
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text strong style={{ fontSize: 16 }}>分块管理</Text>
            <br />
            <Text type="secondary">
              文档 "{document.display_name}" 的知识分块
            </Text>
          </div>
          <Space>
            <Button 
              icon={<ReloadOutlined />} 
              onClick={handleRefresh}
              loading={loading.chunks}
            >
              刷新
            </Button>
            {selectedChunks.length > 0 && (
              <Popconfirm
                title={`确定要删除选中的 ${selectedChunks.length} 个分块吗？`}
                onConfirm={() => handleDelete(selectedChunks)}
                okText="确定"
                cancelText="取消"
              >
                <Button danger icon={<DeleteOutlined />}>
                  批量删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        </div>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={chunks}
          rowKey="id"
          loading={loading.chunks}
          rowSelection={{
            selectedRowKeys: selectedChunks,
            onChange: (selectedRowKeys: React.Key[]) => setSelectedChunks(selectedRowKeys as string[]),
          }}
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
          }}
        />
      </Card>

      {/* 编辑分块模态框 */}
      <Modal
        title="编辑分块"
        open={editModalVisible}
        onOk={handleUpdate}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingChunk(null);
          editForm.resetFields();
        }}
        width={800}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            label="分块内容"
            name="content"
            rules={[{ required: true, message: '请输入分块内容' }]}
          >
            <TextArea 
              rows={8}
              placeholder="请输入分块内容"
            />
          </Form.Item>

          <Form.Item
            label="重要关键词"
            name="important_keywords"
            tooltip="多个关键词用英文逗号分隔"
          >
            <Input
              placeholder="关键词1, 关键词2, 关键词3"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ChunkManager; 