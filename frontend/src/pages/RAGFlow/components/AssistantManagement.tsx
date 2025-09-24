import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  message,
  Popconfirm,
  Tag,
  Avatar,
  Typography,
  Tabs,
  Alert,
  Slider,
  InputNumber
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  RobotOutlined,
  ReloadOutlined,
  DatabaseOutlined
} from '@ant-design/icons';
import { useRAGFlowStore } from '../../../stores/ragflowStore';
import type { ChatAssistant } from '../../../types/ragflow';
import type { ColumnsType } from 'antd/es/table';
import type { Key } from 'antd/es/table/interface';
import styles from '../RAGFlowManage.module.css';
import deepseekLogo from '../../../static/logo/deepseek.png';

const { TextArea } = Input;
const { Option } = Select;
const { Text } = Typography;
const { TabPane } = Tabs;

// 滑块输入组件
const SliderInput: React.FC<{
  value?: number;
  onChange?: (value: number) => void;
  min: number;
  max: number;
  step: number;
  precision?: number;
}> = ({ value = 0, onChange, min, max, step, precision }) => {
  const handleSliderChange = (v: number) => {
    onChange?.(v);
  };

  const handleInputChange = (v: number | null) => {
    if (v !== null) {
      const clampedValue = Math.min(Math.max(v, min), max);
      onChange?.(clampedValue);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, padding: '0 8px' }}>
        <Slider 
          min={min} 
          max={max} 
          step={step} 
          tooltip={{ open: false }}
          value={value}
          onChange={handleSliderChange}
        />
      </div>
      <InputNumber
        min={min}
        max={max}
        step={step}
        precision={precision}
        value={value}
        onChange={handleInputChange}
        style={{ 
          width: 80,
          fontSize: '14px'
        }}
        size="small"
      />
    </div>
  );
};

