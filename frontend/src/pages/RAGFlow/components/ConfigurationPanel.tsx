import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Typography,
  Alert,
  message,
  Modal,
  Tag,
  Statistic,
  Row,
  Col
} from 'antd';
import {
  SaveOutlined,
  ReloadOutlined,
  ExperimentOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  RobotOutlined
} from '@ant-design/icons';
import { useRAGFlowStore } from '../../../stores/ragflowStore';
import type { RAGFlowConfig } from '../../../types/ragflow';
import { RAGFLOW_BASE_URL, RAGFLOW_DEFAULT_API_KEY } from '../../../config';

const { Text, Paragraph } = Typography;

const ConfigurationPanel: React.FC = () => {
  const {
    config,
    isConnected,
    datasets,
    assistants,
    setConfig,
    testConnection,
    // initializeConnection,
    loadDatasets,
    loadAssistants,
    reset
  } = useRAGFlowStore();

  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [systemStats, setSystemStats] = useState({
    totalDatasets: 0,
    totalDocuments: 0,
    totalChunks: 0,
    totalAssistants: 0
  });

  // 初始化表单
  useEffect(() => {
    if (config) {
      form.setFieldsValue(config);
    }
  }, [config, form]);

  // 计算统计信息
  useEffect(() => {
    const stats = {
      totalDatasets: datasets.length,
      totalDocuments: datasets.reduce((sum, d) => sum + d.document_count, 0),
      totalChunks: datasets.reduce((sum, d) => sum + d.chunk_count, 0),
      totalAssistants: assistants.length
    };
    setSystemStats(stats);
  }, [datasets, assistants]);

  // 测试连接
  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const success = await testConnection();
      if (success) {
        message.success('连接测试成功！');
        // 加载最新数据
        await Promise.all([loadDatasets(), loadAssistants()]);
      } else {
        message.error('连接测试失败，请检查配置');
      }
    } catch (error) {
      message.error('连接测试失败');
    } finally {
      setTesting(false);
    }
  };

  // 保存配置
  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const newConfig: RAGFlowConfig = {
        apiKey: values.apiKey,
        baseUrl: values.baseUrl.replace(/\/$/, ''),
      };
      
      setConfig(newConfig);
      message.success('配置已保存');
      
      // 自动测试连接
      await handleTestConnection();
    } catch (error) {
      message.error('保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  // 重置配置
  const handleReset = () => {
    reset();
    form.resetFields();
    setShowResetModal(false);
    message.success('配置已重置');
  };

  // 连接状态指示器
  const ConnectionStatus = () => (
    <Alert
      message={
        <Space>
          {isConnected ? (
            <>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              <Text strong>连接正常</Text>
            </>
          ) : (
            <>
              <WarningOutlined style={{ color: '#ff4d4f' }} />
              <Text strong>未连接</Text>
            </>
          )}
        </Space>
      }
      description={
        isConnected 
          ? 'RAG Flow 服务连接正常，所有功能可用' 
          : '请检查服务器地址和API密钥配置'
      }
      type={isConnected ? 'success' : 'warning'}
      showIcon={false}
      style={{ marginBottom: 24 }}
    />
  );

  return (
    <div style={{ padding: '24px' }}>
      {/* 连接状态 */}
      <ConnectionStatus />

      {/* 系统统计 */}
      <Card title="系统概览" style={{ marginBottom: 24 }}>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic
              title="知识库数量"
              value={systemStats.totalDatasets}
              prefix={<DatabaseOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="文档数量"
              value={systemStats.totalDocuments}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="分块数量"
              value={systemStats.totalChunks}
              prefix={<InfoCircleOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="对话助手"
              value={systemStats.totalAssistants}
              prefix={<RobotOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Col>
        </Row>
      </Card>

      {/* 连接配置 */}
      <Card title="连接配置" style={{ marginBottom: 24 }}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            baseUrl: RAGFLOW_BASE_URL,
            apiKey: RAGFLOW_DEFAULT_API_KEY,
          }}
        >
          <Alert
            message="配置说明"
            description={
              <div>
                <Paragraph>
                  请填写 RAG Flow 服务器的连接信息：
                </Paragraph>
                <ul>
                  <li><Text strong>服务器地址：</Text>RAG Flow 服务器的完整 URL，例如 {RAGFLOW_BASE_URL}</li>
                  <li><Text strong>API 密钥：</Text>在 RAG Flow 管理界面中生成的 API Key</li>
                </ul>
              </div>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form.Item
            label="服务器地址"
            name="baseUrl"
            rules={[
              { required: true, message: '请输入服务器地址' },
              { type: 'url', message: '请输入有效的 URL' }
            ]}
          >
            <Input 
              placeholder={RAGFLOW_BASE_URL}
              prefix="🌐"
              size="large"
            />
          </Form.Item>

          <Form.Item
            label="API 密钥"
            name="apiKey"
            rules={[
              { required: true, message: '请输入 API 密钥' },
              { min: 10, message: 'API 密钥长度至少为 10 位' }
            ]}
          >
            <Input.Password 
              placeholder="请输入 RAG Flow API 密钥"
              prefix="🔑"
              size="large"
            />
          </Form.Item>

          <Space>
            <Button 
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveConfig}
              loading={saving}
              size="large"
            >
              保存配置
            </Button>
            
            <Button 
              icon={<ExperimentOutlined />}
              onClick={handleTestConnection}
              loading={testing}
              disabled={!config}
              size="large"
            >
              测试连接
            </Button>

            <Button 
              danger
              icon={<ReloadOutlined />}
              onClick={() => setShowResetModal(true)}
              disabled={!config}
              size="large"
            >
              重置配置
            </Button>
          </Space>
        </Form>
      </Card>

      {/* 系统信息 */}
      <Card title="系统信息">
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <Card size="small" title="当前配置">
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text strong>服务器地址：</Text>
                  <Text code>{config?.baseUrl || '未配置'}</Text>
                </div>
                <div>
                  <Text strong>API 密钥：</Text>
                  <Text code>
                    {config?.apiKey ? 
                      `${config.apiKey.slice(0, 8)}...${config.apiKey.slice(-4)}` : 
                      '未配置'
                    }
                  </Text>
                </div>
                <div>
                  <Text strong>连接状态：</Text>
                  {isConnected ? (
                    <Tag color="success">已连接</Tag>
                  ) : (
                    <Tag color="error">未连接</Tag>
                  )}
                </div>
              </Space>
            </Card>
          </Col>
          
          <Col span={12}>
            <Card size="small" title="功能状态">
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text strong>知识库管理：</Text>
                  <Tag color={isConnected ? 'success' : 'default'}>
                    {isConnected ? '可用' : '不可用'}
                  </Tag>
                </div>
                <div>
                  <Text strong>文档上传：</Text>
                  <Tag color={isConnected ? 'success' : 'default'}>
                    {isConnected ? '可用' : '不可用'}
                  </Tag>
                </div>
                <div>
                  <Text strong>对话助手：</Text>
                  <Tag color={isConnected ? 'success' : 'default'}>
                    {isConnected ? '可用' : '不可用'}
                  </Tag>
                </div>
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>

      {/* 重置确认模态框 */}
      <Modal
        title="确认重置"
        open={showResetModal}
        onOk={handleReset}
        onCancel={() => setShowResetModal(false)}
        okText="确定重置"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <Alert
          message="警告"
          description="重置操作将清除所有 RAG Flow 配置信息，包括服务器地址和API密钥。此操作不可撤销。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Text>确定要重置所有配置吗？</Text>
      </Modal>
    </div>
  );
};

export default ConfigurationPanel; 