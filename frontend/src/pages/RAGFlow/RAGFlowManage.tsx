import React, { useState, useEffect } from 'react';
import { 
  Layout, 
  Tabs, 
  Button, 
  Card, 
  Space, 
  message, 
  Modal, 
  Form, 
  Input, 
  Typography,
  Alert,
  Divider
} from 'antd';
import { RAGFLOW_BASE_URL, RAGFLOW_DEFAULT_API_KEY } from '../../config';
import {
  DatabaseOutlined,
  RobotOutlined,
  SettingOutlined,
  ArrowLeftOutlined,
  DisconnectOutlined,
  LinkOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useRAGFlowStore } from '../../stores/ragflowStore';
import { useThemeStore } from '../../stores/themeStore';
import DatasetManagement from './components/DatasetManagement';
import AssistantManagement from './components/AssistantManagement';
import ConfigurationPanel from './components/ConfigurationPanel';
import styles from './RAGFlowManage.module.css';
import type { RAGFlowConfig } from '../../types/ragflow';

const { Header, Content } = Layout;
const { TabPane } = Tabs;
const { Title, Text } = Typography;

const RAGFlowManage: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useThemeStore();
  const isDarkMode = theme === 'dark';
  
  const {
    config,
    isConnected,
    setConfig,
    testConnection,
    initializeConnection,
    // reset
  } = useRAGFlowStore();

  const [activeTab, setActiveTab] = useState('datasets');
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form] = Form.useForm();

  // 初始化时检查配置和连接状态
  useEffect(() => {
    const initializeRAGFlow = async () => {
      if (!config) {
        setConfigModalVisible(true);
      } else {
        // 如果有配置但未连接，尝试初始化连接
        if (!isConnected) {
          await initializeConnection();
        }
      }
    };
    
    initializeRAGFlow();
  }, [config, isConnected, initializeConnection]);

  // 处理返回
  const handleBack = () => {
    navigate('/chat');
  };

  // 打开配置模态框
  const handleOpenConfig = () => {
    setConfigModalVisible(true);
    if (config) {
      form.setFieldsValue(config);
    }
  };

  // 测试连接
  const handleTestConnection = async () => {
    try {
      const success = await testConnection();
      if (success) {
        message.success('连接成功！');
      } else {
        message.error('连接失败，请检查配置');
      }
    } catch (error) {
      message.error('连接测试失败');
      console.error('Connection test failed:', error);
    }
  };

  // 保存配置
  const handleSaveConfig = async () => {
    try {
      const values = await form.validateFields();
      const newConfig: RAGFlowConfig = {
        baseUrl: values.baseUrl,
        apiKey: values.apiKey
      };
      
      setConfig(newConfig);
      message.success('配置保存成功');
      setConfigModalVisible(false);
      
      // 保存后自动测试连接
      setTimeout(() => {
        handleTestConnection();
      }, 500);
    } catch (error) {
      console.error('Save config failed:', error);
    }
  };

  return (
    <Layout className={`${styles.ragflowLayout} ${isDarkMode ? '' : ''}`}>
      <Header className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.headerLeft}>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={handleBack}
              className={styles.backButton}
            >
              返回聊天
            </Button>
            <Divider type="vertical" />
            <Title level={4} className={styles.titleText}>
              <DatabaseOutlined style={{ marginRight: 8 }} />
              RAG Flow 管理
            </Title>
          </div>
          
          <div className={styles.headerRight}>
            <Space>
              <div className={styles.connectionStatus}>
                {isConnected ? (
                  <Space>
                    <LinkOutlined style={{ color: '#52c41a' }} />
                    <Text>已连接</Text>
                  </Space>
                ) : (
                  <Space>
                    <DisconnectOutlined style={{ color: '#ff4d4f' }} />
                    <Text>未连接</Text>
                  </Space>
                )}
              </div>
              
              <Button
                icon={<LinkOutlined />}
                onClick={handleTestConnection}
                loading={false}
                disabled={!config}
              >
                测试连接
              </Button>
              
              <Button
                icon={<SettingOutlined />}
                onClick={handleOpenConfig}
              >
                配置
              </Button>
            </Space>
          </div>
        </div>
      </Header>

      <Content className={styles.content}>
        {!config || !isConnected ? (
          <Card className={styles.welcomeCard}>
            <div className={styles.welcomeContent}>
              <DatabaseOutlined className={styles.welcomeIcon} />
              <Title level={3} className={styles.titleText}>欢迎使用 RAG Flow 知识库管理</Title>
              <Text type="secondary" className={styles.welcomeDescription}>
                连接到 RAG Flow 服务器，管理您的知识库、文档和对话助手。
                请先配置服务器连接信息。
              </Text>
              
              <div className={styles.welcomeActions}>
                <Button
                  type="primary"
                  size="large"
                  icon={<SettingOutlined />}
                  onClick={handleOpenConfig}
                >
                  开始配置
                </Button>
              </div>
              
              {config && !isConnected && (
                <Alert
                  message="连接失败"
                  description="无法连接到 RAG Flow 服务器，请检查配置信息和网络连接。"
                  type="error"
                  showIcon
                  style={{ marginTop: 24 }}
                />
              )}
            </div>
          </Card>
        ) : (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab as any}
            className={styles.mainTabs}
          >
            <TabPane
              tab={
                <span>
                  <DatabaseOutlined />
                  知识库管理
                </span>
              }
              key="datasets"
            >
              <DatasetManagement />
            </TabPane>
            
            <TabPane
              tab={
                <span>
                  <RobotOutlined />
                  对话助手
                </span>
              }
              key="assistants"
            >
              <AssistantManagement />
            </TabPane>
            
            <TabPane
              tab={
                <span>
                  <SettingOutlined />
                  系统配置
                </span>
              }
              key="config"
            >
              <ConfigurationPanel />
            </TabPane>
          </Tabs>
        )}
      </Content>

      {/* 配置模态框 */}
      <Modal
        title="RAG Flow 配置"
        open={configModalVisible}
        onOk={handleSaveConfig}
        onCancel={() => setConfigModalVisible(false)}
        width={700}
        maskClosable={false}
        destroyOnClose
        style={{ top: 20 }}
        bodyStyle={{ 
          maxHeight: '70vh', 
          overflowY: 'auto',
          padding: '24px'
        }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            baseUrl: RAGFLOW_BASE_URL,
            apiKey: RAGFLOW_DEFAULT_API_KEY
          }}
        >
          <Alert
            message="配置说明"
            description={
              <div>
                <p>请填写 RAG Flow 服务器的连接信息：</p>
                <ul>
                  <li>服务器地址：RAG Flow 服务器的完整 URL</li>
                  <li>API 密钥：在 RAG Flow 系统设置中生成的 API Key</li>
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
              { type: 'url', message: '请输入有效的URL地址' }
            ]}
          >
            <Input
              placeholder={RAGFLOW_BASE_URL}
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            label="API 密钥"
            name="apiKey"
            rules={[
              { required: true, message: '请输入API密钥' }
            ]}
          >
            <Input.Password
              placeholder="请输入 RAG Flow API 密钥"
              size="large"
            />
          </Form.Item>
          
          <div style={{ marginTop: 16 }}>
            <Button
              type="default"
              onClick={async () => {
                setTesting(true);
                try {
                  const values = await form.validateFields();
                  const tempConfig: RAGFlowConfig = {
                    baseUrl: values.baseUrl,
                    apiKey: values.apiKey
                  };
                  
                  // 临时设置配置进行测试
                  const originalConfig = config;
                  setConfig(tempConfig);
                  
                  const success = await testConnection();
                  if (success) {
                    message.success('连接测试成功！');
                  } else {
                    message.error('连接测试失败，请检查配置');
                    // 恢复原配置
                    if (originalConfig) {
                      setConfig(originalConfig);
                    }
                  }
                } catch (error) {
                  message.error('请先填写完整的配置信息');
                } finally {
                  setTesting(false);
                }
              }}
              loading={testing}
              style={{ marginRight: 8 }}
            >
              测试连接
            </Button>
          </div>
        </Form>
      </Modal>
    </Layout>
  );
};

export default RAGFlowManage; 