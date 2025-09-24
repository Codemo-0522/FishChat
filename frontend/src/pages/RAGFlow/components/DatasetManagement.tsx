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
  Typography,
  Tag,
  Tooltip,
  Badge,
  Popconfirm,
  Select,
  Drawer,
  Checkbox,
  Divider
} from 'antd';
import {
  DatabaseOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  ExperimentOutlined
} from '@ant-design/icons';
import { useRAGFlowStore } from '../../../stores/ragflowStore';
import type { Dataset, CreateDatasetParams, UpdateDatasetParams } from '../../../types/ragflow';
import DocumentManager from './DocumentManager';
import type { ColumnsType } from 'antd/es/table';
import { ragflowService } from '../../../services/ragflow';
import styles from '../RAGFlowManage.module.css';

const { TextArea } = Input;
const { Title, Text } = Typography;
const { Option } = Select;

const DatasetManagement: React.FC = () => {
  const {
    datasets,
    currentDataset,
    loading,
    loadDatasets,
    createDataset,
    updateDataset,
    deleteDatasets,
    setCurrentDataset
  } = useRAGFlowStore();

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [detailDrawerVisible, setDetailDrawerVisible] = useState(false);
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  
  // 嵌入模型相关状态
  const [embeddingModels, setEmbeddingModels] = useState<any[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // 分块方法选项
  const chunkMethods = [
    { value: 'naive', label: '通用分块' },
    { value: 'manual', label: '手动分块' },
    { value: 'qa', label: '问答分块' },
    { value: 'table', label: '表格分块' },
    { value: 'paper', label: '论文分块' },
    { value: 'book', label: '书籍分块' },
    { value: 'laws', label: '法律分块' },
    { value: 'presentation', label: '演示文稿分块' },
    { value: 'picture', label: '图片分块' },
    { value: 'one', label: '一个分块' },
    { value: 'knowledge_graph', label: '知识图谱分块' },
    { value: 'email', label: '邮件分块' }
  ];

  // 初始化加载数据集
  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  // 只在创建知识库时获取嵌入模型列表
  const loadEmbeddingModelsForCreate = async () => {
    console.log('[调试] 开始加载嵌入模型，当前模型数量:', embeddingModels.length);
    if (embeddingModels.length > 0) {
      console.log('[调试] 模型已加载，跳过');
      return; // 已加载过则不重复加载
    }
    
    setLoadingModels(true);
    try {
      console.log('[调试] 调用 ragflowService.getEmbeddingModels()');
      const response = await ragflowService.getEmbeddingModels();
      console.log('[调试] API响应:', response);
      
      if (!response.models || response.models.length === 0) {
        console.log('[调试] 未找到嵌入模型');
        message.warning('未找到已配置的嵌入模型。请先在RAGFlow中配置嵌入模型。');
        setEmbeddingModels([]);
        return;
      }
      
      const modelOptions = response.models.map((model: any) => ({
        id: model.id,
        value: model.id,
        label: model.name,
        description: model.description,
        recommended: model.recommended,
        verified: model.verified || false,
        builtin: model.builtin || false,
        provider: model.provider,
        language: model.language || []
      }));
      
      console.log('[调试] 处理后的模型选项:', modelOptions);
      setEmbeddingModels(modelOptions);
      
      // 显示验证状态信息
      const verifiedCount = response.verified_count || 0;
      if (verifiedCount > 0) {
        message.success(`已加载 ${verifiedCount} 个已验证的嵌入模型`);
      }
      
    } catch (error) {
      console.error('[调试] 获取嵌入模型列表失败:', error);
      message.error('获取嵌入模型列表失败，请检查RAGFlow服务状态');
    } finally {
      setLoadingModels(false);
    }
  };

  // 处理创建知识库
  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      
      // 构建参数
      let datasetName = values.name;
      if (values.addTimestamp) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        datasetName = `${datasetName}_${timestamp}`;
      }

      const params: CreateDatasetParams = {
        name: datasetName,
        description: values.description || '',
        embedding_model: values.embedding_model || undefined, // 空字符串时传递undefined，让后端使用默认模型
        permission: values.permission,
        chunk_method: values.chunk_method
      };

      await createDataset(params);
      message.success('知识库创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      // 重置后设置默认值为"使用系统默认模型"
      createForm.setFieldsValue({
        embedding_model: "",
        permission: 'me',
        chunk_method: 'naive'
      });
      loadDatasets(); // 刷新知识库列表
    } catch (error) {
      message.error('创建知识库失败');
      console.error(error);
    }
  };

  // 处理编辑知识库
  const handleEdit = (dataset: Dataset) => {
    setEditingDataset(dataset);
    editForm.setFieldsValue({
      name: dataset.name,
      description: dataset.description,
      permission: dataset.permission
    });
    setEditModalVisible(true);
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    try {
      const values = await editForm.validateFields();
      if (!editingDataset) return;

      const params: UpdateDatasetParams = {
        name: values.name,
        description: values.description,
        permission: values.permission
      };

      await updateDataset(editingDataset.id, params);
      message.success('知识库更新成功');
      setEditModalVisible(false);
      setEditingDataset(null);
      editForm.resetFields();
    } catch (error) {
      message.error('更新知识库失败');
      console.error(error);
    }
  };

  // 处理查看详情
  // 处理查看详情（抽屉）
  const handleViewDetail = (dataset: Dataset) => {
    setCurrentDataset(dataset);
    setDetailDrawerVisible(true);
  };

  // 处理进入知识库
  const handleEnterDataset = (dataset: Dataset) => {
    // 这里可以导航到知识库详情页面
    // 或者打开知识库的聊天界面
    console.log('进入知识库:', dataset);
    
    // 检查是否有可用的聊天组件或页面
    if (window.location.pathname.includes('/ragflow')) {
      // 如果已经在RAGFlow页面，可以尝试打开聊天界面
      // 这里可以添加具体的导航逻辑
      message.success(`正在进入知识库: ${dataset.name}`);
      
      // 临时方案：显示知识库信息
      setCurrentDataset(dataset);
      setDetailDrawerVisible(true);
    } else {
      // 如果不在RAGFlow页面，提示用户
      message.info(`请在RAGFlow页面中进入知识库: ${dataset.name}`);
    }
  };

  // 处理删除知识库
  const handleDelete = async (datasetIds: string[]) => {
    try {
      await deleteDatasets(datasetIds);
      message.success(`成功删除 ${datasetIds.length} 个知识库`);
      setSelectedDatasets([]);
    } catch (error) {
      message.error('删除知识库失败');
      console.error(error);
    }
  };

  // 处理批量删除
  const handleBatchDelete = () => {
    if (selectedDatasets.length === 0) {
      message.warning('请先选择要删除的知识库');
      return;
    }
    handleDelete(selectedDatasets);
  };

  // 表格行选择配置
  const rowSelection = {
    selectedRowKeys: selectedDatasets,
    onChange: (selectedRowKeys: React.Key[]) => {
      setSelectedDatasets(selectedRowKeys as string[]);
    },
  };

  // 表格列配置
  const columns: ColumnsType<Dataset> = [
    {
      title: '知识库名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (text: string, record: Dataset) => (
        <div className="flex items-center gap-2">
          <DatabaseOutlined className="text-blue-500" />
          <Button
            type="link"
            className="p-0 h-auto font-medium text-blue-600 hover:text-blue-800"
            onClick={(e) => {
              e.stopPropagation();
              handleEnterDataset(record);
            }}
          >
            {text}
          </Button>
          {record.permission === 'team' && (
            <Tag color="blue">团队</Tag>
          )}
        </div>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => (
        <Text type="secondary" className="text-sm">
          {text || '暂无描述'}
        </Text>
      ),
    },
    {
      title: '嵌入模型',
      dataIndex: 'embedding_model',
      key: 'embedding_model',
      width: 200,
      render: (model: string) => {
        if (!model || model.trim() === '') {
          return (
            <Tooltip title="使用系统默认模型">
              <Tag color="blue" className="max-w-full truncate">
                🔄 系统默认模型
              </Tag>
            </Tooltip>
          );
        }
        return (
          <Tooltip title={model}>
            <Tag color="green" className="max-w-full truncate">
              {model.split('@')[0] || model}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '文档数',
      dataIndex: 'document_count',
      key: 'document_count',
      width: 80,
      render: (count: number) => (
        <Badge count={count} showZero style={{ backgroundColor: '#52c41a' }} />
      ),
    },
    {
      title: '分块数',
      dataIndex: 'chunk_count',
      key: 'chunk_count',
      width: 80,
      render: (count: number) => (
        <Badge count={count} showZero style={{ backgroundColor: '#1890ff' }} />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'create_time',
      key: 'create_time',
      width: 180,
      render: (time: string) => (
        <Text type="secondary" className="text-sm">
          {time ? new Date(time).toLocaleString('zh-CN') : '-'}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record: Dataset) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button
              type="text"
              icon={<EyeOutlined />}
              size="small"
              onClick={() => handleViewDetail(record)}
            />
          </Tooltip>
          <Tooltip title="编辑">
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="确定要删除这个知识库吗？"
            description="删除后无法恢复，请谨慎操作。"
            onConfirm={() => handleDelete([record.id])}
            okText="删除"
            cancelText="取消"
            okType="danger"
          >
            <Tooltip title="删除">
              <Button
                type="text"
                icon={<DeleteOutlined />}
                size="small"
                danger
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 简化的嵌入模型选择器
  const renderEmbeddingModelSelect = (props?: any) => (
    <Select
      {...props}
      className="w-full"
      placeholder={embeddingModels.length === 0 ? "暂无可用的嵌入模型" : "选择嵌入模型或使用系统默认"}
      loading={loadingModels}
      disabled={embeddingModels.length === 0}
      onDropdownVisibleChange={(open) => {
        if (open) {
          loadEmbeddingModelsForCreate();
        }
      }}
      notFoundContent={embeddingModels.length === 0 ? "未找到可用的嵌入模型，请先在RAGFlow中配置" : "暂无数据"}
      optionLabelProp="label"
      maxTagCount={1}
      maxTagTextLength={20}
      style={{ width: '100%' }}
      allowClear
    >
      {/* 添加"使用系统默认模型"选项 */}
      <Option value="" label="使用系统默认模型">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">🔄 使用系统默认模型</span>
          <Tag color="blue">推荐</Tag>
        </div>
      </Option>
      
      {/* 分隔线 */}
      <Option disabled>
        <Divider style={{ margin: '4px 0' }} />
      </Option>
      
      {embeddingModels
        .sort((a, b) => {
          // 优先显示已验证的模型
          if (a.verified && !b.verified) return -1;
          if (!a.verified && b.verified) return 1;
          // 其次显示推荐的模型
          if (a.recommended && !b.recommended) return -1;
          if (!a.recommended && b.recommended) return 1;
          // 按名称排序
          return a.label.localeCompare(b.label);
        })
        .map((model) => (
          <Option key={model.id} value={model.id} label={model.label}>
            <div className="flex items-center justify-between min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="truncate">{model.label}</span>
                <span className="text-xs text-gray-500 flex-shrink-0">({model.provider})</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {model.verified && (
                  <Tag color="green">已验证</Tag>
                )}
                {model.recommended && (
                  <Tag color="gold">推荐</Tag>
                )}
              </div>
            </div>
          </Option>
        ))}
    </Select>
  );

  return (
    <div className="p-6">
      <Card
        title={
          <div className="flex items-center gap-2">
            <DatabaseOutlined className="text-blue-500" />
            <Title level={4} className="mb-0">知识库管理</Title>
          </div>
        }
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={async () => {
                setCreateModalVisible(true);
                createForm.resetFields();
                // 设置默认值为"使用系统默认模型"
                createForm.setFieldsValue({
                  embedding_model: "",
                  permission: 'me',
                  chunk_method: 'naive'
                });
                // 预加载嵌入模型列表，避免下拉框被禁用
                await loadEmbeddingModelsForCreate();
              }}
            >
              创建知识库
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => loadDatasets()}
              loading={loading.datasets}
            >
              刷新
            </Button>
            {selectedDatasets.length > 0 && (
              <Popconfirm
                title={`确定要删除选中的 ${selectedDatasets.length} 个知识库吗？`}
                description="删除后无法恢复，请谨慎操作。"
                onConfirm={handleBatchDelete}
                okText="删除"
                cancelText="取消"
                okType="danger"
              >
                <Button danger icon={<DeleteOutlined />}>
                  批量删除 ({selectedDatasets.length})
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={datasets}
          rowKey="id"
          loading={loading.datasets}
          onRow={(record) => ({
            onClick: (e) => {
              // 检查点击的是否是按钮或链接，如果是则不触发行点击
              const target = e.target as HTMLElement;
              if (target.closest('button') || target.closest('a') || target.closest('.ant-btn')) {
                return;
              }
              handleViewDetail(record);
            },
            style: { cursor: 'pointer' }
          })}
          pagination={{
            total: datasets.length,
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `第 ${range[0]}-${range[1]} 条，共 ${total} 条记录`,
          }}
          size="middle"
        />
      </Card>

      {/* 创建知识库模态框 */}
      <Modal
        title="创建知识库"
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
          // 重置后设置默认值为"使用系统默认模型"
          createForm.setFieldsValue({
            embedding_model: "",
            permission: 'me',
            chunk_method: 'naive'
          });
        }}
        width={600}
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{
            embedding_model: "", // 默认选择"使用系统默认模型"
            permission: 'me',
            chunk_method: 'naive'
          }}
        >
          <Form.Item
            label="知识库名称"
            name="name"
            rules={[
              { required: true, message: '请输入知识库名称' },
              { max: 128, message: '名称长度不能超过128个字符' }
            ]}
          >
            <Input placeholder="请输入知识库名称" />
          </Form.Item>

          <Form.Item
            name="addTimestamp"
            valuePropName="checked"
          >
            <Checkbox>自动添加时间戳确保名称唯一</Checkbox>
          </Form.Item>

          <Form.Item
            label="描述"
            name="description"
          >
            <TextArea 
              placeholder="请输入知识库描述（可选）" 
              rows={3}
              maxLength={500}
            />
          </Form.Item>

          <Form.Item
            label="嵌入模型"
            name="embedding_model"
            rules={[
              { 
                validator: (_, value) => {
                  // 允许空字符串（系统默认模型）和具体的模型值
                  if (value === undefined || value === null) {
                    return Promise.reject(new Error('请选择嵌入模型或使用系统默认模型'));
                  }
                  return Promise.resolve();
                }
              }
            ]}
            extra="选择具体的嵌入模型或使用系统默认模型。系统默认模型会根据RAGFlow配置自动选择最佳模型。"
          >
            {renderEmbeddingModelSelect()}
          </Form.Item>

          <Form.Item
            label="权限设置"
            name="permission"
          >
            <Select>
              <Option value="me">仅自己</Option>
              <Option value="team">团队共享</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="分块方法"
            name="chunk_method"
          >
            <Select placeholder="选择分块方法">
              {chunkMethods.map(method => (
                <Option key={method.value} value={method.value}>
                  {method.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑知识库模态框 */}
      <Modal
        title="编辑知识库"
        open={editModalVisible}
        onOk={handleSaveEdit}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingDataset(null);
          editForm.resetFields();
        }}
        width={600}
      >
        <Form
          form={editForm}
          layout="vertical"
        >
          <Form.Item
            label="知识库名称"
            name="name"
            rules={[
              { required: true, message: '请输入知识库名称' },
              { max: 128, message: '名称长度不能超过128个字符' }
            ]}
          >
            <Input placeholder="请输入知识库名称" />
          </Form.Item>

          <Form.Item
            label="描述"
            name="description"
          >
            <TextArea 
              placeholder="请输入知识库描述（可选）" 
              rows={3}
              maxLength={500}
            />
          </Form.Item>

          <Form.Item
            label="权限设置"
            name="permission"
          >
            <Select>
              <Option value="me">仅自己</Option>
              <Option value="team">团队共享</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情抽屉 */}
      <Drawer
        title={`知识库详情 - ${currentDataset?.name}`}
        open={detailDrawerVisible}
        onClose={() => {
          setDetailDrawerVisible(false);
          setCurrentDataset(null);
        }}
        width="80%"
        destroyOnClose
      >
        {currentDataset && (
          <DocumentManager dataset={currentDataset} />
        )}
      </Drawer>
    </div>
  );
};

export default DatasetManagement; 