const AssistantManagement: React.FC = () => {
  const {
    assistants,
    datasets,
    loading,
    loadAssistants,
    loadDatasets,
    createAssistant,
    updateAssistant,
    deleteAssistants
  } = useRAGFlowStore();

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedAssistants, setSelectedAssistants] = useState<Key[]>([]);
  const [editingAssistant, setEditingAssistant] = useState<ChatAssistant | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  // 初始化加载数据
  useEffect(() => {
    Promise.all([
      loadAssistants(),
      loadDatasets()
    ]).catch(err => {
      message.error('加载数据失败');
      console.error(err);
    });
  }, [loadAssistants, loadDatasets]);

  // 创建助手
  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      console.log('🔍 表单验证通过，获取到的值:', values);
      
      const params = {
        name: values.name,
        avatar: values.avatar || '',
        dataset_ids: values.dataset_ids || [],
        llm: {
          model_name: values.model_name || 'deepseek-chat',
          temperature: values.temperature || 0.1,
          top_p: values.top_p || 0.3,
          presence_penalty: values.presence_penalty || 0.2,
          frequency_penalty: values.frequency_penalty || 0.7
        },
        prompt: {
          similarity_threshold: values.similarity_threshold || 0.2,
          keywords_similarity_weight: values.keywords_similarity_weight || 0.7,
          vector_similarity_weight: values.vector_similarity_weight || 0.3,
          top_n: values.top_n || 8,
          variables: [{"key": "knowledge", "optional": true}],
          rerank_model: values.rerank_model,
          top_k: values.top_k || 1024,
          empty_response: values.empty_response || '',
          opener: values.opener || '',
          show_quote: values.show_quote !== false,
          prompt: values.system_prompt || ''
        }
      };

      console.log('🚀 准备创建助手，最终参数:', JSON.stringify(params, null, 2));
      await createAssistant(params);
      message.success('对话助手创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      // 重新设置默认值以备下次使用
      createForm.setFieldsValue({
        model_name: 'deepseek-chat',
        temperature: 0.1,
        top_p: 0.3,
        presence_penalty: 0.2,
        frequency_penalty: 0.7,
        similarity_threshold: 0.2,
        keywords_similarity_weight: 0.7,
        vector_similarity_weight: 0.3,
        top_n: 8,
        top_k: 1024,
        show_quote: true,
        dataset_ids: []
      });
    } catch (error) {
      console.error('创建对话助手详细错误信息:', error);
      
      // 更详细的错误信息显示
      let errorMessage = '创建对话助手失败';
      if (error instanceof Error) {
        console.error('错误消息:', error.message);
        console.error('错误堆栈:', error.stack);
        errorMessage = `创建失败: ${error.message}`;
      }
      
      message.error(errorMessage);
    }
  };

  // 编辑助手
  const handleEdit = (assistant: ChatAssistant) => {
    setEditingAssistant(assistant);
    editForm.setFieldsValue({
      name: assistant.name,
      avatar: assistant.avatar,
      dataset_ids: assistant.dataset_ids,
      model_name: assistant.llm?.model_name,
      temperature: assistant.llm?.temperature,
      top_p: assistant.llm?.top_p,
      presence_penalty: assistant.llm?.presence_penalty,
      frequency_penalty: assistant.llm?.frequency_penalty,
      similarity_threshold: assistant.prompt?.similarity_threshold,
      keywords_similarity_weight: assistant.prompt?.keywords_similarity_weight,
      vector_similarity_weight: assistant.prompt?.vector_similarity_weight,
      top_n: assistant.prompt?.top_n,
      rerank_model: assistant.prompt?.rerank_model,
      top_k: assistant.prompt?.top_k,
      empty_response: assistant.prompt?.empty_response,
      opener: assistant.prompt?.opener,
      show_quote: assistant.prompt?.show_quote,
      system_prompt: assistant.prompt?.prompt
    });
    setEditModalVisible(true);
  };

  // 更新助手
  const handleUpdate = async () => {
    if (!editingAssistant) return;

    try {
      const values = await editForm.validateFields();
      
      const params = {
        name: values.name,
        avatar: values.avatar || '',
        dataset_ids: values.dataset_ids || [],
        llm: {
          model_name: values.model_name || 'deepseek-chat',
          temperature: values.temperature,
          top_p: values.top_p,
          presence_penalty: values.presence_penalty,
          frequency_penalty: values.frequency_penalty
        },
        prompt: {
          similarity_threshold: values.similarity_threshold,
          keywords_similarity_weight: values.keywords_similarity_weight,
          vector_similarity_weight: values.vector_similarity_weight,
          top_n: values.top_n,
          variables: editingAssistant.prompt?.variables || [{"key": "knowledge", "optional": true}],
          rerank_model: values.rerank_model,
          top_k: values.top_k,
          empty_response: values.empty_response || '',
          opener: values.opener || '',
          show_quote: values.show_quote,
          prompt: values.system_prompt || ''
        }
      };

      await updateAssistant(editingAssistant.id, params);
      message.success('对话助手更新成功');
      setEditModalVisible(false);
      setEditingAssistant(null);
      editForm.resetFields();
    } catch (error) {
      message.error('更新对话助手失败');
      console.error(error);
    }
  };

  // 删除助手
  const handleDelete = async (ids: string[]) => {
    try {
      await deleteAssistants(ids);
      message.success('删除成功');
      setSelectedAssistants([]);
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  // 刷新数据
  const handleRefresh = () => {
    Promise.all([
      loadAssistants(),
      loadDatasets()
    ]).catch(err => {
      message.error('刷新失败');
      console.error(err);
    });
  };

  // 表格列定义
  const columns: ColumnsType<ChatAssistant> = [
    {
      title: '助手名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: ChatAssistant) => (
        <Space>
          <Avatar 
            src={record.avatar} 
            icon={<RobotOutlined />}
            size="small"
          />
          <span>{text}</span>
        </Space>
      ),
    },
    {
      title: '关联知识库',
      dataIndex: 'dataset_ids',
      key: 'dataset_ids',
      render: (datasetIds: string[]) => {
        // 添加调试日志
        console.log('🔍 知识库渲染调试:', {
          datasetIds,
          datasetsLength: datasets.length,
          datasets: datasets.map(d => ({ id: d.id, name: d.name }))
        });
        
        return (
          <Space wrap>
            {(datasetIds || []).slice(0, 2).map(id => {
              const dataset = datasets.find(d => d.id === id);
              console.log(`🔍 查找知识库 ${id}:`, dataset);
              return (
                <Tag key={id} color="blue" icon={<DatabaseOutlined />}>
                  {dataset?.name || id.slice(0, 8)}
                </Tag>
              );
            })}
            {(datasetIds || []).length > 2 && (
              <Tag color="default">+{(datasetIds || []).length - 2}</Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: 'LLM模型',
      key: 'model',
      render: (_, record: ChatAssistant) => {
        const modelName = record.llm?.model_name;
        const displayName = modelName === 'deepseek-chat' ? 'DeepSeek-Chat' : (modelName || '默认');
        return <Tag color="green">{displayName}</Tag>;
      },
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
      render: (_, record: ChatAssistant) => (
        <Space size="small">
          <Button 
            type="text" 
            icon={<EditOutlined />} 
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确定要删除这个对话助手吗？"
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

  // 表单组件
  const AssistantForm = ({ form }: { form: any }) => (
    <Form 
      form={form} 
      layout="vertical"
      initialValues={{
        model_name: 'deepseek-chat',
        temperature: 0.1,
        top_p: 0.3,
        presence_penalty: 0.2,
        frequency_penalty: 0.7,
        similarity_threshold: 0.2,
        keywords_similarity_weight: 0.7,
        vector_similarity_weight: 0.3,
        top_n: 8,
        top_k: 1024,
        show_quote: true,
        dataset_ids: []
      }}
    >
      <Form.Item
        label="助手名称"
        name="name"
        rules={[{ required: true, message: '请输入助手名称' }]}
      >
        <Input placeholder="请输入助手名称" />
      </Form.Item>

      <Form.Item
        label="头像URL"
        name="avatar"
      >
        <Input placeholder="请输入头像URL（可选）" />
      </Form.Item>

      <Form.Item
        label="关联知识库"
        name="dataset_ids"
        tooltip="选择助手可以访问的知识库"
      >
        <Select
          mode="multiple"
          placeholder="选择知识库"
          loading={loading.datasets}
        >
          {datasets.map(dataset => (
            <Option key={dataset.id} value={dataset.id}>
              {dataset.name}
            </Option>
          ))}
        </Select>
      </Form.Item>

      <Tabs 
        defaultActiveKey="llm" 
        type="card" 
        className={`${styles.assistantFormTabs} assistant-dark-theme-tabs`}
      >
        <TabPane tab="LLM 设置" key="llm">
          <Form.Item
            label={<span>LLM模型</span>}
            name="model_name"
            initialValue="deepseek-chat"
          >
            <Select
              placeholder="选择LLM模型"
              className={styles.modelSelect}
              optionLabelProp="label"
              dropdownClassName="modelSelect-dropdown"
            >
              <Option value="deepseek-chat" label="DeepSeek-Chat">
                <div className={styles.modelOption}>
                  <img 
                    src={deepseekLogo} 
                    alt="DeepSeek" 
                    className={styles.modelIcon}
                  />
                  <span>DeepSeek-Chat</span>
                </div>
              </Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="温度"
            name="temperature"
            tooltip="控制生成文本的随机性，值越高越随机"
            initialValue={0.1}
          >
            {(() => {
              const temperature = Form.useWatch('temperature', form);
              return (
                <SliderInput
                  value={temperature ?? 0.1}
                      onChange={(v) => form.setFieldsValue({ temperature: v })}
                  min={0}
                  max={2}
                  step={0.1}
                  precision={1}
                    />
              );
            })()}
          </Form.Item>

          <Form.Item
            label="Top P"
            name="top_p"
            tooltip="核采样参数，控制生成的多样性"
            initialValue={0.3}
          >
            {(() => {
              const topP = Form.useWatch('top_p', form);
              return (
                <SliderInput
                  value={topP ?? 0.3}
                      onChange={(v) => form.setFieldsValue({ top_p: v })}
                  min={0}
                  max={1}
                  step={0.01}
                  precision={2}
                    />
              );
            })()}
          </Form.Item>

          <Form.Item
            label="存在惩罚"
            name="presence_penalty"
            tooltip="减少重复话题的概率"
            initialValue={0.2}
          >
            {(() => {
              const presencePenalty = Form.useWatch('presence_penalty', form);
              return (
                <SliderInput
                  value={presencePenalty ?? 0.2}
                      onChange={(v) => form.setFieldsValue({ presence_penalty: v })}
                  min={-2}
                  max={2}
                  step={0.1}
                  precision={1}
                    />
              );
            })()}
          </Form.Item>

          <Form.Item
            label="频率惩罚"
            name="frequency_penalty"
            tooltip="减少重复词语的概率"
            initialValue={0.7}
          >
            {(() => {
              const frequencyPenalty = Form.useWatch('frequency_penalty', form);
              return (
                <SliderInput
                  value={frequencyPenalty ?? 0.7}
                      onChange={(v) => form.setFieldsValue({ frequency_penalty: v })}
                  min={-2}
                  max={2}
                  step={0.1}
                  precision={1}
                    />
              );
            })()}
          </Form.Item>
        </TabPane>

        <TabPane tab="检索设置" key="retrieval">
          <Form.Item
            label="相似度阈值"
            name="similarity_threshold"
            tooltip="检索结果的最低相似度要求"
            initialValue={0.2}
          >
            {(() => {
              const similarityThreshold = Form.useWatch('similarity_threshold', form);
              return (
                <SliderInput
                  value={similarityThreshold ?? 0.2}
                      onChange={(v) => form.setFieldsValue({ similarity_threshold: v })}
                  min={0}
                  max={1}
                  step={0.01}
                  precision={2}
                    />
              );
            })()}
          </Form.Item>

          <Form.Item
            label="关键词相似度权重"
            name="keywords_similarity_weight"
            tooltip="用于平衡关键词匹配与向量相似度的权重：值越大关键词影响越强"
            initialValue={0.7}
          >
            {(() => {
              const keywordsSimilarityWeight = Form.useWatch('keywords_similarity_weight', form);
              return (
                <SliderInput
                  value={keywordsSimilarityWeight ?? 0.7}
                      onChange={(v) => form.setFieldsValue({ keywords_similarity_weight: v })}
                  min={0}
                  max={1}
                  step={0.01}
                  precision={2}
                    />
              );
            })()}
          </Form.Item>

          <Form.Item
            label="向量相似度权重"
            name="vector_similarity_weight"
            tooltip="向量余弦相似度在混合相似度评分中的权重"
            initialValue={0.3}
          >
            {(() => {
              const vectorSimilarityWeight = Form.useWatch('vector_similarity_weight', form);
              return (
                <SliderInput
                  value={vectorSimilarityWeight ?? 0.3}
                      onChange={(v) => form.setFieldsValue({ vector_similarity_weight: v })}
                  min={0}
                  max={1}
                  step={0.01}
                  precision={2}
                    />
              );
            })()}
          </Form.Item>

          <Form.Item
            label="检索数量"
            name="top_n"
            tooltip="每次检索返回的最大结果数"
            initialValue={8}
          >
            {(() => {
              const topN = Form.useWatch('top_n', form);
              return (
                <SliderInput
                  value={topN ?? 8}
                      onChange={(v) => form.setFieldsValue({ top_n: v })}
                  min={1}
                  max={50}
                  step={1}
                  precision={0}
                    />
              );
            })()}
          </Form.Item>

          <Form.Item
            label="重排序模型"
            name="rerank_model"
            tooltip="对初始检索结果进行二次排序的模型，可提升相关性"
          >
            <Input placeholder="例如 bge-reranker-large 或 Cohere-rerank（可选）" />
          </Form.Item>

          <Form.Item
            label="Top K"
            name="top_k"
            tooltip="检索时考虑的候选数量"
            initialValue={1024}
          >
            {(() => {
              const topK = Form.useWatch('top_k', form);
              return (
                <SliderInput
                  value={topK ?? 1024}
                      onChange={(v) => form.setFieldsValue({ top_k: v })}
                  min={1}
                  max={10000}
                  step={1}
                  precision={0}
                    />
              );
            })()}
          </Form.Item>
        </TabPane>

        <TabPane tab="对话设置" key="chat">
          <Form.Item
            label="开场白"
            name="opener"
            tooltip="助手的开场问候语"
          >
            <TextArea 
              placeholder="你好！我是你的AI助手，有什么可以帮助你的吗？"
              rows={2}
            />
          </Form.Item>

          <Form.Item
            label="空回答"
            name="empty_response"
            tooltip="当检索不到相关内容时的回复"
          >
            <TextArea 
              placeholder="抱歉，我没有找到相关信息。"
              rows={2}
            />
          </Form.Item>

          <Form.Item
            label="系统提示词"
            name="system_prompt"
            tooltip="定义助手的行为和回答风格"
            initialValue={`以下是知识库：
"""
{knowledge}
"""

`}
          >
            <TextArea 
            placeholder="请输入系统提示词,如果需要知识库则必须添加知识库变量：{knowledge}"
              rows={4}
            />
          </Form.Item>

          <Form.Item
            label="显示引用"
            name="show_quote"
            valuePropName="checked"
            tooltip="是否在回答中显示引用来源"
            initialValue={true}
          >
            <Switch defaultChecked />
          </Form.Item>
        </TabPane>
      </Tabs>
    </Form>
  );

  return (
    <div className={styles.content}>
      <Card>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text strong style={{ fontSize: 16 }} className={styles.titleText}>对话助手管理</Text>
            <br />
            <Text type="secondary" className={styles.welcomeDescription}>创建和管理您的AI对话助手</Text>
          </div>
          <Space>
            <Button 
              icon={<ReloadOutlined />} 
              onClick={handleRefresh}
              loading={loading.assistants}
            >
              刷新
            </Button>
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => {
                setCreateModalVisible(true);
                // 设置默认值
                setTimeout(() => {
                  createForm.setFieldsValue({
                    model_name: 'deepseek-chat',
                    temperature: 0.1,
                    top_p: 0.3,
                    presence_penalty: 0.2,
                    frequency_penalty: 0.7,
                    similarity_threshold: 0.2,
                    keywords_similarity_weight: 0.7,
                    vector_similarity_weight: 0.3,
                    top_n: 8,
                    top_k: 1024,
                    show_quote: true,
                    dataset_ids: []
                  });
                }, 0);
              }}
            >
              创建助手
            </Button>
            {selectedAssistants.length > 0 && (
              <Popconfirm
                title={`确定要删除选中的 ${selectedAssistants.length} 个助手吗？`}
                onConfirm={() => handleDelete(selectedAssistants as string[])}
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

        <Table
          columns={columns}
          dataSource={assistants}
          rowKey="id"
          loading={loading.assistants}
          rowSelection={{
            selectedRowKeys: selectedAssistants,
            onChange: setSelectedAssistants,
          }}
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
          }}
        />
      </Card>

      {/* 创建助手模态框 */}
      <Modal
        title="创建对话助手"
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
          // 重新设置默认值
          createForm.setFieldsValue({
            model_name: 'deepseek-chat',
            temperature: 0.1,
            top_p: 0.3,
            presence_penalty: 0.2,
            frequency_penalty: 0.7,
            similarity_threshold: 0.2,
            keywords_similarity_weight: 0.7,
            vector_similarity_weight: 0.3,
            top_n: 8,
            top_k: 1024,
            show_quote: true,
            dataset_ids: []
          });
        }}
        width={800}
        style={{ top: 20 }}
        bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
      >
        <Alert
          message="创建提示"
          description="请配置助手的基本信息、关联知识库和对话参数。高级设置可以在创建后修改。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <AssistantForm form={createForm} />
      </Modal>

      {/* 编辑助手模态框 */}
      <Modal
        title="编辑对话助手"
        open={editModalVisible}
        onOk={handleUpdate}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingAssistant(null);
          editForm.resetFields();
        }}
        width={800}
        style={{ top: 20 }}
        bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
      >
        <AssistantForm form={editForm} />
      </Modal>
    </div>
  );
};

export default AssistantManagement; 