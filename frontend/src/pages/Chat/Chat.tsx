import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Layout, Select, Switch, Input, Button, message, Collapse, Tooltip, Dropdown, Modal, Menu, InputNumber, Slider, Checkbox, Tag, theme as antdTheme } from 'antd';
import { Upload } from 'antd';
import ReactMarkdown from 'react-markdown';
import * as JsonViewer from '@uiw/react-json-view';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { 
  SendOutlined, 
  UserOutlined, 
  FileTextOutlined,
  RobotOutlined,
  SoundOutlined,
  ApiOutlined,
  GlobalOutlined,

  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  MenuOutlined,
  PlusOutlined,
  AudioOutlined,
  QuestionCircleOutlined,
  PhoneOutlined,
  AppstoreOutlined,
  CopyOutlined,
  DownOutlined,
  UpOutlined,
  PictureOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  DownloadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  CloseOutlined,
  DatabaseOutlined,
    RightOutlined,
   CompressOutlined,
   SettingOutlined,
 
 } from '@ant-design/icons';
import styles from './Chat.module.css';
import { useChatStore } from '../../stores/chatStore';
import type { ChatSession } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import { useRAGFlowStore } from '../../stores/ragflowStore';
import type { ChatAssistant, Session as RAGFlowSession, Message as RAGFlowMessage } from '../../types/ragflow';
import { ragflowService } from '../../services/ragflow';
import { getFullUrl } from '../../config';
import { useNavigate } from 'react-router-dom';
import AvatarCropper from '../../components/AvatarCropper';
import ThemeToggle from '../../components/ThemeToggle';
import ImageCompressor from '../../components/ImageCompressor';
import authAxios from '../../utils/authAxios';
// 导入logo图片
import deepseekLogo from '../../static/logo/deepseek.png';
import doubaoLogo from '../../static/logo/doubao.png';
import chatWSManager from '../../utils/ChatWSManager';
import ollamaLogo from '../../static/logo/ollama.png';
import ollamaWhiteLogo from '../../static/logo/ollama-white-fg.png';
import defaultAvatar from '../../static/avatar/default-avatar.png';
import bytedanceVoicesData from './byteDance_tts.json';
import xfyunVoicesData from './xfyun_tts.json';
import defaultModelAvatar from '../../static/avatar/default-avatar-model.png';
import modelParamsConfig from './model_params_config.json';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

const { Sider } = Layout;
const { Option } = Select;
const { Panel } = Collapse;


interface ModelSettings {
  modelService: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  modelParams?: Record<string, any>;
}

// 助手会话接口，扩展RAGFlow的Session
interface AssistantSession extends RAGFlowSession {
  assistant_id: string;
  assistant_name: string;
  message_count?: number;
  // 为助手会话增加可选的角色头像字段
  role_avatar_url?: string;
  role_background_url?: string;
}

// 消息接口，兼容原有和RAGFlow格式
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  images?: string[];
  reference?: any[];
  id?: string;
  create_time?: string;
}



// 验证模型配置是否完整
const validateModelSettings = (settings: ModelSettings): { isValid: boolean; message: string } => {
  if (!settings.baseUrl?.trim()) {
    return { isValid: false, message: '请输入模型服务地址' };
  }
  if (!settings.modelName?.trim()) {
    return { isValid: false, message: '请输入模型名称' };
  }
  // 所有服务都需要 API key（Ollama 使用占位符）
  if (!settings.apiKey?.trim()) {
    return { isValid: false, message: '请输入API密钥' };
  }
  if (!settings.modelService?.trim()) {
    return { isValid: true, message: '' };
  }
  return { isValid: true, message: '' };
};

// 测试模型配置是否可用
const testModelConfig = async (settings: ModelSettings): Promise<boolean> => {
  try {
    console.log('[Chat] 开始测试模型配置');
    
    // 根据不同的模型服务使用不同的测试方法
    if (settings.modelService === 'doubao') {
      // 豆包服务使用简单的连接测试
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // 只有当apiKey不为空且不包含非ASCII字符时才添加Authorization header
      if (settings.apiKey && settings.apiKey.trim() && /^[\x00-\x7F]*$/.test(settings.apiKey)) {
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
      }
      
      const response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: settings.modelName,
          messages: [
            { role: 'user', content: 'test' }
          ],
          max_tokens: 1
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Chat] 豆包API错误详情:', errorText);
        throw new Error(`豆包API测试失败: ${response.status} - ${errorText}`);
      }

      console.log('[Chat] 豆包模型配置测试成功');
      return true;
    } else if (settings.modelService === 'ollama') {
      // 使用后端 API 测试 Ollama 配置
      try {
        console.log(`[Chat] 开始测试 Ollama 模型: ${settings.modelName}`);
        console.log(`[Chat] 请求地址: ${settings.baseUrl}`);
        
        // 从 authStore 获取 token
        const authState = JSON.parse(localStorage.getItem('auth-storage') || '{}');
        const token = authState.state?.token;
        
        if (!token) {
          throw new Error('没有找到认证token，请先登录');
        }
        
        // 调用后端测试 API
        const response = await fetch(`/api/chat/test-ollama-config?base_url=${encodeURIComponent(settings.baseUrl)}&model_name=${encodeURIComponent(settings.modelName)}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`后端测试API请求失败: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('[Chat] 后端 Ollama 测试结果:', data);
        
        if (data.success) {
          console.log(`[Chat] Ollama 模型配置测试成功，模型回复: ${data.model_reply}`);
          return true;
        } else {
          throw new Error(data.message || 'Ollama 模型配置测试失败');
        }
        
      } catch (error) {
        console.error('[Chat] Ollama 后端测试失败:', error);
        throw new Error(`Ollama 模型配置测试失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // 其他服务使用标准的models端点
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // 只有当apiKey不为空且不包含非ASCII字符时才添加Authorization header
      if (settings.apiKey && settings.apiKey.trim() && /^[\x00-\x7F]*$/.test(settings.apiKey)) {
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
      }
      
      const response = await fetch(`${settings.baseUrl}/v1/models`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error('模型配置测试失败');
      }

      const data = await response.json();
      console.log('[Chat] 模型配置测试结果:', data);
      return true;
    }
  } catch (error) {
    console.error('[Chat] 模型配置测试失败:', error);
    
    // 添加详细的错误诊断信息
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      console.error('[Chat] 网络连接错误，可能的原因:');
      console.error('[Chat] 1. Ollama 服务未启动');
      console.error('[Chat] 2. 服务地址不正确');
      console.error('[Chat] 3. 网络连接问题');
      console.error('[Chat] 4. CORS 跨域问题');
      console.error('[Chat] 请检查 Ollama 是否在 http://localhost:11434 运行');
    }
    
    return false;
  }
};

// 模型服务配置 - 根据主题动态返回不同图标
const getModelServices = (isDarkTheme: boolean) => [
  { value: 'deepseek', label: 'DeepSeek', logo: deepseekLogo },
  { value: 'doubao', label: '豆包', logo: doubaoLogo },
  { value: 'ollama', label: 'Ollama', logo: isDarkTheme ? ollamaWhiteLogo : ollamaLogo },
] as const;

// 各服务对应的模型名称配置
const MODEL_NAMES = {
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat', imageLabel: '📝', isSpecial: true },
    { value: 'deepseek-coder', label: 'DeepSeek Coder', imageLabel: '📝', isSpecial: true },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner', imageLabel: '📝', isSpecial: true }
  ],
  ollama: [],
  doubao: [
    {value: 'doubao-seed-1-6-250615', label: ' 豆包 Seed 1.6', supportsImage: true, imageLabel: '🖼️', isSpecial: false},
    { value: 'doubao-seed-1-6-thinking-250715', label: ' 豆包 Seed 1.6 Thinking', supportsImage: true, imageLabel: '🖼️', isSpecial: true },
    { value: 'doubao-1-5-thinking-pro-250415', label: ' 豆包 1.5 Thinking Pro', supportsImage: false, imageLabel: '📝', isSpecial: true },
    { value: 'doubao-1-5-vision-pro-32k-250115', label: ' 豆包 1.5 Vision Pro 32k', supportsImage: true, imageLabel: '🖼️', isSpecial: false },
    { value: 'doubao-seed-1-6-flash-250715', label: ' 豆包 Seed 1.6 Flash 250715', supportsImage: true, imageLabel: '🖼️', isSpecial: false },
    { value: 'doubao-seed-1-6-flash-250615', label: ' 豆包 Seed 1.6 Flash 250615', supportsImage: true, imageLabel: '🖼️', isSpecial: true },
    { value: 'doubao-1-5-thinking-vision-pro-250428', label: ' 豆包 1.5 Thinking Vision Pro', supportsImage: true, imageLabel: '🖼️', isSpecial: true },
    { value: 'doubao-1-5-ui-tars-250428', label: ' 豆包 1.5 UI Tars', supportsImage: true, imageLabel: '🖼️', isSpecial: true },
    { value: 'doubao-1-5-pro-32k-250115', label: ' 豆包 1.5 Pro 32k', supportsImage: false, imageLabel: '📝', isSpecial: false },
    { value: 'doubao-1-5-pro-32k-character-250715', label: ' 豆包 1.5 Pro 32k Character', supportsImage: false, imageLabel: '📝', isSpecial: true },
    { value: 'deepseek-r1-250528', label: 'DeepSeek R1', supportsImage: false, imageLabel: '📝', isSpecial: true },
    { value: 'deepseek-v3-250324', label: 'DeepSeek V3', supportsImage: false, imageLabel: '📝', isSpecial: true },
    { value: 'kimi-k2-250711', label: 'Kimi K2', supportsImage: false, imageLabel: '📝', isSpecial: true }
  ]
} as const;

// 获取模型名称选项的函数
const getModelNameOptions = (modelService: string) => {
  return MODEL_NAMES[modelService as keyof typeof MODEL_NAMES] || MODEL_NAMES.deepseek;
};

// 检查模型是否支持图片的函数
const isModelSupportsImage = (modelService: string, modelName: string) => {
  if (modelService === 'doubao') {
    const modelConfig = MODEL_NAMES.doubao.find(model => model.value === modelName);
    return modelConfig?.supportsImage || false;
  }
  
  return false;
};

// 获取模型的默认参数
const getModelDefaultParams = (modelService: string, modelName: string): Record<string, any> => {
  const providerConfig = (modelParamsConfig as any)[modelService] || {};
  const globalModelConfig = (modelParamsConfig as any)[modelName]?.default || (modelParamsConfig as any)[modelName] || null;
  const providerModelConfig = providerConfig[modelName]?.default || providerConfig[modelName] || null;
  
  // 优先按【模型名称】顶层配置；其次按厂商下的该模型ID；再回退厂商默认；Ollama 兜底通用默认
  const schema = globalModelConfig
    || providerModelConfig
    || providerConfig.default
    || (modelService === 'ollama' ? (modelParamsConfig as any).ollama?.default : [])
    || [];
  
  const defaultParams: Record<string, any> = {};
  schema.forEach((param: any) => {
    defaultParams[param.key] = param.default;
  });
  
  console.log(`📋 获取模型默认参数 [${modelService}/${modelName}]:`, defaultParams);
  
  return defaultParams;
};

// 获取模型服务对应的默认地址
const getDefaultBaseUrl = (modelService: string): string => {
  switch (modelService) {
    case 'doubao':
      return 'https://ark.cn-beijing.volces.com/api/v3';
    case 'deepseek':
      return 'https://api.deepseek.com';
    case 'ollama':
      return 'http://localhost:11434';  // 使用你的实际 Ollama 服务地址
    default:
      return '';
  }
};

// 从后端获取模型配置
const getModelConfigFromServer = async (modelService: string): Promise<{baseUrl: string, apiKey: string} | null> => {
  try {
    // Ollama 特殊处理，不需要从后端获取配置
    if (modelService === 'ollama') {
      console.log('[DEBUG] Ollama 使用默认配置');
      return {
        baseUrl: getDefaultBaseUrl('ollama'),
        apiKey: 'ollama'  // Ollama 使用占位符 API key
      };
    }
    
    // 从authStore获取token
    const authState = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    const token = authState.state?.token;
    
    if (!token) {
      console.error('没有找到认证token，请先登录');
      return null;
    }
    
    console.log(`[DEBUG] 开始请求 ${modelService} 配置，token: ${token.substring(0, 10)}...`);
    
    const response = await fetch(`/api/auth/model-config/${modelService}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`[DEBUG] API响应状态: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const config = await response.json();
      console.log(`获取到 ${modelService} 配置:`, config);
      return {
        baseUrl: config.base_url,
        apiKey: config.api_key
      };
    } else {
      const errorText = await response.text();
      console.error(`获取 ${modelService} 配置失败:`, response.status, response.statusText, errorText);
    }
    return null;
  } catch (error) {
    console.error('获取模型配置失败:', error);
    return null;
  }
};

const Chat: React.FC = () => {
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const [deletingAccount, setDeletingAccount] = useState(false);
  // 状态管理
  const [modelService, setModelService] = useState('deepseek');
  const [enableVoice, setEnableVoice] = useState(() => {
    const saved = localStorage.getItem('enableVoice');
    return saved !== null ? JSON.parse(saved) : false;  // 默认为false
  });
  const [enableTextCleaning, setEnableTextCleaning] = useState(() => {
    const saved = localStorage.getItem('enableTextCleaning');
    return saved !== null ? JSON.parse(saved) : true;  // 默认为true
  });
  const [showAudioPlayer, setShowAudioPlayer] = useState(() => {
    const saved = localStorage.getItem('showAudioPlayer');
    return saved !== null ? JSON.parse(saved) : false;  // 默认为false
  });
  const [currentMessage, setCurrentMessage] = useState('');
  const [sent_flag, setSentFlag] = useState(false);  // 添加发送标记状态
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modelSettings, setModelSettings] = useState<ModelSettings>({
    modelService: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    modelName: 'deepseek-chat',
    apiKey: ''
  });
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [systemPromptModalVisible, setSystemPromptModalVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const messageListRef = useRef<HTMLDivElement>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const heartbeatTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const hasEverOpenedRef = useRef<boolean>(false);
  const suppressReconnectToastUntilRef = useRef<number>(0);

  const [editingSession, setEditingSession] = useState<ChatSession | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [siderVisible, setSiderVisible] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>('');
  // 背景图片相关
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string>('');
  // Track last manual set time to avoid race with background fetch
  const backgroundManuallySetAtRef = useRef<number>(0);
  // Track latest background fetch sequence to prevent stale updates
  const backgroundFetchSeqRef = useRef<number>(0);
  // Keep current object URL to revoke when updating background
  const backgroundObjectUrlRef = useRef<string | null>(null);
  
  // 记录"修改背景图片"的目标（可能是当前会话，也可能是其他会话）
  const [backgroundUploadTarget, setBackgroundUploadTarget] = useState<
    | { type: 'traditional'; sessionId: string }
    | { type: 'assistant'; assistantId: string; sessionId: string }
    | null
  >(null);

  

  // 图片相关状态
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [currentSessionSupportsImage, setCurrentSessionSupportsImage] = useState(false);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string>('');
  const [compressorModalVisible, setCompressorModalVisible] = useState(false);
  const [isViewingPendingImage, setIsViewingPendingImage] = useState(false);
    const [isModelTyping, setIsModelTyping] = useState(false); // 模型正在输入状态
  // 设置模态框可见性
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
   
   // 图片预览增强状态
  const [imageScale, setImageScale] = useState(1);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialFitScale, setInitialFitScale] = useState(1); // 初始适配缩放比例
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });

  // Ollama 动态模型列表
  const [ollamaModels, setOllamaModels] = useState<{ value: string; label: string }[]>([]);
  const [isLoadingOllamaModels, setIsLoadingOllamaModels] = useState(false);
  const [ollamaModelsLoadedForBaseUrl, setOllamaModelsLoadedForBaseUrl] = useState<string | null>(null);

  // 规范化 URL，若缺少协议则补全为 http://
  const ensureHttpProtocol = useCallback((url: string): string => {
    if (!url) return url;
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `http://${trimmed}`;
  }, []);

  const fetchOllamaModels = useCallback(async (baseUrl: string) => {
    const normalizedBaseUrl = ensureHttpProtocol(baseUrl);
    if (!normalizedBaseUrl) return;
    if (ollamaModelsLoadedForBaseUrl === normalizedBaseUrl && ollamaModels.length > 0) return;
    setIsLoadingOllamaModels(true);
    try {
      const directResp = await fetch(`${normalizedBaseUrl.replace(/\/$/, '')}/api/tags`, { method: 'GET' });
      if (!directResp.ok) {
        throw new Error(`direct ${directResp.status}`);
      }
      const data = await directResp.json();
      const models = (data.models || []).map((m: any) => ({ value: m.name, label: m.name }));
      setOllamaModels(models);
      setOllamaModelsLoadedForBaseUrl(normalizedBaseUrl);
      if (models.length === 0) message.warning('Ollama 未找到可用模型，请先执行 ollama pull');
    } catch (_err) {
      try {
        const authState = JSON.parse(localStorage.getItem('auth-storage') || '{}');
        const token = authState.state?.token;
        const resp = await fetch(`/api/chat/ollama/tags?base_url=${encodeURIComponent(normalizedBaseUrl)}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text);
        }
        const data = await resp.json();
        const models = (data.models || []).map((m: any) => ({ value: m.name, label: m.name }));
        setOllamaModels(models);
        setOllamaModelsLoadedForBaseUrl(normalizedBaseUrl);
        if (models.length === 0) message.warning('Ollama 未找到可用模型，请先执行 ollama pull');
      } catch (err) {
        console.error('[Chat] 获取 Ollama 模型列表失败:', err);
        message.error('获取 Ollama 模型列表失败，请检查服务地址或网络');
      }
    } finally {
      setIsLoadingOllamaModels(false);
    }
  }, [ensureHttpProtocol, ollamaModelsLoadedForBaseUrl, ollamaModels.length]);

  // 删除消息相关状态
  const [deleteMessageModalVisible, setDeleteMessageModalVisible] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<{index: number, content: string} | null>(null);

  // 修改消息相关状态
  const [editMessageModalVisible, setEditMessageModalVisible] = useState(false);
  const [messageToEdit, setMessageToEdit] = useState<{index: number, content: string, images?: string[]} | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [editedImages, setEditedImages] = useState<string[]>([]);

  // 导出对话数据相关状态
  const [exportChatModalVisible, setExportChatModalVisible] = useState(false);
  const [exportingSession, setExportingSession] = useState<ChatSession | null>(null);
  const [exportFileName, setExportFileName] = useState('');
  const [exportFormat, setExportFormat] = useState<'txt' | 'json'>('txt');
  const [exportIncludeTimestamps, setExportIncludeTimestamps] = useState<boolean>(true);
  const [exportIncludeSystemPrompts, setExportIncludeSystemPrompts] = useState<boolean>(true);
  
  // 管理深度思考展开状态
  const [thinkingSectionStates, setThinkingSectionStates] = useState<{[key: string]: boolean}>({});
  
  // 创建一个稳定的切换函数
  const toggleThinkingSection = useCallback((stateKey: string) => {
    setThinkingSectionStates(prev => ({
      ...prev,
      [stateKey]: !prev[stateKey]
    }));
  }, []);

  // 在组件顶部添加新的状态
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<{
    session_id: string; // 添加会话ID
    modelSettings: ModelSettings;
    systemPrompt: string;
    contextCount: number | null; // 添加上下文数量，null表示不限制
  } | null>(null);

  // 知识库配置状态
  const [kbConfigModalVisible, setKbConfigModalVisible] = useState(false);
  const [kbEditingSession, setKbEditingSession] = useState<ChatSession | null>(null);
  const [kbConfig, setKbConfig] = useState<any>({
    enabled: false,
    vector_db: 'chroma',
    collection_name: '',
    kb_prompt_template: '',
    embeddings: {
      provider: 'ollama', // 'ollama' | 'local' | 'ark'
      model: '',
      base_url: getDefaultBaseUrl('ollama'),
      api_key: '',
      local_model_path: 'backend/models/all-MiniLM-L6-v2'
    },
    split_params: {
      chunk_size: 500,
      chunk_overlap: 100,
      separators: ['\n\n', '\n', '。', '！', '？', '，', ' ', '']
    }
  });
  

  // 依提供商加载可选模型（Ollama 走已有方法）
  const [kbOllamaModels, setKbOllamaModels] = useState<{ value: string; label: string }[]>([]);
  const handleKbProviderChange = useCallback(async (provider: string) => {
    setKbConfig((prev: any) => {
      const next = { ...prev, embeddings: { ...prev.embeddings, provider } } as any;
      // 当切换为不同厂商时，若模型未设置，则填入合理的默认值，避免仅在UI上显示但状态为空
      if (provider === 'ark') {
        if (!next.embeddings.model) next.embeddings.model = 'doubao-embedding-large-text-250515';
        // ark 不需要 base_url，本地路径也清理
        delete next.embeddings.base_url;
        // 保留 api_key 字段
      } else if (provider === 'local') {
        if (!next.embeddings.model) next.embeddings.model = 'all-MiniLM-L6-v2';
        if (!next.embeddings.local_model_path) next.embeddings.local_model_path = 'backend/models/all-MiniLM-L6-v2';
        delete next.embeddings.base_url;
        delete next.embeddings.api_key;
      } else if (provider === 'ollama') {
        // ollama 使用 base_url；保留 model，若未选中置空
        if (!next.embeddings.base_url) next.embeddings.base_url = getDefaultBaseUrl('ollama');
        if (!next.embeddings.model) next.embeddings.model = '';
        delete next.embeddings.api_key;
        delete next.embeddings.local_model_path;
      }
      return next;
    });

    if (provider === 'ollama') {
      const baseUrl = kbConfig.embeddings?.base_url || getDefaultBaseUrl('ollama');
      await fetchOllamaModels(baseUrl);
      setKbOllamaModels(ollamaModels);
    }
  }, [fetchOllamaModels, kbConfig.embeddings?.base_url, ollamaModels]);

  const handleSaveKbConfig = async () => {
    if (!kbEditingSession) { message.error('未选择会话'); return; }
    // 基础校验
    if (kbConfig.enabled) {
      if (!kbConfig.collection_name?.trim()) { message.error('请输入知识库名称'); return; }
      if (kbConfig.embeddings?.provider === 'ollama') {
        if (!kbConfig.embeddings?.base_url) { message.error('请输入 Ollama 服务地址'); return; }
        if (!kbConfig.embeddings?.model) { message.error('请选择 Ollama 模型'); return; }
      } else if (kbConfig.embeddings?.provider === 'local') {
        // 固定模型
        setKbConfig((prev: any) => ({ ...prev, embeddings: { ...prev.embeddings, model: 'all-MiniLM-L6-v2' } }));
      } else if (kbConfig.embeddings?.provider === 'ark') {
        if (!kbConfig.embeddings?.api_key) { message.error('请输入火山引擎 API Key'); return; }
        if (!kbConfig.embeddings?.model) { message.error('请选择火山引擎嵌入模型'); return; }
      }
    }
    try {
      await updateSession(kbEditingSession.session_id, { kb_settings: kbConfig } as any);
      // 同步保存为用户默认KB配置
      try {
        await authAxios.put('/api/kb/user_settings', { kb_settings: kbConfig });
      } catch (e) {
        console.warn('[KB] 保存用户KB默认配置失败');
      }
      message.success('知识库配置已保存');
      setKbConfigModalVisible(false);
      setKbEditingSession(null);
      await useChatStore.getState().fetchSessions();
    } catch (e) {
      console.error(e);
      message.error('保存失败');
    }
  };

  // KB 文件上传与解析
  const kbFileInputRef = useRef<HTMLInputElement>(null);
  const [kbSelectedFile, setKbSelectedFile] = useState<File | null>(null);
  const [kbParsing, setKbParsing] = useState(false);

  const handleKbFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    setKbSelectedFile(f || null);
  }, []);

  const handleKbParseFile = useCallback(async () => {
    if (!kbSelectedFile) { message.error('请先选择文件'); return; }
    if (!kbConfig.enabled) { message.error('请先启用知识库'); return; }
    if (!kbConfig.collection_name?.trim()) { message.error('请输入知识库名称'); return; }
    if (!kbEditingSession) { message.error('未选择会话'); return; }

    try {
      setKbParsing(true);
      const form = new FormData();
      form.append('file', kbSelectedFile);
      form.append('kb_settings_json', JSON.stringify(kbConfig));
      form.append('session_id', kbEditingSession.session_id);
      const resp = await authAxios.post('/api/kb/upload_and_ingest', form);
      const data = resp.data;
      message.success(`解析并入库成功，分片数: ${data.chunks}`);
      await useChatStore.getState().fetchSessions();
      const latestSessions = useChatStore.getState().sessions;
      const latest = latestSessions.find(s => s.session_id === kbEditingSession.session_id);
      if (latest) setKbEditingSession(latest as any);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message;
      message.error(detail || '解析失败');
    } finally {
      setKbParsing(false);
    }
  }, [kbSelectedFile, kbConfig, kbEditingSession]);

  // 添加电脑端侧边栏折叠状态
  const [desktopSiderCollapsed, setDesktopSiderCollapsed] = useState(false);

  // 用户头像相关状态
  const [userAvatarModalVisible, setUserAvatarModalVisible] = useState(false);
  const [userAvatar, setUserAvatar] = useState<string>('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // 处理TTS配置点击
  const handleTtsConfigClick = async (session: ChatSession) => {
    console.log('[TTS] 开始处理TTS配置点击');
    console.log('[TTS] 目标会话:', session.session_id, session.name);
    
    try {
      // 从authStore获取token
      const authState = JSON.parse(localStorage.getItem('auth-storage') || '{}');
      const token = authState.state?.token;
      
      if (!token) {
        console.error('[TTS] 没有找到认证token');
        message.error('请先登录');
        return;
      }
      
      console.log('[TTS] 开始查询会话TTS配置');
      
      // 查询会话的TTS配置
      const response = await fetch(`/api/chat/sessions/${session.session_id}/tts-config`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('[TTS] API响应状态:', response.status, response.statusText);
      
      if (response.ok) {
        const result = await response.json();
        console.log('[TTS] 查询结果:', result);
        
        if (result.success && result.has_config && result.tts_settings) {
          const ttsSettings = result.tts_settings;
          console.log('[TTS] 找到已保存的TTS配置:', ttsSettings);
          console.log('[TTS] 服务商:', ttsSettings.provider);
          console.log('[TTS] 配置信息:', ttsSettings.config);
          console.log('[TTS] 音色设置:', ttsSettings.voice_settings);
          
          // 设置TTS配置状态
          setTtsConfig({
            provider: ttsSettings.provider,
            config: ttsSettings.config || {},
            voiceSettings: ttsSettings.voice_settings || {}
          });
          
          // 设置选中的TTS服务商
          setSelectedTtsProvider(ttsSettings.provider);
          
          console.log('[TTS] 自动填入配置完成，直接打开配置模态框');
          
          // 直接打开TTS配置模态框，跳过服务商选择
          setTtsConfigModalVisible(true);
          
          message.success(`已加载 ${ttsSettings.provider === 'xfyun' ? '讯飞云' : '字节跳动'} TTS配置`);
        } else {
          console.log('[TTS] 未找到TTS配置，显示服务商选择界面');
          // 没有配置，显示服务商选择界面
          setTtsProviderModalVisible(true);
        }
      } else {
        const errorText = await response.text();
        console.error('[TTS] 查询TTS配置失败:', response.status, response.statusText, errorText);
        message.error('查询TTS配置失败');
        
        // 出错时也显示服务商选择界面
        setTtsProviderModalVisible(true);
      }
    } catch (error) {
      console.error('[TTS] 查询TTS配置异常:', error);
      message.error('查询TTS配置失败');
      
      // 出错时也显示服务商选择界面
      setTtsProviderModalVisible(true);
    }
  };

  // 角色信息相关状态
  const [roleInfoModalVisible, setRoleInfoModalVisible] = useState(false);
  const [roleAvatar, setRoleAvatar] = useState<string>('');
  const [isUploadingRoleAvatar, setIsUploadingRoleAvatar] = useState(false);
  // 新增：助手会话编辑状态
  const [editingAssistantSession, setEditingAssistantSession] = useState<AssistantSession | null>(null);

  // 头像裁剪相关状态
  const [userAvatarCropperVisible, setUserAvatarCropperVisible] = useState(false);
  const [roleAvatarCropperVisible, setRoleAvatarCropperVisible] = useState(false);
  const [tempAvatarUrl, setTempAvatarUrl] = useState<string>('');
  // 新增：助手头像裁剪
  const [assistantAvatarCropperVisible, setAssistantAvatarCropperVisible] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<ChatAssistant | null>(null);

  // TTS相关状态
  const [ttsProviderModalVisible, setTtsProviderModalVisible] = useState(false);
  const [ttsConfigModalVisible, setTtsConfigModalVisible] = useState(false);
  const [selectedTtsProvider, setSelectedTtsProvider] = useState<string>('');
  const [ttsConfig, setTtsConfig] = useState<{
    provider: string;
    config: Record<string, string>;
    voiceSettings?: Record<string, any>;
  }>({
    provider: '',
    config: {},
    voiceSettings: {}
  });
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [showVoiceSearch, setShowVoiceSearch] = useState(false);
  const [voiceSearchQuery, setVoiceSearchQuery] = useState('');

  // 系统设置：对话背景开关（默认关闭），持久化到 localStorage
  const [enableChatBackground, setEnableChatBackground] = useState<boolean>(() => {
    try {
      return localStorage.getItem('enableChatBackground') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('enableChatBackground', enableChatBackground ? '1' : '0');
    } catch {}
  }, [enableChatBackground]);

  // 处理电脑端侧边栏折叠
  const toggleDesktopSider = () => {
    setDesktopSiderCollapsed(prev => !prev);
  };



  // 图片处理函数
  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const processedFiles: File[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // 检查文件类型
        if (!file.type.startsWith('image/')) {
          message.error(`文件 ${file.name} 不是图片格式`);
          continue;
        }
        
        // 检查文件大小 (限制为10MB)
        if (file.size > 10 * 1024 * 1024) {
          message.error(`图片文件 ${file.name} 大小不能超过10MB`);
          continue;
        }
        
        try {
          // 为了确保与后端PNG格式完全兼容，所有图片都转换为PNG
          console.log(`按钮上传图片格式: ${file.type}，转换为PNG以确保兼容性`);
          const processedFile = await convertImageToPNG(file);
          
          processedFiles.push(processedFile);
        
        // 创建预览
        const reader = new FileReader();
        reader.onload = (e) => {
          const preview = e.target?.result as string;
          setImagePreviews(prev => [...prev, preview]);
        };
          reader.readAsDataURL(processedFile);
        } catch (error) {
          console.error(`图片处理失败 ${file.name}:`, error);
          message.error(`图片 ${file.name} 处理失败，请重试`);
          continue;
        }
      }
      
      if (processedFiles.length > 0) {
        setSelectedImages(prev => [...prev, ...processedFiles]);
        message.success(`成功添加 ${processedFiles.length} 张图片`);
      }
    }
  };

  const handleImageRemove = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleImageRemoveAll = () => {
    setSelectedImages([]);
    setImagePreviews([]);
  };

  const handleImageClick = (imageUrl: string, isPending: boolean = false) => {
    setSelectedImage(imageUrl);
    setImageModalVisible(true);
    setIsViewingPendingImage(isPending);
    // 重置图片状态
    setImageScale(1);
    setImagePosition({ x: 0, y: 0 });
    setIsDragging(false);
  };

  const handleImageModalClose = () => {
    setImageModalVisible(false);
    setSelectedImage('');
    // 重置图片状态
    setImageScale(1);
    setImagePosition({ x: 0, y: 0 });
    setIsDragging(false);
    setInitialFitScale(1);
    setImageNaturalSize({ width: 0, height: 0 });
    // 清理定时器
    if (wheelTimeoutRef.current) {
      clearTimeout(wheelTimeoutRef.current);
    }
  };

  // 处理图片压缩
  const handleImageCompress = () => {
    // 只有当显示的是待发送图片时才允许压缩
    if (isViewingPendingImage && imagePreviews.length > 0 && selectedImages.length > 0) {
      setCompressorModalVisible(true);
    } else {
      message.warning('只能压缩待发送的图片');
    }
  };

  const handleCompressorCancel = () => {
    setCompressorModalVisible(false);
  };

  const handleCompressorConfirm = (compressedImages: File[], compressedPreviews: string[]) => {
    // 更新待发送的图片列表
    setSelectedImages(compressedImages);
    setImagePreviews(compressedPreviews);
    setCompressorModalVisible(false);
    setImageModalVisible(false);
    message.success(`已压缩 ${compressedImages.length} 张图片`);
  };

  // 图片预览容器鼠标滚动事件处理
  const handleImagePreviewWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const container = event.currentTarget;
    const scrollAmount = event.deltaY > 0 ? 100 : -100;
    container.scrollLeft += scrollAmount;
  };

  // 计算图片的最佳适配缩放比例
  const calculateFitScale = (imageWidth: number, imageHeight: number, containerWidth: number, containerHeight: number) => {
    if (imageWidth === 0 || imageHeight === 0 || containerWidth === 0 || containerHeight === 0) {
      return 1;
    }

    // 计算宽度和高度的缩放比例
    const widthScale = containerWidth / imageWidth;
    const heightScale = containerHeight / imageHeight;
    
    // 选择较小的缩放比例，确保图片完全适应容器
    const fitScale = Math.min(widthScale, heightScale);
    
    // 限制最小和最大缩放比例
    return Math.min(Math.max(fitScale, 0.1), 1);
  };

  // 图片加载完成后计算适配比例
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.target as HTMLImageElement;
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    
    // 保存图片原始尺寸
    setImageNaturalSize({ width: naturalWidth, height: naturalHeight });
    
    // 获取容器尺寸（需要减去padding）
    const container = img.closest(`.${styles.imageModalContainer}`) as HTMLElement;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width - 40; // 减去左右padding (20px * 2)
      const containerHeight = containerRect.height - 40; // 减去上下padding (20px * 2)
      
      // 计算最佳适配比例
      const fitScale = calculateFitScale(naturalWidth, naturalHeight, containerWidth, containerHeight);
      
      console.log('图片自适应计算:', {
        naturalWidth,
        naturalHeight,
        containerWidth,
        containerHeight,
        fitScale
      });
      
      // 设置初始适配比例
      setInitialFitScale(fitScale);
      setImageScale(fitScale);
    }
    
    // 确保图片可见
    img.style.visibility = 'visible';
  };

  // 图片预览操作函数
  const handleImageZoomIn = () => {
    setImageScale(prev => Math.min(prev + 0.2, initialFitScale * 3)); // 基于初始适配比例的3倍
  };

  const handleImageZoomOut = () => {
    setImageScale(prev => Math.max(prev - 0.2, initialFitScale * 0.1)); // 基于初始适配比例的0.1倍
  };

  const handleImageResetZoom = () => {
    setImageScale(initialFitScale); // 重置到初始适配比例
    setImagePosition({ x: 0, y: 0 });
  };

  // 适合窗口大小
  const handleImageFitToWindow = () => {
    if (imageNaturalSize.width > 0 && imageNaturalSize.height > 0) {
      const container = document.querySelector(`.${styles.imageModalContainer}`) as HTMLElement;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const containerWidth = containerRect.width - 40;
        const containerHeight = containerRect.height - 40;
        
        const fitScale = calculateFitScale(
          imageNaturalSize.width, 
          imageNaturalSize.height, 
          containerWidth, 
          containerHeight
        );
        
        setImageScale(fitScale);
        setImagePosition({ x: 0, y: 0 });
      }
    }
  };



  const handleImageDownload = async () => {
    if (!selectedImage) return;
    
    try {
      const response = await fetch(selectedImage);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `image_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('图片下载成功');
    } catch (error) {
      console.error('下载图片失败:', error);
      message.error('图片下载失败');
    }
  };

  // 图片拖拽处理 - 使用useCallback优化性能
  const handleImageMouseDown = useCallback((e: React.MouseEvent) => {
    if (imageScale <= initialFitScale) return; // 只有超过初始适配比例时才能拖拽
    setIsDragging(true);
    setDragStart({
      x: e.clientX - imagePosition.x,
      y: e.clientY - imagePosition.y
    });
    e.preventDefault();
  }, [imageScale, initialFitScale, imagePosition.x, imagePosition.y]);

  const handleImageMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || imageScale <= initialFitScale) return;
    setImagePosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  }, [isDragging, imageScale, initialFitScale, dragStart.x, dragStart.y]);

  const handleImageMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 鼠标滚轮缩放 - 使用节流优化性能
  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const handleImageWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    
    // 清除之前的定时器
    if (wheelTimeoutRef.current) {
      clearTimeout(wheelTimeoutRef.current);
    }
    
    // 设置新的定时器，节流处理
    wheelTimeoutRef.current = setTimeout(() => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1; // 适中的缩放步长
      setImageScale(prev => {
        const minScale = initialFitScale * 0.1; // 基于初始适配比例的最小值
        const maxScale = initialFitScale * 3;   // 基于初始适配比例的最大值
        const newScale = Math.max(minScale, Math.min(maxScale, prev + delta));
        return Math.round(newScale * 100) / 100; // 保留两位小数，减少重渲染
      });
    }, 16); // 约60fps
  }, [initialFitScale]);

  // 键盘事件处理
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!imageModalVisible) return;
      
      switch (e.key) {
        case 'Escape':
          handleImageModalClose();
          break;
        case '+':
        case '=':
          handleImageZoomIn();
          break;
        case '-':
          handleImageZoomOut();
          break;
        case '0':
          handleImageResetZoom();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [imageModalVisible]);

  // 用户头像相关处理函数
  const handleUserAvatarClick = () => {
    setUserAvatarModalVisible(true);
  };

  const handleUserAvatarModalClose = () => {
    setUserAvatarModalVisible(false);
  };

  const handleAvatarUpload = async (file: File) => {
    try {
      // 检查文件类型
      if (!file.type.startsWith('image/')) {
        message.error('请选择图片文件');
        return false;
      }
      
      // 检查文件大小 (限制为5MB)
      if (file.size > 5 * 1024 * 1024) {
        message.error('头像文件大小不能超过5MB');
        return false;
      }
      
      // 创建临时URL用于裁剪
      const tempUrl = URL.createObjectURL(file);
      setTempAvatarUrl(tempUrl);
      setUserAvatarCropperVisible(true);
      
      return false; // 阻止默认上传行为
    } catch (error) {
      console.error('头像处理失败:', error);
      message.error('头像处理失败，请重试');
      return false;
    }
  };

  const handleAvatarSave = async () => {
    // 只关闭模态框，不保存数据
    setUserAvatarModalVisible(false);
  };

  // 用户头像裁剪处理函数
  const handleUserAvatarCropConfirm = async (croppedImageUrl: string) => {
    try {
      setIsUploadingAvatar(true);
      
      // 将裁剪后的图片转换为base64
      const response = await fetch(croppedImageUrl);
      const blob = await response.blob();
      const base64 = await convertImageToBase64(blob as File);
      
      // 上传到后端
      const uploadResponse = await fetch('/api/auth/upload-avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${useAuthStore.getState().token}`
        },
        body: JSON.stringify({
          avatar: base64
        })
      });
      
      if (uploadResponse.ok) {
        const result = await uploadResponse.json();
        setUserAvatar(result.avatar_url);
        message.success('头像上传成功');
        setUserAvatarCropperVisible(false);
        setTempAvatarUrl('');
      } else {
        const error = await uploadResponse.json();
        message.error(error.detail || '头像上传失败');
      }
    } catch (error) {
      console.error('头像上传失败:', error);
      message.error('头像上传失败，请重试');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleUserAvatarCropCancel = () => {
    setUserAvatarCropperVisible(false);
    setTempAvatarUrl('');
  };

  // 角色头像相关处理函数
  const handleRoleAvatarUpload = async (file: File) => {
    try {
      // 检查文件类型
      if (!file.type.startsWith('image/')) {
        message.error('请选择图片文件');
        return false;
      }
      
      // 检查文件大小 (限制为5MB)
      if (file.size > 5 * 1024 * 1024) {
        message.error('头像文件大小不能超过5MB');
        return false;
      }
      
      // 创建临时URL用于裁剪
      const tempUrl = URL.createObjectURL(file);
      setTempAvatarUrl(tempUrl);
      setRoleAvatarCropperVisible(true);
      
      return false; // 阻止默认上传行为
    } catch (error) {
      console.error('角色头像处理失败:', error);
      message.error('角色头像处理失败，请重试');
      return false;
    }
  };

  const handleRoleInfoSave = async () => {
    if (!newSessionName.trim()) {
      message.error('会话名称不能为空');
      return;
    }

    try {
      setIsUploadingRoleAvatar(true);

      // 区分传统会话与助手会话
      if (editingAssistantSession) {
        // 助手会话：调用RAGFlow更新名称
        await ragflowService.updateSessionName(editingAssistantSession.id, newSessionName.trim());
        // 同步到本地状态
        setAssistantSessions(prev => prev.map(s => (
          s.id === editingAssistantSession.id ? { ...s, name: newSessionName.trim() } : s
        )));
      } else if (editingSession) {
        // 传统会话：沿用原有逻辑
        await updateSession(editingSession.session_id, { 
          name: newSessionName.trim() 
        });
      } else {
        return;
      }

      message.success('会话名称保存成功');
      setRoleInfoModalVisible(false);
      setNewSessionName('');
      setEditingSession(null);
      setEditingAssistantSession(null);
      setRoleAvatar('');
    } catch (error) {
      console.error('会话名称保存失败:', error);
      message.error('会话名称保存失败，请重试');
    } finally {
      setIsUploadingRoleAvatar(false);
    }
  };

  // 角色头像裁剪处理函数
  const handleRoleAvatarCropConfirm = async (croppedImageUrl: string) => {
    try {
      setIsUploadingRoleAvatar(true);
      
      // 将裁剪后的图片转换为base64
      const response = await fetch(croppedImageUrl);
      const blob = await response.blob();
      const base64 = await convertImageToBase64(blob as File);
      
      // 计算要上传的会话ID（兼容传统与助手会话）
      const sessionIdForUpload = editingAssistantSession
        ? editingAssistantSession.id
        : (editingSession?.session_id || '');
      if (!sessionIdForUpload) {
        throw new Error('缺少会话ID');
      }
      
      // 上传到后端：助手会话与传统会话分别走不同接口
      const uploadEndpoint = editingAssistantSession ? '/api/auth/upload-assistant-role-avatar' : '/api/auth/upload-role-avatar';
      const body: any = editingAssistantSession
        ? { avatar: base64, assistant_id: editingAssistantSession.assistant_id, session_id: sessionIdForUpload }
        : { avatar: base64, session_id: sessionIdForUpload };
      const uploadResponse = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${useAuthStore.getState().token}`
        },
        body: JSON.stringify(body)
      });
      
      if (uploadResponse.ok) {
        const result = await uploadResponse.json();
        setRoleAvatar(result.avatar_url);
        message.success('角色头像上传成功');
        setRoleAvatarCropperVisible(false);
        setTempAvatarUrl('');
        
        // 更新本地会话中的角色头像
        if (editingAssistantSession) {
          setAssistantSessions(prev => prev.map(s => (
            s.id === editingAssistantSession.id ? { ...s, role_avatar_url: result.avatar_url } : s
          )));
          // 如果当前正在编辑的就是当前激活的助手会话，同步更新
          setCurrentAssistantSession(prev => prev && prev.id === editingAssistantSession.id 
            ? { ...prev, role_avatar_url: result.avatar_url } 
            : prev);
        } else if (editingSession) {
          await updateSession(editingSession.session_id, {
            role_avatar_url: result.avatar_url
          });
        }
      } else {
        const error = await uploadResponse.json();
        message.error(error.detail || '角色头像上传失败');
      }
    } catch (error) {
      console.error('角色头像上传失败:', error);
      message.error('角色头像上传失败，请重试');
    } finally {
      setIsUploadingRoleAvatar(false);
    }
  };

  const handleRoleAvatarCropCancel = () => {
    setRoleAvatarCropperVisible(false);
    setTempAvatarUrl('');
  };

  // 新增：助手头像上传（打开裁剪框）
  const handleAssistantAvatarUpload = async (file: File) => {
    try {
      if (!file.type.startsWith('image/')) {
        message.error('请选择图片文件');
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        message.error('头像文件大小不能超过5MB');
        return false;
      }
      const tempUrl = URL.createObjectURL(file);
      setTempAvatarUrl(tempUrl);
      setAssistantAvatarCropperVisible(true);
      return false;
    } catch (error) {
      console.error('助手头像处理失败:', error);
      message.error('助手头像处理失败，请重试');
      return false;
    }
  };

  // 新增：助手头像裁剪确认 -> 上传到后端并更新助手资料
  const handleAssistantAvatarCropConfirm = async (croppedImageUrl: string) => {
    if (!editingAssistant) {
      setAssistantAvatarCropperVisible(false);
      setTempAvatarUrl('');
      return;
    }
    try {
      setIsUploadingAvatar(true);
      const response = await fetch(croppedImageUrl);
      const blob = await response.blob();
      const base64 = await convertImageToBase64(blob as File);

      // 先上传到我们后端，得到 MinIO URL
      const uploadResp = await fetch('/api/auth/upload-assistant-avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${useAuthStore.getState().token}`
        },
        body: JSON.stringify({
          avatar: base64,
          assistant_id: editingAssistant.id,
        })
      });

      if (!uploadResp.ok) {
        const err = await uploadResp.json().catch(() => ({}));
        throw new Error(err.detail || '助手头像上传失败');
      }
      const { avatar_url } = await uploadResp.json();

      // 调用 RAGFlow 更新助手信息
      await useRAGFlowStore.getState().updateAssistant(editingAssistant.id, { avatar: avatar_url });

      message.success('助手头像上传成功');
      setAssistantAvatarCropperVisible(false);
      setTempAvatarUrl('');
    } catch (error) {
      console.error('助手头像上传失败:', error);
      message.error('助手头像上传失败，请重试');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // 新增：助手头像裁剪取消
  const handleAssistantAvatarCropCancel = () => {
    setAssistantAvatarCropperVisible(false);
    setTempAvatarUrl('');
  };

  // 将MinIO URL转换为HTTP API URL
  const convertMinioUrlToHttp = (minioUrl: string): string => {
    try {
      if (!minioUrl || !minioUrl.startsWith('minio://')) {
        return minioUrl; // 如果不是MinIO URL，直接返回
      }
      
      // 解析minio://bucket/path/to/file.jpg
      const urlParts = minioUrl.replace('minio://', '').split('/');
      if (urlParts.length >= 3) {
        const pathParts = urlParts.slice(1);
        // 新结构：users/{userId}/avatar/{filename}
        if (pathParts.length >= 4 && pathParts[0] === 'users' && pathParts[2] === 'avatar') {
          const userId = pathParts[1];
          const filename = pathParts[3];
          return `${getFullUrl('')}/api/auth/avatar/${userId}/${filename}`;
        }
        // 新结构：users/{userId}/sessions/{sessionId}/role_avatar/{filename}
        if (pathParts.length >= 6 && pathParts[0] === 'users' && pathParts[2] === 'sessions' && pathParts[4] === 'role_avatar') {
          const userId = pathParts[1];
          const sessionId = pathParts[3];
          const filename = pathParts[5];
          return `${getFullUrl('')}/api/auth/role-avatar/${userId}/${sessionId}/${filename}`;
        }
        // 新结构：users/{userId}/assistants/{assistantId}/avatar/{filename}
        if (pathParts.length >= 6 && pathParts[0] === 'users' && pathParts[2] === 'assistants' && pathParts[4] === 'avatar') {
          const userId = pathParts[1];
          const assistantId = pathParts[3];
          const filename = pathParts[5];
          return `${getFullUrl('')}/api/auth/assistant-avatar/${userId}/${assistantId}/${filename}`;
        }
        // 新结构：users/{userId}/assistants/{assistantId}/sessions/{sessionId}/role_avatar/{filename}
        if (pathParts.length >= 8 && pathParts[0] === 'users' && pathParts[2] === 'assistants' && pathParts[4] === 'sessions' && pathParts[6] === 'role_avatar') {
          const userId = pathParts[1];
          const assistantId = pathParts[3];
          const sessionId = pathParts[5];
          const filename = pathParts[7];
          return `${getFullUrl('')}/api/auth/assistant-role-avatar/${userId}/${assistantId}/${sessionId}/${filename}`;
        }
        // 新结构：users/{userId}/sessions/{sessionId}/role_background/{filename} (传统会话背景图)
        if (pathParts.length >= 6 && pathParts[0] === 'users' && pathParts[2] === 'sessions' && pathParts[4] === 'role_background') {
          const userId = pathParts[1];
          const sessionId = pathParts[3];
          const filename = pathParts[5];
          return `${getFullUrl('')}/api/auth/role-background/${sessionId}`;
        }
        // 新结构：users/{userId}/assistants/{assistantId}/sessions/{sessionId}/role_background/{filename} (助手会话背景图)
        if (pathParts.length >= 8 && pathParts[0] === 'users' && pathParts[2] === 'assistants' && pathParts[4] === 'sessions' && pathParts[6] === 'role_background') {
          const userId = pathParts[1];
          const assistantId = pathParts[3];
          const sessionId = pathParts[5];
          const filename = pathParts[7];
          return `${getFullUrl('')}/api/auth/assistant-role-background/${sessionId}`;
        }
        // 新结构：users/{userId}/sessions/{sessionId}/message_image/{filename} (传统会话消息图片)
        if (pathParts.length >= 5 && pathParts[0] === 'users' && pathParts[2] === 'sessions' && pathParts[4] === 'message_image') {
          const userId = pathParts[1];
          const sessionId = pathParts[3];
          const filename = pathParts[5];
          console.log(`🔗 转换传统会话消息图片URL: users/${userId}/sessions/${sessionId}/message_image/${filename}`);
          return `${getFullUrl('')}/api/auth/message-image/${userId}/${sessionId}/${filename}`;
        }
        // 兼容旧结构：users/{userId}/sessions/{sessionId}/messages/{messageId}/{filename} (对话图片)
        if (pathParts.length >= 6 && pathParts[0] === 'users' && pathParts[2] === 'sessions' && pathParts[4] === 'messages') {
          const userId = pathParts[1];
          const sessionId = pathParts[3];
          const messageId = pathParts[5];
          const filename = pathParts[6];
          console.log(`🔗 转换对话图片URL（兼容旧路径）: users/${userId}/sessions/${sessionId}/messages/${messageId}/${filename}`);
          return `${getFullUrl('')}/api/auth/image/${userId}/${sessionId}/${messageId}/${filename}`;
        }
        // 旧结构：{sessionId}/{messageId}/{filename} (向后兼容)
        if (pathParts.length >= 3) {
          const sessionId = pathParts[0];
          const messageId = pathParts[1];
          const filename = pathParts[2];
          console.log(`🔗 转换对话图片URL（旧路径）: ${sessionId}/${messageId}/${filename}`);
          return `${getFullUrl('')}/api/auth/image/${sessionId}/${messageId}/${filename}`;
        }
        // 其他图片（如果未来也迁移到 users/{userId}/... 可在此扩展）。
      }
      
      return minioUrl; // 如果解析失败，返回原URL
    } catch (error) {
      console.error('转换MinIO URL失败:', error);
      return minioUrl; // 出错时返回原URL
    }
  };

  const convertImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // 移除 data:image/[format];base64, 前缀，只保留base64部分
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const convertImagesToBase64 = async (files: File[]): Promise<string[]> => {
    const promises = files.map(file => convertImageToBase64(file));
    return Promise.all(promises);
  };

  // 将图片转换为标准PNG格式（用于确保API兼容性）
  const convertImageToPNG = (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      // 创建图片对象
      const img = new Image();
      img.onload = () => {
        // 创建canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('无法创建canvas context'));
          return;
        }

        // 设置canvas尺寸
        canvas.width = img.width;
        canvas.height = img.height;

        // 绘制图片到canvas
        ctx.drawImage(img, 0, 0);

        // 转换为PNG格式的blob
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('无法转换图片格式'));
            return;
          }

          // 创建新的File对象，确保是PNG格式
          const pngFile = new File(
            [blob], 
            file.name.replace(/\.[^/.]+$/, '.png'), // 替换扩展名为.png
            { type: 'image/png' }
          );
          
          resolve(pngFile);
        }, 'image/png', 0.95); // 转换为PNG，质量0.95
      };

      img.onerror = () => {
        reject(new Error('图片加载失败'));
      };

      // 加载图片
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => {
        reject(new Error('文件读取失败'));
      };
      reader.readAsDataURL(file);
    });
  };

  // 从store获取状态和方法
  const { createSession, sessions, isLoading, error, fetchSessions, currentSession, setCurrentSession, updateSession, updateSessionMessageCount, deleteSession } = useChatStore();
  const { logout, user } = useAuthStore(); // 添加user
  const { theme } = useThemeStore(); // 获取主题状态
  const { 
    assistants, 
    currentAssistant, 
    setCurrentAssistant, 
    loadAssistants
    // loading: ragflowLoading,
    // config: ragflowConfig
  } = useRAGFlowStore(); // 添加RAGFlow状态

  // 根据主题获取模型服务配置
  const MODEL_SERVICES = useMemo(() => getModelServices(theme === 'dark'), [theme]);

  // 初始化用户头像
  useEffect(() => {
    if (user?.avatar_url) {
      setUserAvatar(user.avatar_url);
    }
  }, [user?.avatar_url]);

  // 添加会话ID的引用，用于消息隔离
  const currentSessionIdRef = useRef<string | null>(null);

  // 基于所选会话加载知识库配置，模态框打开或会话变化时同步
  useEffect(() => {
    if (!kbConfigModalVisible || !kbEditingSession) return;

    const defaults = {
      enabled: false,
      vector_db: 'chroma',
      collection_name: '',
      kb_prompt_template: '',
      embeddings: {
        provider: 'ollama',
        model: '',
        base_url: getDefaultBaseUrl('ollama'),
        api_key: '',
        local_model_path: 'backend/models/all-MiniLM-L6-v2'
      },
      split_params: {
        chunk_size: 500,
        chunk_overlap: 100,
        separators: ['\n\n', '\n', '。', '！', '？', '，', ' ', '']
      }
    } as any;

    const latest = sessions.find(s => s.session_id === kbEditingSession.session_id) || kbEditingSession;
    const kb = (latest as any).kb_settings || {};

    // 如果会话没有配置，尝试拉取用户默认KB配置
    const applyConfig = (baseKb: any) => {
      const merged = {
        ...defaults,
        ...baseKb,
        embeddings: { ...defaults.embeddings, ...(baseKb?.embeddings || {}) },
        split_params: { ...defaults.split_params, ...(baseKb?.split_params || {}) }
      } as any;
      // 若未设置知识库提示词，则默认填入当前会话原始提示词
      if (!merged.kb_prompt_template && (kbEditingSession as any)?.system_prompt) {
        merged.kb_prompt_template = (kbEditingSession as any).system_prompt;
      }
      setKbConfig(merged);
    };

    if (!kb || Object.keys(kb).length === 0) {
      (async () => {
        try {
          const resp = await authAxios.get('/api/kb/user_settings');
          const userKb = resp?.data?.kb_settings || {};
          applyConfig(userKb);
        } catch (e) {
          // 回退到默认
          applyConfig({});
        }
      })();
    } else {
      applyConfig(kb);
    }
  }, [kbConfigModalVisible, kbEditingSession, sessions]);

  // 当 sessions 更新时，若KB配置模态框打开，则用最新的会话对象同步 kbEditingSession（以便刷新 kb_parsed 等状态）
  useEffect(() => {
    if (!kbConfigModalVisible || !kbEditingSession) return;
    const latest = sessions.find(s => s.session_id === kbEditingSession.session_id);
    if (latest && (latest as any).kb_parsed !== (kbEditingSession as any).kb_parsed) {
      setKbEditingSession(latest as any);
    }
  }, [sessions, kbConfigModalVisible, kbEditingSession]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  
  // 助手相关状态
  const [assistantSessions, setAssistantSessions] = useState<AssistantSession[]>([]);
  const [batchDeleteModalVisible, setBatchDeleteModalVisible] = useState(false);
  const [batchAssistantId, setBatchAssistantId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const hiddenAssistantAvatarInputRef = useRef<HTMLInputElement | null>(null);
const hiddenBgInputRef = useRef<HTMLInputElement | null>(null);
  const [currentAssistantSession, setCurrentAssistantSession] = useState<AssistantSession | null>(null);
  const [isAssistantMode, setIsAssistantMode] = useState(false); // 是否处于助手对话模式
  const [collapsedAssistantIds, setCollapsedAssistantIds] = useState<Set<string>>(new Set());

  // 新增：传统会话批量删除相关状态
  const [traditionalBatchModalVisible, setTraditionalBatchModalVisible] = useState(false);
  const [selectedTraditionalSessionIds, setSelectedTraditionalSessionIds] = useState<string[]>([]);

  // 处理输入容器点击事件，自动聚焦到输入框
  const handleInputContainerClick = (e: React.MouseEvent) => {
    // 如果点击的是按钮或其他交互元素，不要聚焦输入框
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('.ant-btn')) {
      return;
    }
    // 聚焦到输入框
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };
  const [messageCountUpdated, setMessageCountUpdated] = useState(false); // 跟踪消息数量是否已更新
  
  // 检查是否在底部
  const isNearBottom = () => {
    const container = messageListRef.current;
    if (!container) return true;
    const threshold = 5; // 降低阈值到5px，让检测更灵敏
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
  };

  // 处理滚动事件
  const handleScroll = () => {
    setShouldAutoScroll(isNearBottom());
  };

  // 清理WebSocket连接
  const cleanupWebSocket = useCallback(() => {
    console.log('[Chat] 清理WebSocket连接');
    try { chatWSManager.close(); } catch {}
    setWs(null);
    setIsConnected(false);
    // 清理引用
    currentSessionIdRef.current = null;
  }, []);

  // 滚动到底部
  const scrollToBottom = () => {
    if (messageListRef.current && shouldAutoScroll) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  };

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) {
        setSiderVisible(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 监听语音相关状态变化并保存到localStorage
  useEffect(() => {
    localStorage.setItem('enableVoice', JSON.stringify(enableVoice));
  }, [enableVoice]);

  useEffect(() => {
    localStorage.setItem('enableTextCleaning', JSON.stringify(enableTextCleaning));
  }, [enableTextCleaning]);

  useEffect(() => {
    localStorage.setItem('showAudioPlayer', JSON.stringify(showAudioPlayer));
  }, [showAudioPlayer]);

  // 获取模型配置
  useEffect(() => {
    const loadInitialModelConfig = async () => {
      try {
        console.log('[Chat] 开始获取模型配置');
        const response = await fetch('/api/chat/model-config');
        if (!response.ok) {
          throw new Error('Failed to fetch model config');
        }
        const config = await response.json();
        console.log('[Chat] 获取到模型配置:', config);
        setModelSettings({
          modelService: config.modelService || modelService,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          modelName: config.modelName
        });
        console.log('[Chat] 模型配置已更新');
      } catch (error) {
        console.error('[Chat] 获取模型配置失败:', error);
        message.error('获取模型配置失败');
      }
    };

    console.log('[Chat] 组件初始化 - 开始获取数据');
    loadInitialModelConfig();
    fetchSessions(); // 获取用户的所有会话
    loadAssistants(); // 获取助手列表
  }, [fetchSessions, loadAssistants]);

  // 加载助手会话列表（使用本地持久化存储）
  const loadAssistantSessions = useCallback(async (assistantId: string) => {
    try {
      console.log('[Chat] 加载助手会话列表:', assistantId);
      
      // 调用后端API获取会话列表（优先本地，必要时同步RAGFlow）
      const ragflowSessions = await ragflowService.listSessions(assistantId);
      console.log('[Chat] 会话列表获取成功:', ragflowSessions);
      
      // 转换为前端会话格式
      const assistantObj = assistants.find(a => a.id === assistantId);
      const assistantName = assistantObj?.name || '未知助手';
      const formattedSessions: AssistantSession[] = ragflowSessions.map(session => ({
        id: session.id,
        name: session.name || '未命名对话',
        assistant_id: assistantId,
        assistant_name: assistantName,
        messages: [],
        message_count: session.message_count || 0,
        create_time: session.create_time || new Date().toISOString(),
        // 后端已返回会话级头像（若存在）；不再用助手头像覆盖
        role_avatar_url: session.role_avatar_url
      }));
      
      // 更新助手会话列表
      setAssistantSessions(prev => {
        // 移除该助手的旧会话，添加新会话
        const filtered = prev.filter(s => s.assistant_id !== assistantId);
        return [...filtered, ...formattedSessions];
      });
      
      console.log('[Chat] 助手会话加载完成，数量:', formattedSessions.length);
    } catch (error) {
      console.error('[Chat] 加载助手会话列表失败:', error);
      // 如果API调用失败，设置空列表而不是显示错误
      setAssistantSessions(prev => prev.filter(s => s.assistant_id !== assistantId));
    }
  }, [assistants]);

  // 页面加载时恢复RAGFlow助手会话
  useEffect(() => {
    if (assistants.length > 0) {
      console.log('[Chat] 助手列表加载完成，开始恢复RAGFlow会话...');
      
      // 将所有助手设置为默认折叠状态
      setCollapsedAssistantIds(prev => {
        const next = new Set(prev);
        assistants.forEach(assistant => {
          next.add(assistant.id);
        });
        return next;
      });
      
      // 为每个助手加载会话列表
      assistants.forEach(assistant => {
        loadAssistantSessions(assistant.id);
      });
    }
  }, [assistants, loadAssistantSessions]);

  // 处理System Prompt设置
  const handleSystemPromptSave = () => {
    setSystemPromptModalVisible(false);
    if (systemPrompt.trim()) {
      message.success('System Prompt已保存，将在创建新会话时使用');
    } else {
      setSystemPrompt('');
      message.info('System Prompt已清除，将使用默认值');
    }
  };

  // 修改创建会话的函数
  const handleCreateSession = async () => {
    console.log('[Chat] 点击创建新会话按钮');
    console.log('[Chat] 当前模型配置:', {
      modelService,
      baseUrl: modelSettings.baseUrl,
      apiKey: modelSettings.apiKey ? '已设置' : '未设置',
      modelName: modelSettings.modelName,
      systemPrompt: systemPrompt || '使用默认值'
    });

    // 1. 验证模型配置是否完整
    const validation = validateModelSettings(modelSettings);
    if (!validation.isValid) {
      message.error(validation.message);
      return;
    }

    // 2. 测试模型配置是否可用
    try {
      setIsProcessing(true); // 添加加载状态
      const isConfigValid = await testModelConfig(modelSettings);
      if (!isConfigValid) {
        message.error('模型配置验证失败，请检查配置是否正确');
        setIsProcessing(false);
        return;
      }

      // 3. 如果验证通过，继续创建会话
      const newSession = await createSession({
        modelService,
        baseUrl: modelSettings.baseUrl,
        apiKey: modelSettings.apiKey || '',
        modelName: modelSettings.modelName
      }, systemPrompt);  // 添加systemPrompt参数
      console.log('[Chat] 新会话创建成功');
      message.success('新会话创建成功');

      // 4. 切换到新创建的会话
      if (newSession) {
        await handleSessionChange(newSession);
      }
    } catch (error) {
      console.error('[Chat] 创建会话失败:', error);
      message.error('创建会话失败');
    } finally {
      setIsProcessing(false);
    }
  };

  // 处理退出登录
  const handleLogout = () => {
    console.log('[Chat] 用户请求退出登录');
    logout();
  };

  // 注销账号
  const handleDeleteAccount = useCallback(() => {
    if (deletingAccount) return;
    Modal.confirm({
      title: '确认注销账号',
      content: '此操作将删除该账号下的所有传统会话、所有智能助手会话以及该账号在 MinIO 中的所有图片（users/{user_id}/ 前缀）。操作不可恢复，确定继续吗？',
      okText: '永久删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          setDeletingAccount(true);
          const token = localStorage.getItem('token');
          await authAxios.delete(getFullUrl('/api/auth/account'));
          message.success('账号已注销');
          try { logout(); } catch {}
          localStorage.removeItem('token');
          navigate('/login');
        } catch (e: any) {
          message.error(e?.message || '注销失败');
        } finally {
          setDeletingAccount(false);
        }
      }
    });
  }, [deletingAccount, navigate]);

  // 添加滚动事件监听
  useEffect(() => {
    const container = messageListRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // 在消息更新后滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [messages, shouldAutoScroll]);

  // 播放音频
  const playAudio = useCallback((audioUrl: string) => {
    console.log('[Chat] playAudio 被调用，enableVoice:', enableVoice, 'audioUrl:', audioUrl);
    
    if (!enableVoice) {
      console.log('[Chat] 语音播放已关闭，跳过音频播放');
      return;
    }
    
    console.log('[Chat] 设置音频URL:', audioUrl);
    if (audioRef.current) {
      audioRef.current.pause();  // 暂停当前播放
      audioRef.current.currentTime = 0;  // 重置播放位置
    }
    setAudioUrl(audioUrl);
    
    // 确保音频元素存在并加载新的音频
    if (audioRef.current) {
      console.log('[Chat] 尝试加载和播放音频');
      audioRef.current.load();
      // 添加一个延时，等待音频加载完成后自动播放
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play().catch(error => {
            console.error('[Chat] 自动播放失败:', error);
            // 自动播放失败时不显示错误提示，因为用户可以手动播放
          });
        }
      }, 500);  // 给予足够的时间让音频加载
    }
  }, [enableVoice]);

  // 建立WebSocket连接
  const establishConnection = () => {
    // 检查是否有当前会话（传统模式）或助手会话（助手模式）
    if (!isAssistantMode && !currentSession?.session_id) {
      console.log('[Chat] 提示：当前没有选择会话');
      return;
    }
    
    if (isAssistantMode && (!currentAssistantSession?.id || !currentAssistant?.id)) {
      console.log('[Chat] 提示：当前没有选择助手会话');
      return;
    }

    // 更新当前会话ID引用
    if (isAssistantMode) {
      currentSessionIdRef.current = currentAssistantSession!.id;
    } else {
      currentSessionIdRef.current = currentSession!.session_id;
    }

    // 构建WebSocket URL
    const fullUrl = getFullUrl('');
    const apiUrl = new URL(fullUrl);
    const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = isAssistantMode
      ? `${protocol}//${apiUrl.host}/api/v1/ragflow/ws/chat/${currentAssistant!.id}/${currentAssistantSession!.id}`
      : `${protocol}//${apiUrl.host}/api/chat/ws/chat/${currentSession!.session_id}`;

    console.log('[Chat] 使用连接管理器建立WebSocket连接:', wsUrl);
    // 在发起新连接后短时间内抑制重连提示，避免创建/切换会话时的瞬时抖动误报
    suppressReconnectToastUntilRef.current = Date.now() + 4000;

    // 更新会话上下文并注册回调
    chatWSManager.updateSessionContext({ url: wsUrl, sessionId: currentSessionIdRef.current!, isAssistantMode });
    chatWSManager.setCallbacks({
      onOpen: () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        hasEverOpenedRef.current = true;
        // 传统模式：请求会话历史（助手模式由后端推送）
        if (!isAssistantMode) {
          chatWSManager.send({ type: 'fetch_history', session_id: currentSession!.session_id });
        }
      },
      onAuthSuccess: () => {
        console.log('[Chat] 认证成功');
      },
      onMessage: (event: MessageEvent) => {
        const expectedSessionId = isAssistantMode ? currentAssistantSession?.id : currentSession?.session_id;
        if (currentSessionIdRef.current !== expectedSessionId) {
          console.log('[Chat] 忽略非当前会话的消息');
          return;
        }
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'error') {
            console.error('[Chat] 收到错误消息:', data.content);
            message.error(data.content);
            setIsModelTyping(false);
            setIsProcessing(false);
            return;
          }
          if (data.type === 'done') {
            if (!data.success) {
              console.error('[Chat] 处理失败:', data.error);
              if (!data.error?.includes?.('API调用失败')) {
                message.error(data.error || '处理失败');
              }
            } else if (data.saved_images && data.saved_images.length > 0) {
              setMessages(prevMessages => {
                const updatedMessages = [...prevMessages];
                for (let i = updatedMessages.length - 1; i >= 0; i--) {
                  if (updatedMessages[i].role === 'user') {
                    updatedMessages[i] = { ...updatedMessages[i], images: data.saved_images } as any;
                    break;
                  }
                }
                return updatedMessages;
              });
            }
              if (isAssistantMode && currentAssistantSession) {
                setMessages(prevMessages => {
                  const currentMessages = prevMessages.length;
                    setAssistantSessions(prevSessions => 
                      prevSessions.map(session => 
                        session.id === currentAssistantSession.id 
                          ? { ...session, message_count: currentMessages }
                          : session
                      )
                    );
                    setMessageCountUpdated(true);
                  return prevMessages;
                });
              } else if (currentSession) {
                setMessages(prevMessages => {
                  const currentMessages = prevMessages.length;
                    updateSessionMessageCount(currentSession.session_id, currentMessages);
                    setMessageCountUpdated(true);
                  return prevMessages;
                });
            }
            setIsModelTyping(false);
            setIsProcessing(false);
            return;
          }
          if (data.type === 'history') {
            setMessages(prevMessages => {
              if (prevMessages.length > 0 && prevMessages[prevMessages.length - 1].role === 'user') {
                return prevMessages;
              }
              const converted: ChatMessage[] = (data.messages || []).map((msg: any) => ({
                role: msg.role,
                content: msg.content || '',
                timestamp: msg.timestamp || msg.create_time || msg.created_at,
                images: msg.images,
                reference: msg.reference,
                id: msg.id
              }));
              return converted;
            });
            return;
          }
          if (data.type === 'message') {
            setIsModelTyping(false);
            setMessages(prevMessages => {
              const last = prevMessages[prevMessages.length - 1];
              if (last && last.role === 'assistant') {
                const updated = [...prevMessages];
                updated[updated.length - 1] = { ...last, content: (last.content || '') + (data.content || ''), reference: data.reference || last.reference } as any;
                return updated;
              }
              return [...prevMessages, { role: 'assistant', content: data.content || '', timestamp: new Date().toISOString(), reference: data.reference } as any];
            });
            return;
          }
          if (data.type === 'reference') {
            setMessages(prevMessages => {
              const last = prevMessages[prevMessages.length - 1];
              if (last && last.role === 'assistant') {
                const updated = [...prevMessages];
                let referenceData: any = data.reference?.chunks || data.reference;
                if (referenceData && !Array.isArray(referenceData)) {
                  if (typeof referenceData === 'object') referenceData = Object.values(referenceData);
                  else referenceData = [referenceData];
                }
                updated[updated.length - 1] = { ...last, reference: referenceData } as any;
                return updated;
              }
              return prevMessages;
            });
            return;
          }
          if (data.type === 'audio') {
            if (enableVoice) { playAudio(data.file); }
            return;
          }
        } catch (error) {
          console.error('[Chat] 解析WebSocket消息失败:', error);
          message.error('消息处理失败');
          setIsProcessing(false);
        }
      },
      onClose: () => {
        setIsConnected(false);
        setIsModelTyping(false);
      },
      onError: () => {
        if (hasEverOpenedRef.current && Date.now() > suppressReconnectToastUntilRef.current) {
          message.error('连接中断，正在尝试重连...');
        }
        setIsConnected(false);
        setIsModelTyping(false);
      }
    });

    // 发起连接
    chatWSManager.connect();

    // 将引用状态同步为当前socket（可选）
    setWs(chatWSManager.getSocket());
  };

  // 处理移动端侧边栏切换
  const toggleMobileSider = () => {
    setSiderVisible(prev => !prev);
  };

  // 处理移动端侧边栏关闭
  const handleOverlayClick = () => {
    if (isMobile) {
      setSiderVisible(false);
    }
  };

  // 渲染遮罩层
  const renderOverlay = () => {
    if (!isMobile) return null;
    return (
      <div 
        className={`${styles.overlay} ${siderVisible ? styles.overlayVisible : ''}`}
        onClick={handleOverlayClick}
      />
    );
  };

  // 修改会话切换处理函数
  const handleSessionChange = useCallback(async (session: ChatSession | null) => {
    console.log('[Chat] 切换传统会话:', session);
    
    // 切换到传统模式
    setIsAssistantMode(false);
    setCurrentAssistantSession(null);
    
    // 在移动端关闭侧边栏
    if (isMobile) {
      setSiderVisible(false);
    }
    
    // 清理当前WebSocket连接
    cleanupWebSocket();
    
    // 更新当前会话ID引用
    currentSessionIdRef.current = session?.session_id || null;
    
    // 清理当前消息状态
    setMessages([]);
    
    // 重置消息数量更新标志
    setMessageCountUpdated(false);
    
    // 清理深度思考状态
    setThinkingSectionStates({});
    
    // 设置新的当前会话（使用 store 最新对象以确保包含 kb_settings 等最新字段）
    const refreshed = session ? (sessions.find(s => s.session_id === session.session_id) || session) : null;
    setCurrentSession(refreshed as any);
    
    // 检查新会话是否支持图片
    if (session) {
      const sessionModelService = session.model_settings.modelService;
      const sessionModelName = session.model_settings.modelName;
      const supportsImage = isModelSupportsImage(sessionModelService, sessionModelName);
      
      setCurrentSessionSupportsImage(supportsImage);
    } else {
      setCurrentSessionSupportsImage(false);
    }
  }, [isMobile, cleanupWebSocket, setCurrentSession]);
  
  // 添加助手会话切换处理函数
  const handleAssistantSessionChange = useCallback(async (assistantSession: AssistantSession | null) => {
    console.log('[Chat] 🔄 切换助手会话:', {
      会话ID: assistantSession?.id,
      会话名称: assistantSession?.name,
      助手ID: assistantSession?.assistant_id,
      助手名称: assistantSession?.assistant_name
    });
    
    // 切换到助手模式
    setIsAssistantMode(true);
    setCurrentSession(null);
    
    // 在移动端关闭侧边栏
    if (isMobile) {
      setSiderVisible(false);
    }
    
    // 清理当前WebSocket连接
    console.log('[Chat] 🧹 清理当前WebSocket连接');
    cleanupWebSocket();
    
    // 更新当前会话ID引用
    currentSessionIdRef.current = assistantSession?.id || null;
    console.log('[Chat] 📝 更新会话ID引用:', currentSessionIdRef.current);
    
    // 清理当前消息状态
    console.log('[Chat] 🧹 清理当前消息状态');
    setMessages([]);
    
    // 重置消息数量更新标志
    setMessageCountUpdated(false);
    
    // 清理深度思考状态
    setThinkingSectionStates({});
    
    // 设置新的当前助手会话
    console.log('[Chat] 🎯 设置新的当前助手会话');
    setCurrentAssistantSession(assistantSession);
    
    // 助手模式暂不支持图片上传
    setCurrentSessionSupportsImage(false);
    
    console.log('[Chat] ✅ 助手会话切换完成，等待WebSocket连接建立...');
  }, [isMobile, cleanupWebSocket]);

  // 创建助手会话
  const createAssistantSession = useCallback(async (assistantId: string) => {
    try {
      // 创建RAGFlow会话
      const ragflowSession = await ragflowService.createSession(assistantId);
      // 获取助手对象
      const assistant = assistants.find(a => a.id === assistantId)!;
      
      // 格式化会话对象
      const newSession: AssistantSession = {
        id: ragflowSession.id, // 使用RAGFlow返回的真实ID
        name: ragflowSession.name || `与${assistant.name}的对话`,
        assistant_id: assistantId,
        assistant_name: assistant.name,
        messages: [],
        message_count: 0,
        create_time: ragflowSession.create_time || new Date().toISOString(),
        role_avatar_url: assistant.avatar || ''
      };
      
      // 切换当前助手为目标助手（关键修复！）
      setCurrentAssistant(assistant);
      
      // 添加到会话列表（插入到顶部）
      setAssistantSessions(prev => [newSession, ...prev]);
      
      // 强制展开对应的助手列表（确保在所有状态更新后执行）
      setTimeout(() => {
        setCollapsedAssistantIds(prev => {
          const next = new Set(prev);
          next.delete(assistantId); // 移除折叠状态，即展开
          console.log(`[Chat] 强制展开助手 ${assistantId} 的会话列表`);
          return next;
        });
      }, 0);
      
      // 切换到新创建的会话
      await handleAssistantSessionChange(newSession);
      
      message.success('助手会话创建成功');
    } catch (error) {
      console.error('[Chat] 创建助手会话失败:', error);
      message.error('创建助手会话失败');
    }
  }, [assistants, handleAssistantSessionChange]);


  // 助手会话菜单
  const getAssistantSessionMenu = (session: AssistantSession) => (
    <Menu
      onClick={({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === 'delete') {
          handleDeleteAssistantSession(session);
        } else if (key === 'rename') {
          handleRenameAssistantSession(session);
        } else if (key === 'roleInfo') {
          // 复用"角色信息"模态框
          setEditingAssistantSession(session);
          setNewSessionName(session.name);
          setRoleAvatar((session as any).role_avatar_url || '');
          setRoleInfoModalVisible(true);
        }
      }}
    >
      <Menu.Item key="rename" icon={<EditOutlined />}>
        重命名
      </Menu.Item>
      <Menu.Item key="roleInfo" icon={<UserOutlined />}>
        角色信息
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item 
        key="delete" 
        icon={<DeleteOutlined />} 
        className={styles.deleteMenuItem}
      >
        删除
      </Menu.Item>
    </Menu>
  );

  // 删除助手会话
  const handleDeleteAssistantSession = async (session: AssistantSession) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个助手对话吗？此操作不可恢复。',
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { 
        className: styles.deleteButton
      },
      onOk: async () => {
        try {
          // 先调用后端删除（会同时处理本地与RAGFlow，如后端未实现远端删除则至少本地会删除）
          await ragflowService.deleteSession(session.assistant_id, session.id);

          // 从本地状态中移除
          setAssistantSessions(prev => prev.filter(s => s.id !== session.id));
          
          // 如果删除的是当前会话，清空当前会话
          if (currentAssistantSession?.id === session.id) {
            setCurrentAssistantSession(null);
            setIsAssistantMode(false);
            cleanupWebSocket();
          }
          
          message.success('助手对话删除成功');
        } catch (error) {
          console.error('[Chat] 删除助手会话失败:', error);
          message.error('删除失败，请重试');
        }
      }
    });
  };

  // 重命名助手会话
  const handleRenameAssistantSession = async (session: AssistantSession) => {
    let inputValue = session.name || '';
    const modal = Modal.confirm({
      title: '重命名会话',
      content: (
        <Input
          defaultValue={inputValue}
          placeholder="请输入新的会话名称"
          onChange={(e) => { inputValue = e.target.value; }}
          onPressEnter={() => { (modal as any)?.update({ okButtonProps: { loading: true } }); doRename(); }}
        />
      ),
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        (modal as any)?.update({ okButtonProps: { loading: true } });
        await doRename();
      }
    });

    const doRename = async () => {
      const newName = (inputValue || '').trim();
      if (!newName) {
        message.warning('名称不能为空');
        (modal as any)?.update({ okButtonProps: { loading: false } });
        return;
      }
      try {
        // 调用后端更新本地（并尽可能同步RAGFlow）
        await ragflowService.updateSessionName(session.id, newName);

        // 更新前端本地状态
        setAssistantSessions(prev => prev.map(s => s.id === session.id ? { ...s, name: newName } : s));
        if (currentAssistantSession?.id === session.id) {
          setCurrentAssistantSession({ ...session, name: newName });
        }

        message.success('会话名称已更新');
        (modal as any)?.destroy();
      } catch (error) {
        console.error('[Chat] 重命名助手会话失败:', error);
        message.error('重命名失败，请重试');
        (modal as any)?.update({ okButtonProps: { loading: false } });
      }
    };
  };

  // 新增：助手级别 - 触发头像上传
  const triggerAssistantAvatarFile = (assistant: ChatAssistant) => {
    setEditingAssistant(assistant);
    if (hiddenAssistantAvatarInputRef.current) {
      hiddenAssistantAvatarInputRef.current.click();
    }
  };

  // 新增：助手级别 - 打开批量删除模态框
  const openBatchDeleteModalForAssistant = (assistantId: string) => {
    setBatchAssistantId(assistantId);
    setSelectedSessionIds([]); // 默认不选中任何会话
    setBatchDeleteModalVisible(true);
  };

  // 新增：助手级别 - 执行批量删除
  const handleBatchDeleteSessions = async () => {
    if (!batchAssistantId) return;
    const sessionIds = selectedSessionIds;
    if (sessionIds.length === 0) {
      message.warning('请先选择要删除的会话');
      return;
    }
    try {
      await Promise.all(sessionIds.map(id => ragflowService.deleteSession(batchAssistantId, id)));
      setAssistantSessions(prev => prev.filter(s => !(s.assistant_id === batchAssistantId && sessionIds.includes(s.id))));
      if (currentAssistantSession && sessionIds.includes(currentAssistantSession.id)) {
        setCurrentAssistantSession(null);
        setIsAssistantMode(false);
        cleanupWebSocket();
      }
      message.success('选中的助手会话已删除');
      setBatchDeleteModalVisible(false);
      setSelectedSessionIds([]);
      setBatchAssistantId(null);
    } catch (e) {
      console.error('[Chat] 批量删除助手会话失败:', e);
      message.error('批量删除失败，请重试');
    }
  };

  // 新增：助手级别 - 删除全部会话
  const handleDeleteAllSessionsForAssistant = async (assistantId: string) => {
    Modal.confirm({
      title: '删除全部会话',
      content: '确定要删除该助手的全部会话吗？此操作不可恢复。',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          const ids = assistantSessions.filter(s => s.assistant_id === assistantId).map(s => s.id);
          await Promise.all(ids.map(id => ragflowService.deleteSession(assistantId, id)));
          setAssistantSessions(prev => prev.filter(s => s.assistant_id !== assistantId));
          if (currentAssistantSession && currentAssistantSession.assistant_id === assistantId) {
            setCurrentAssistantSession(null);
            setIsAssistantMode(false);
            cleanupWebSocket();
          }
          message.success('该助手的全部会话已删除');
        } catch (err) {
          console.error('[Chat] 删除全部助手会话失败:', err);
          message.error('删除失败，请重试');
        }
      }
    });
  };

  // 新增：助手级别 - 头部菜单
  const getAssistantHeaderMenu = (assistant: ChatAssistant) => (
    <Menu
      onClick={({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === 'editAvatar') {
          triggerAssistantAvatarFile(assistant);
        } else if (key === 'batchDelete') {
          openBatchDeleteModalForAssistant(assistant.id);
        }
      }}
    >
      <Menu.Item key="editAvatar" icon={<EditOutlined />}>修改助手头像</Menu.Item>
      <Menu.Item key="batchDelete" icon={<DeleteOutlined />}>批量删除助手会话</Menu.Item>
    </Menu>
  );

  // 新增：传统会话 - 头部菜单
  const getTraditionalHeaderMenu = () => (
    <Menu
      onClick={({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === 'batchDeleteTraditional') {
          // 默认不选中任何会话
          setSelectedTraditionalSessionIds([]);
          setTraditionalBatchModalVisible(true);
        }
      }}
    >
      <Menu.Item key="batchDeleteTraditional" icon={<DeleteOutlined />}>批量删除传统会话</Menu.Item>
    </Menu>
  );

  // 新增：传统会话 - 执行批量删除
  const handleBatchDeleteTraditionalSessions = async () => {
    const idsToDelete = selectedTraditionalSessionIds;
    if (!idsToDelete || idsToDelete.length === 0) {
      message.warning('请先选择要删除的会话');
      return;
    }
    try {
      await Promise.all(idsToDelete.map(id => deleteSession(id)));
      message.success('选中的传统会话已删除');
      setSelectedTraditionalSessionIds([]);
      setTraditionalBatchModalVisible(false);
    } catch (e) {
      console.error('[Chat] 批量删除传统会话失败:', e);
      message.error('批量删除失败，请重试');
    }
  };

  // 在会话变化时立即重新建立连接（避免发送前URL/会话ID尚未更新）
  useEffect(() => {
    if (currentSession || currentAssistantSession) {
      console.log('[Chat] 当前会话变化，立即建立连接', {
        传统会话: currentSession?.session_id,
        助手会话: currentAssistantSession?.id,
        模式: isAssistantMode ? '助手' : '传统'
      });
      establishConnection();
      return;
    }
    
    // 组件卸载时清理连接
    return () => {
      console.log('[Chat] 组件卸载，清理WebSocket连接');
      cleanupWebSocket();
    };
  }, [currentSession, currentAssistantSession, isAssistantMode]);

  // 检查当前会话的图片支持状态
  useEffect(() => {
    if (currentSession) {
      const sessionModelService = currentSession.model_settings.modelService;
      const sessionModelName = currentSession.model_settings.modelName;
      const supportsImage = isModelSupportsImage(sessionModelService, sessionModelName);
      
      setCurrentSessionSupportsImage(supportsImage);
    } else {
      setCurrentSessionSupportsImage(false);
    }
  }, [currentSession]);

  // 修改发送消息的函数
  const sendMessage = async (override?: { text?: string; files?: File[]; previews?: string[] }) => {
    console.log('[Chat] 开始发送消息流程');
    const overrideText = override?.text;
    const overrideFiles = override?.files;
    const overridePreviews = override?.previews;

    const effectiveMessage = overrideText !== undefined ? overrideText : currentMessage;
    const effectiveFiles = overrideFiles !== undefined ? overrideFiles : selectedImages;
    const effectivePreviews = overridePreviews !== undefined ? overridePreviews : imagePreviews;

    console.log('[Chat] 当前消息内容:', effectiveMessage);
    console.log('[Chat] 当前会话:', currentSession);

    if (!effectiveMessage.trim() && effectiveFiles.length === 0) {
      console.log('[Chat] 消息为空且无图片，终止发送');
      return;
    }

    if (isProcessing) {
      console.log('[Chat] 正在处理中，终止发送');
      return;
    }
    
    // 发送前确保上下文（URL/会话ID）已与当前选择对齐，避免切换后使用旧连接
    try {
      const fullUrl = getFullUrl('');
      const apiUrl = new URL(fullUrl);
      const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      if (isAssistantMode) {
        if (!currentAssistant?.id || !currentAssistantSession?.id) {
          message.warning('未选择助手会话');
          return;
        }
        const wsUrl = `${protocol}//${apiUrl.host}/api/v1/ragflow/ws/chat/${currentAssistant.id}/${currentAssistantSession.id}`;
        chatWSManager.updateSessionContext({ url: wsUrl, sessionId: currentAssistantSession.id, isAssistantMode });
      } else {
        if (!currentSession?.session_id) {
          message.warning('未选择会话');
          return;
        }
        const wsUrl = `${protocol}//${apiUrl.host}/api/chat/ws/chat/${currentSession.session_id}`;
        chatWSManager.updateSessionContext({ url: wsUrl, sessionId: currentSession.session_id, isAssistantMode });
      }
    } catch {}

    // 确保连接与鉴权（复用全局连接，不重复构建）
    const authorized = await chatWSManager.ensureAuthorized(8000);
    if (!authorized) {
      message.error('连接未就绪，已取消发送，请稍后重试');
      return;
    }

    try {
      setIsProcessing(true);
      setIsImageUploading(true);

      // 准备消息内容
      let messageContent = effectiveMessage;
      let imagesBase64: string[] = [];

      // 如果有图片，转换为base64
      if (effectiveFiles.length > 0) {
        try {
          imagesBase64 = await convertImagesToBase64(effectiveFiles);
          console.log(`[Chat] ${effectiveFiles.length} 张图片已转换为base64`);
        } catch (error) {
          console.error('[Chat] 图片转换失败:', error);
          message.error('图片处理失败，请重试');
          setIsProcessing(false);
          setIsImageUploading(false);
          return;
        }
      }

      // 添加用户消息到显示列表
      const userMessage: ChatMessage = {
        role: 'user',
        content: effectiveMessage || (effectiveFiles.length > 0 ? `[${effectiveFiles.length}张图片]` : ''),
        timestamp: new Date().toISOString(),
        images: effectiveFiles.length > 0 && !isAssistantMode ? effectivePreviews : undefined
      };
      
      // 添加用户消息
      setMessages(prev => [...prev, userMessage]);
      // 重置消息数量更新标志
      setMessageCountUpdated(false);

      // 发送消息
      let messageData: any;
      
      if (isAssistantMode) {
        // 助手模式：使用RAGFlow格式
        messageData = {
          message: messageContent,
          assistant_id: currentAssistant?.id,
          session_id: currentAssistantSession?.id,
          stream: true // RAGFlow通常使用流式响应
        };
      } else {
        // 传统模式：使用原有格式，添加知识库配置
        messageData = {
          message: messageContent,
          images: imagesBase64,
          session_id: currentSession?.session_id,
          model_settings: currentSession?.model_settings,
          enable_voice: enableVoice,
          enable_text_cleaning: enableTextCleaning,
          kb_settings: (currentSession as any)?.kb_settings // 添加知识库配置
        };
      }
      
      console.log('[Chat] 发送消息时使用的模型配置:', currentSession?.model_settings);
      console.log('[Chat] 语音开关状态:', enableVoice);
      console.log('[Chat] 是否包含图片:', imagesBase64.length > 0);
      console.log('[Chat] 图片数量:', imagesBase64.length);
      chatWSManager.send(messageData);
      console.log('[Chat] 消息已通过WebSocket发送:', messageData);

      setCurrentMessage('');
      setSelectedImages([]);
      setImagePreviews([]);
      setSentFlag(false); // 发送消息后重置发送标记
      
      // 设置模型正在输入状态
      setIsModelTyping(true);
      
      // 延迟更新当前会话的消息数量，避免干扰消息显示
      setTimeout(() => {
        if (!messageCountUpdated) {
          if (isAssistantMode && currentAssistantSession) {
            // 助手模式：更新助手会话消息数量
            setMessages(prevMessages => {
              const newMessageCount = prevMessages.length;
              const sessionMessageCount = currentAssistantSession.message_count || 0;
              if (sessionMessageCount !== newMessageCount) {
                console.log('[Chat] 发送消息后更新助手会话消息数量:', newMessageCount);
                setAssistantSessions(prevSessions => 
                  prevSessions.map(session => 
                    session.id === currentAssistantSession.id 
                      ? { ...session, message_count: newMessageCount }
                      : session
                  )
                );
                setMessageCountUpdated(true);
              }
              return prevMessages;
            });
          } else if (currentSession) {
            // 传统模式：更新传统会话消息数量
            setMessages(prevMessages => {
              const newMessageCount = prevMessages.length;
              const sessionMessageCount = currentSession.message_count || 0;
              if (sessionMessageCount !== newMessageCount) {
                console.log('[Chat] 发送消息后更新会话消息数量:', newMessageCount);
                updateSessionMessageCount(currentSession.session_id, newMessageCount);
                setMessageCountUpdated(true);
              }
              return prevMessages;
            });
          }
        }
      }, 100);
    } catch (error) {
      console.error('[Chat] 发送消息失败:', error);
      message.error('发送消息失败，请重试');
    } finally {
      setIsProcessing(false);
      setIsImageUploading(false);
    }
  };

  // 显示错误消息
  useEffect(() => {
    if (error) {
      console.log('[Chat] 显示错误消息:', error);
      message.error(error);
    }
  }, [error]);



  // 处理会话删除
  const handleDelete = async (session: ChatSession) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个会话吗？此操作不可恢复。',
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { 
        className: styles.deleteButton
      },
      onOk: async () => {
        try {
          await deleteSession(session.session_id);
          message.success('会话删除成功');
          if (currentSession?.session_id === session.session_id) {
            handleSessionChange(null);
          }
        } catch (error) {
          message.error('删除失败，请重试');
        }
      }
    });
  };

  // 修改会话操作菜单
  const getSessionMenu = (session: ChatSession) => (
    <Menu
      onClick={({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === 'roleInfo') {
          setEditingSession(session);
          setNewSessionName(session.name);
          setRoleAvatar(session.role_avatar_url || '');
          setRoleInfoModalVisible(true);
        } else if (key === 'delete') {
          handleDelete(session);
        } else if (key === 'config') {
          // 从会话中获取配置
          const sessionConfig = {
            session_id: session.session_id,
            modelSettings: { ...session.model_settings },
            systemPrompt: session.system_prompt || '', // 直接使用会话的system_prompt
            contextCount: session.context_count !== undefined ? session.context_count : 20 // 从数据库获取实际值，如果不存在则默认20
          };
          console.log('[Chat] 加载会话配置，context_count:', session.context_count, '最终使用:', sessionConfig.contextCount);

          console.log('[Chat] 加载会话配置:', sessionConfig);
          setEditingConfig(sessionConfig);
          setConfigModalVisible(true);
        } else if (key === 'kbConfig') {
          // 载入会话的知识库配置（若无则默认）
          const defaults = {
            enabled: false,
            vector_db: 'chroma',
            collection_name: '',
            kb_prompt_template: '',
            embeddings: {
              provider: 'ollama', // 'ollama' | 'local' | 'ark'
              model: '',
              base_url: getDefaultBaseUrl('ollama'),
              api_key: '',
              local_model_path: 'backend/models/all-MiniLM-L6-v2'
            },
            split_params: {
              chunk_size: 500,
              chunk_overlap: 100,
              separators: ['\n\n', '\n', '。', '！', '？', '，', ' ', '']
            }
          } as any;
          const kb = (session as any).kb_settings || {};
          setKbEditingSession(session);
          setKbConfig(() => {
            const merged = {
              ...defaults,
              ...kb,
              embeddings: { ...defaults.embeddings, ...(kb?.embeddings || {}) },
              split_params: { ...defaults.split_params, ...(kb?.split_params || {}) }
            } as any;
            // 若选择火山引擎但模型为空，则填入默认值，避免校验误报
            if (merged.embeddings?.provider === 'ark' && !merged.embeddings.model) {
              merged.embeddings.model = 'doubao-embedding-large-text-250515';
            }
            // 若选择local但模型为空，填入默认
            if (merged.embeddings?.provider === 'local' && !merged.embeddings.model) {
              merged.embeddings.model = 'all-MiniLM-L6-v2';
            }
            // 若选择ollama但 base_url 为空，补上默认
            if (merged.embeddings?.provider === 'ollama') {
              if (!merged.embeddings.base_url) merged.embeddings.base_url = getDefaultBaseUrl('ollama');
            }
            // 首次打开时，若未设置提示词，则默认填入当前会话原始提示词（system_prompt）
            if (!merged.kb_prompt_template && (session as any).system_prompt) {
              merged.kb_prompt_template = (session as any).system_prompt;
            }
            return merged;
          });
          setKbConfigModalVisible(true);
        } else if (key === 'ttsConfig') {
          // TTS配置处理
          console.log('[TTS] 点击语音生成按钮 - 会话ID:', session.session_id);
          setEditingSession(session);
          handleTtsConfigClick(session);
        } else if (key === 'export') {
          handleExportChat(session);
        } else if (key === 'clear') {
          handleClearChat(session);
        }
      }}
    >
      <Menu.Item key="roleInfo" icon={<EditOutlined />}>
        角色信息
      </Menu.Item>

      <Menu.Item key="config" icon={<ApiOutlined />}>
        模型配置
      </Menu.Item>
      <Menu.Item key="kbConfig" icon={<DatabaseOutlined />}>
        配置知识库
      </Menu.Item>
      <Menu.Item key="ttsConfig" icon={<SoundOutlined />}>
        语音生成
      </Menu.Item>
      <Menu.Item key="export" icon={<FileTextOutlined />}>
        导出对话数据
      </Menu.Item>
      <Menu.Item 
        key="clear" 
        icon={<DeleteOutlined />}
      >
        清空对话
      </Menu.Item>
      <Menu.Item 
        key="delete" 
        icon={<DeleteOutlined />}
        style={{ color: '#ff4d4f' }}
        className={styles.deleteMenuItem}
      >
        删除会话
      </Menu.Item>
    </Menu>
  );

  // 添加System Prompt设置模态框
  const renderSystemPromptModal = () => (
    <Modal
      title="设置System Prompt"
      open={systemPromptModalVisible}
      onOk={handleSystemPromptSave}
      onCancel={() => setSystemPromptModalVisible(false)}
      width={600}
    >
      <Input.TextArea
        value={systemPrompt}
        onChange={e => setSystemPrompt(e.target.value)}
        placeholder="请输入System Prompt，留空则使用默认值"
        rows={6}
      />
    </Modal>
  );

  // TTS服务商选择模态框
  const renderTtsProviderModal = () => (
    <Modal
      title="选择语音生成服务"
      open={ttsProviderModalVisible}
      onCancel={() => setTtsProviderModalVisible(false)}
      footer={null}
      width={600}
      className={styles.ttsProviderModal}
    >
      <div className={styles.ttsProviderGrid}>
        {/* 讯飞云TTS */}
        <div 
          className={`${styles.ttsProviderCard} ${selectedTtsProvider === 'xfyun' ? styles.selected : ''}`}
          onClick={() => {
            setSelectedTtsProvider('xfyun');
            setTtsConfig({
              provider: 'xfyun',
              config: {
                appId: '',
                apiKey: '',
                apiSecret: ''
              },
              voiceSettings: {
                voiceType: 'x4_xiaoyan' // 默认音色：小燕
              }
            });
            setTtsProviderModalVisible(false);
            setTtsConfigModalVisible(true);
          }}
        >
          <div className={styles.ttsProviderIcon}>
            <img src="/src/static/logo/xfyun.png" alt="讯飞云" />
          </div>
          <div className={styles.ttsProviderInfo}>
            <h3>讯飞云TTS</h3>
            <p>科大讯飞语音合成服务</p>
            <div className={styles.ttsProviderFeatures}>
              <span>高质量语音</span>
              <span>多种音色</span>
              <span>稳定可靠</span>
            </div>
          </div>
        </div>

        {/* 字节跳动TTS */}
        <div 
          className={`${styles.ttsProviderCard} ${selectedTtsProvider === 'bytedance' ? styles.selected : ''}`}
          onClick={() => {
            setSelectedTtsProvider('bytedance');
            setTtsConfig({
              provider: 'bytedance',
              config: {
                appId: '',
                token: '',
                cluster: ''
              },
              voiceSettings: {
                voiceType: 'zh_female_wanwanxiaohe_moon_bigtts' // 默认音色
              }
            });
            setTtsProviderModalVisible(false);
            setTtsConfigModalVisible(true);
          }}
        >
          <div className={styles.ttsProviderIcon}>
            <img src="/src/static/logo/huoshan.png" alt="字节跳动" />
          </div>
          <div className={styles.ttsProviderInfo}>
            <h3>字节跳动TTS</h3>
            <p>火山引擎语音合成服务</p>
            <div className={styles.ttsProviderFeatures}>
              <span>自然语音</span>
              <span>低延迟</span>
              <span>企业级</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );

  // 讯飞云TTS音色数据（从JSON文件导入）
  const xfyunVoices = xfyunVoicesData;

  // 字节跳动TTS音色数据（从JSON文件导入）
  const bytedanceVoices = bytedanceVoicesData;

  // 筛选音色的函数
  const filterVoices = (voices: any[], genderFilter: string, searchQuery: string) => {
    return voices.filter(voice => {
      // 性别筛选
      const genderMatch = genderFilter === 'all' || voice.gender === genderFilter;
      
      // 搜索筛选
      const searchMatch = !searchQuery || 
        voice.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        voice.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        voice.language.toLowerCase().includes(searchQuery.toLowerCase());
      
      return genderMatch && searchMatch;
    });
  };

  // 获取音色名称的辅助函数
  const getVoiceName = (voiceType: string, provider: string) => {
    if (provider === 'xfyun') {
      // 讯飞云的音色映射
      const voice = xfyunVoices.find(v => v.id === voiceType);
      return voice ? `${voice.name}（${voice.category}）` : voiceType;
    } else if (provider === 'bytedance') {
      // 字节跳动的音色映射
      const voice = bytedanceVoices.find(v => v.id === voiceType);
      return voice ? `${voice.name}（${voice.category}）` : voiceType;
    }
    return voiceType;
  };

  // TTS配置模态框
  const renderTtsConfigModal = () => {
    // 处理修改TTS服务按钮点击
    const handleChangeTtsService = () => {
      console.log('[TTS] 点击修改TTS服务按钮');
      // 关闭当前配置模态框
      setTtsConfigModalVisible(false);
      // 重置选择状态
      setSelectedTtsProvider('');
      setTtsConfig({
        provider: '',
        config: {},
        voiceSettings: {}
      });
      // 打开服务商选择模态框
      setTtsProviderModalVisible(true);
    };

    const handleTtsConfigSave = async () => {
      if (!editingSession) return;

      try {
        // 验证必填字段
        const requiredFields = ttsConfig.provider === 'xfyun' 
          ? ['appId', 'apiKey', 'apiSecret']
          : ['appId', 'token', 'cluster'];

        const missingFields = requiredFields.filter(field => !ttsConfig.config[field]?.trim());
        if (missingFields.length > 0) {
          message.error(`请填写必填字段: ${missingFields.join(', ')}`);
          return;
        }

        // 保存TTS配置到会话
        const updateData = {
          tts_settings: {
            provider: ttsConfig.provider,
            config: ttsConfig.config,
            voice_settings: ttsConfig.voiceSettings
          }
        } as Partial<ChatSession>;

        await updateSession(editingSession.session_id, updateData);
        message.success('TTS配置保存成功');
        setTtsConfigModalVisible(false);
        setTtsConfig({
          provider: '',
          config: {},
          voiceSettings: {}
        });
        setEditingSession(null);

        // 重新获取会话列表
        await fetchSessions();

      } catch (error) {
        console.error('保存TTS配置失败:', error);
        message.error('保存TTS配置失败，请重试');
      }
    };

    return (
      <Modal
        title={`配置${ttsConfig.provider === 'xfyun' ? '讯飞云' : '字节跳动'}TTS`}
        open={ttsConfigModalVisible}
        onOk={handleTtsConfigSave}
        onCancel={() => {
          setTtsConfigModalVisible(false);
          setTtsConfig({
            provider: '',
            config: {},
            voiceSettings: {}
          });
        }}
        width={800}
        okText="保存配置"
        cancelText="取消"
      >
        <div className={styles.ttsConfigForm}>
          {/* 修改TTS服务按钮 */}
          <div className={styles.changeTtsServiceSection}>
            <span className={styles.changeTtsServiceHint}>
              当前服务：{ttsConfig.provider === 'xfyun' ? '讯飞云' : '字节跳动'}
            </span>
            <Button 
              type="default" 
              onClick={handleChangeTtsService}
              className={styles.changeTtsServiceBtn}
            >
              修改TTS服务
            </Button>
          </div>

          {/* 基础配置 */}
          <div className={styles.configSection}>
            <h4>基础配置</h4>
            {ttsConfig.provider === 'xfyun' ? (
              <>
                <div className={styles.formItem}>
                  <label>
                    App ID *
                    <Tooltip title="在讯飞开放平台创建应用后获得的应用标识">
                      <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                    </Tooltip>
                  </label>
                  <Input.Password
                    value={ttsConfig.config.appId || ''}
                    onChange={(e) => setTtsConfig(prev => ({
                      ...prev,
                      config: { ...prev.config, appId: e.target.value }
                    }))}
                    placeholder="请输入讯飞云App ID"
                  />
                </div>
                <div className={styles.formItem}>
                  <label>
                    API Key *
                    <Tooltip title="应用的接口密钥，用于API调用身份验证">
                      <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                    </Tooltip>
                  </label>
                  <Input.Password
                    value={ttsConfig.config.apiKey || ''}
                    onChange={(e) => setTtsConfig(prev => ({
                      ...prev,
                      config: { ...prev.config, apiKey: e.target.value }
                    }))}
                    placeholder="请输入讯飞云API Key"
                  />
                </div>
                <div className={styles.formItem}>
                  <label>
                    API Secret *
                    <Tooltip title="应用的接口密码，用于签名验证，请妥善保管">
                      <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                    </Tooltip>
                  </label>
                  <Input.Password
                    value={ttsConfig.config.apiSecret || ''}
                    onChange={(e) => setTtsConfig(prev => ({
                      ...prev,
                      config: { ...prev.config, apiSecret: e.target.value }
                    }))}
                    placeholder="请输入讯飞云API Secret"
                  />
                </div>
              </>
            ) : (
              <>
                <div className={styles.formItem}>
                  <label>
                    App ID *
                    <Tooltip title="在火山引擎控制台创建应用后获得的应用标识">
                      <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                    </Tooltip>
                  </label>
                  <Input.Password
                    value={ttsConfig.config.appId || ''}
                    onChange={(e) => setTtsConfig(prev => ({
                      ...prev,
                      config: { ...prev.config, appId: e.target.value }
                    }))}
                    placeholder="请输入字节跳动App ID"
                  />
                </div>
                <div className={styles.formItem}>
                  <label>
                    Token *
                    <Tooltip title="访问令牌，用于身份验证，请妥善保管">
                      <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                    </Tooltip>
                  </label>
                  <Input.Password
                    value={ttsConfig.config.token || ''}
                    onChange={(e) => setTtsConfig(prev => ({
                      ...prev,
                      config: { ...prev.config, token: e.target.value }
                    }))}
                    placeholder="请输入字节跳动Token"
                  />
                </div>
                <div className={styles.formItem}>
                  <label>
                    Cluster *
                    <Tooltip title="集群信息，指定服务区域，如：volcano_tts">
                      <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                    </Tooltip>
                  </label>
                  <Input.Password
                    value={ttsConfig.config.cluster || ''}
                    onChange={(e) => setTtsConfig(prev => ({
                      ...prev,
                      config: { ...prev.config, cluster: e.target.value }
                    }))}
                    placeholder="请输入集群信息"
                  />
                </div>
              </>
            )}
          </div>

          {/* 音色设置 */}
          <div className={styles.configSection}>
            <h4>
              音色设置
              <span className={styles.currentVoice}>
                （当前：{getVoiceName(ttsConfig.voiceSettings?.voiceType || 
                (ttsConfig.provider === 'xfyun' ? 'x4_xiaoyan' : 'zh_female_wanwanxiaohe_moon_bigtts'), 
                ttsConfig.provider)}）
              </span>
            </h4>
            {ttsConfig.provider === 'xfyun' ? (
              <div className={styles.voiceSelection}>
                {/* 性别筛选标签和搜索按钮 */}
                <div className={styles.voiceFilterContainer}>
                  <div className={styles.voiceFilterTabs}>
                    <div 
                      className={`${styles.filterTab} ${voiceGenderFilter === 'all' ? styles.activeTab : ''}`}
                      onClick={() => setVoiceGenderFilter('all')}
                    >
                      全部
                    </div>
                    <div 
                      className={`${styles.filterTab} ${voiceGenderFilter === 'female' ? styles.activeTab : ''}`}
                      onClick={() => setVoiceGenderFilter('female')}
                    >
                      女声
                    </div>
                    <div 
                      className={`${styles.filterTab} ${voiceGenderFilter === 'male' ? styles.activeTab : ''}`}
                      onClick={() => setVoiceGenderFilter('male')}
                    >
                      男声
                    </div>
                  </div>
                  <Button
                    icon={<SearchOutlined />}
                    onClick={() => setShowVoiceSearch(!showVoiceSearch)}
                    className={styles.voiceSearchButton}
                    type={showVoiceSearch ? "primary" : "default"}
                    size="small"
                  />
                </div>

                {/* 搜索框 */}
                {showVoiceSearch && (
                  <div className={styles.voiceSearchContainer}>
                    <Input.Search
                      placeholder="搜索音色名称、类别或语言..."
                      value={voiceSearchQuery}
                      onChange={(e) => setVoiceSearchQuery(e.target.value)}
                      allowClear
                      className={styles.voiceSearchInput}
                    />
                  </div>
                )}

                {/* 音色网格 */}
                <div className={styles.voiceGridSquare}>
                  {filterVoices(xfyunVoices, voiceGenderFilter, voiceSearchQuery)
                    .map((voice) => (
                    <div
                      key={voice.id}
                      className={`${styles.voiceCardSquare} ${
                        ttsConfig.voiceSettings?.voiceType === voice.id ? styles.selectedVoiceSquare : ''
                      }`}
                      onClick={() => {
                        setTtsConfig(prev => ({
                          ...prev,
                          voiceSettings: { ...prev.voiceSettings, voiceType: voice.id }
                        }));
                      }}
                    >
                      <div className={styles.voiceNameSquare}>{voice.name}</div>
                      <div className={styles.voiceTagsSquare}>
                        <span className={styles.voiceCategoryTag}>{voice.category}</span>
                        <span className={styles.voiceLanguageTag}>{voice.language}</span>
                        <span className={`${styles.voiceGenderTag} ${styles[voice.gender]}`}>
                          {voice.gender === 'male' ? '男声' : '女声'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.voiceSelection}>
                {/* 性别筛选标签和搜索按钮 */}
                <div className={styles.voiceFilterContainer}>
                  <div className={styles.voiceFilterTabs}>
                    <div 
                      className={`${styles.filterTab} ${voiceGenderFilter === 'all' ? styles.activeTab : ''}`}
                      onClick={() => setVoiceGenderFilter('all')}
                    >
                      全部
                    </div>
                    <div 
                      className={`${styles.filterTab} ${voiceGenderFilter === 'female' ? styles.activeTab : ''}`}
                      onClick={() => setVoiceGenderFilter('female')}
                    >
                      女声
                    </div>
                    <div 
                      className={`${styles.filterTab} ${voiceGenderFilter === 'male' ? styles.activeTab : ''}`}
                      onClick={() => setVoiceGenderFilter('male')}
                    >
                      男声
                    </div>
                  </div>
                  <Button
                    icon={<SearchOutlined />}
                    onClick={() => setShowVoiceSearch(!showVoiceSearch)}
                    className={styles.voiceSearchButton}
                    type={showVoiceSearch ? "primary" : "default"}
                    size="small"
                  />
                </div>

                {/* 搜索框 */}
                {showVoiceSearch && (
                  <div className={styles.voiceSearchContainer}>
                    <Input.Search
                      placeholder="搜索音色名称、类别或语言..."
                      value={voiceSearchQuery}
                      onChange={(e) => setVoiceSearchQuery(e.target.value)}
                      allowClear
                      className={styles.voiceSearchInput}
                    />
                  </div>
                )}

                {/* 音色网格 */}
                <div className={styles.voiceGridSquare}>
                  {filterVoices(bytedanceVoices, voiceGenderFilter, voiceSearchQuery)
                    .map((voice) => (
                    <div
                      key={voice.id}
                      className={`${styles.voiceCardSquare} ${
                        ttsConfig.voiceSettings?.voiceType === voice.id ? styles.selectedVoiceSquare : ''
                      }`}
                      onClick={() => {
                        setTtsConfig(prev => ({
                          ...prev,
                          voiceSettings: {
                            ...prev.voiceSettings,
                            voiceType: voice.id
                          }
                        }));
                      }}
                    >
                      <div className={styles.voiceNameSquare}>{voice.name}</div>
                      <div className={styles.voiceTagsSquare}>
                        <span className={styles.voiceCategoryTag}>{voice.category}</span>
                        <span className={styles.voiceLanguageTag}>{voice.language}</span>
                        <span className={`${styles.voiceGenderTag} ${styles[voice.gender]}`}>
                          {voice.gender === 'male' ? '男声' : '女声'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>


        </div>
      </Modal>
    );
  };

  // 修改配置修改模态框
  const renderConfigModal = () => (
    <Modal
      title="修改会话配置"
      open={configModalVisible}
      onOk={() => {
        const session = sessions.find(s => s.session_id === editingConfig?.session_id);
        if (session && editingConfig) {
          handleConfigEdit(session);
        }
      }}
      onCancel={() => {
        setConfigModalVisible(false);
        setEditingConfig(null);
      }}
      width={600}
    >
      {editingConfig && (
        <div className={styles.configForm}>
          <div className={styles.formItem}>
            <div className={styles.formLabel}>
              <RobotOutlined /> 选择模型
            </div>
            <Select 
              value={editingConfig.modelSettings.modelService}
              optionLabelProp="label"
              className={styles.modelSelectWrapper}
              onChange={async (value) => {
                console.log('会话配置中选择模型服务:', value);
                
                // 如果选择的是相同的模型服务，不做任何操作
                if (value === editingConfig.modelSettings.modelService) {
                  return;
                }
                
                // 尝试从后端获取配置
                const config = await getModelConfigFromServer(value);
                console.log('会话配置获取到的配置:', config);
                
                let newApiKey = '';
                
                // 根据不同的模型服务处理API密钥
                if (value === 'ollama') {
                  // Ollama模型无需密钥，显示提示文本
                  newApiKey = 'ollama模型无需密钥';
                } else if (config?.apiKey) {
                  // 如果有查询到API密钥，则使用
                  newApiKey = config.apiKey;
                } else {
                  // 其他情况清空API密钥
                  newApiKey = '';
                }
                
                const newModelName = getModelNameOptions(value)[0]?.value || editingConfig.modelSettings.modelName;
                const defaultParams = getModelDefaultParams(value, newModelName);
                
                setEditingConfig({
                  ...editingConfig,
                  modelSettings: { 
                    ...editingConfig.modelSettings, 
                    modelService: value,
                    baseUrl: config?.baseUrl || getDefaultBaseUrl(value),
                    apiKey: newApiKey,
                    modelName: newModelName,
                    modelParams: defaultParams // 只有真正切换模型服务时才重置参数
                  },
                  contextCount: editingConfig.contextCount // 保持当前的上下文数量设置
                });
              }}
              style={{ width: '100%' }}
            >
              {MODEL_SERVICES.map(option => (
                <Option key={option.value} value={option.value} label={
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <img 
                      src={option.logo} 
                      alt={option.label} 
                      style={{ width: '16px', height: '16px', objectFit: 'contain' }}
                    />
                    <span>{option.label}</span>
                  </div>
                }>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <img 
                      src={option.logo} 
                      alt={option.label} 
                      style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                    />
                    <span>{option.label}</span>
                  </div>
                </Option>
              ))}
            </Select>
          </div>

          <div className={styles.formItem}>
            <div className={styles.formLabel}>
              <ApiOutlined /> 服务地址
            </div>
            <Input 
              value={editingConfig.modelSettings.baseUrl}
              onChange={(e) => setEditingConfig({
                ...editingConfig,
                modelSettings: { ...editingConfig.modelSettings, baseUrl: e.target.value }
              })}
              placeholder="输入服务地址"
            />
          </div>

          <div className={styles.formItem}>
            <div className={styles.formLabel}>
              <ApiOutlined /> API密钥
            </div>
            {editingConfig.modelSettings.modelService === 'ollama' ? (
              <Input
                value={editingConfig.modelSettings.apiKey}
                disabled
                style={{ color: '#999' }}
              />
            ) : (
              <Input.Password
                value={editingConfig.modelSettings.apiKey}
                onChange={(e) => setEditingConfig({
                  ...editingConfig,
                  modelSettings: { ...editingConfig.modelSettings, apiKey: e.target.value }
                })}
                placeholder="输入API密钥"
              />
            )}
          </div>

          <div className={styles.formItem}>
            <div className={styles.formLabel}>
              <GlobalOutlined /> 模型名称
            </div>
            <Select 
              value={editingConfig.modelSettings.modelName}
              onChange={(value) => {
                // 如果选择的是相同的模型名称，不做任何操作
                if (value === editingConfig.modelSettings.modelName) {
                  return;
                }
                
                const defaultParams = getModelDefaultParams(editingConfig.modelSettings.modelService, value);
                setEditingConfig({
                  ...editingConfig,
                  modelSettings: { 
                    ...editingConfig.modelSettings, 
                    modelName: value,
                    modelParams: defaultParams // 只有真正切换模型名称时才重置参数
                  }
                });
              }}
              style={{ width: '100%' }}
              onDropdownVisibleChange={async (open) => {
                if (open && editingConfig.modelSettings.modelService === 'ollama') {
                  await fetchOllamaModels(editingConfig.modelSettings.baseUrl || getDefaultBaseUrl('ollama'));
                }
              }}
              notFoundContent={editingConfig.modelSettings.modelService === 'ollama' && isLoadingOllamaModels ? '加载中...' : undefined}
            >
              {editingConfig.modelSettings.modelService === 'ollama' ? (
                ollamaModels.map(option => (
                  <Option key={option.value} value={option.value}>
                    <span className={styles.modelOption}>
                      {('imageLabel' in option && (option as any).imageLabel) && (
                        <span className={styles.modelImageLabel}>{(option as any).imageLabel}</span>
                      )}
                      {option.label}
                    </span>
                  </Option>
                ))
              ) : (
                getModelNameOptions(editingConfig.modelSettings.modelService).map(option => (
                  <Option key={option.value} value={option.value}>
                    <span className={styles.modelOption}>
                      {('imageLabel' in option && (option as any).imageLabel) && (
                        <span className={styles.modelImageLabel}>{(option as any).imageLabel}</span>
                      )}
                      {option.label}
                    </span>
                  </Option>
                ))
              )}
            </Select>
          </div>

          <div className={styles.formItem}>
            <div className={styles.formLabel}>
              <FileTextOutlined /> System Prompt
            </div>
            <Input.TextArea
              value={editingConfig.systemPrompt}
              onChange={(e) => setEditingConfig({
                ...editingConfig,
                systemPrompt: e.target.value
              })}
              placeholder="输入System Prompt，留空则使用默认值"
              rows={4}
            />
          </div>

          <div className={styles.formItem}>
            <div className={styles.formLabel}>
              <MessageOutlined /> 上下文数量
            </div>
            <Input
              type="number"
              value={editingConfig.contextCount === null ? '' : String(editingConfig.contextCount)}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  // 如果输入框为空，设置为null（不限制上下文）
                  setEditingConfig({
                    ...editingConfig,
                    contextCount: null
                  });
                } else {
                  // 如果有输入，解析数字
                  const numValue = parseInt(value);
                  setEditingConfig({
                    ...editingConfig,
                    contextCount: isNaN(numValue) ? null : numValue
                  });
                }
              }}
              placeholder="输入上下文数量（留空表示不限制上下文，默认20）"
              min={0}
              max={100}
            />
          </div>

          {/* 模型参数设置（可选） */}
          <Collapse ghost>
            <Panel header="模型参数（可选）" key="model-params">
              {(() => {
                const service = editingConfig.modelSettings.modelService;
                const modelId = editingConfig.modelSettings.modelName;
                const providerConfig = (modelParamsConfig as any)[service] || {};
                const globalModelConfig = (modelParamsConfig as any)[modelId]?.default || (modelParamsConfig as any)[modelId] || null;
                const providerModelConfig = providerConfig[modelId]?.default || providerConfig[modelId] || null;
                // 优先按【模型名称】顶层配置；其次按厂商下的该模型ID；再回退厂商默认；Ollama 兜底通用默认
                const schema = globalModelConfig
                  || providerModelConfig
                  || providerConfig.default
                  || (service === 'ollama' ? (modelParamsConfig as any).ollama?.default : [])
                  || [];
                const currentParams = editingConfig.modelSettings.modelParams || {};
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {schema.map((item: any) => {
                      const value = currentParams[item.key] ?? item.default;
                      const onParamChange = (v: number | null) => {
                        const nv = v === null ? undefined : v;
                        setEditingConfig(prev => prev ? {
                          ...prev,
                          modelSettings: {
                            ...prev.modelSettings,
                            modelParams: {
                              ...(prev.modelSettings.modelParams || {}),
                              [item.key]: nv
                            }
                          }
                        } : prev);
                      };
                      return (
                        <div key={item.key} className={styles.formItem}>
                          <div className={styles.formLabel}>
                            {item.label}
                            {item.description ? (
                              <Tooltip title={item.description} placement="top">
                                <QuestionCircleOutlined style={{ marginLeft: 6, color: 'var(--text-secondary, #999)' }} />
                              </Tooltip>
                            ) : null}
                          </div>
                          {item.key === 'max_tokens' ? (
                            <InputNumber
                              className={styles.maxTokensInput}
                              min={item.min}
                              max={item.max}
                              step={item.step}
                              style={{ width: '100%' }}
                              value={value}
                              onChange={onParamChange}
                            />
                          ) : (
                            <div style={{ padding: '0 8px' }}>
                              <Slider
                                min={item.min}
                                max={item.max}
                                step={item.step}
                                tooltip={{ open: false }}
                                value={typeof value === 'number' ? value : item.default}
                                onChange={(v: number) => onParamChange(v)}
                              />
                              <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-secondary, #999)' }}>
                                {typeof value === 'number' ? value : item.default}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </Panel>
          </Collapse>
        </div>
      )}
    </Modal>
  );

  // 检查模型配置是否有变化
  const normalizeParams = (params?: Record<string, any>) => {
    const p = { ...(params || {}) } as Record<string, any>;
    Object.keys(p).forEach(k => {
      if (p[k] === undefined) delete p[k];
    });
    return p;
  };

  const shallowEqual = (a: Record<string, any>, b: Record<string, any>) => {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  };

  const hasModelConfigChanged = (original: ModelSettings, current: ModelSettings): boolean => {
    const basicChanged = (
      original.modelService !== current.modelService ||
      original.baseUrl !== current.baseUrl ||
      original.apiKey !== current.apiKey ||
      original.modelName !== current.modelName
    );
    
    // 检查模型参数是否有变化（不修改任何数据，只做比较）
    const origParams = normalizeParams(original.modelParams);
    const currParams = normalizeParams(current.modelParams);
    const paramsChanged = !shallowEqual(origParams, currParams);
    
    return basicChanged || paramsChanged;
  };

  // 检查是否有任何配置变化
  const hasAnyConfigChanged = (session: ChatSession): boolean => {
    if (!editingConfig) return false;
    
    const modelChanged = hasModelConfigChanged(session.model_settings, editingConfig?.modelSettings || session.model_settings);
    const systemPromptChanged = session.system_prompt !== editingConfig.systemPrompt;
    const contextCountChanged = session.context_count !== editingConfig.contextCount;
    
    return modelChanged || systemPromptChanged || contextCountChanged;
  };

  // 修改配置更新函数
  const handleConfigEdit = async (session: ChatSession) => {
    try {
      // 只有当模型配置发生变化时才进行测试
      const modelConfigChanged = hasModelConfigChanged(session.model_settings, editingConfig?.modelSettings || session.model_settings);
      if (modelConfigChanged) {
        const loadingKey = 'modelConfigTest';
        message.loading({ content: '正在测试模型配置，请稍候...', key: loadingKey, duration: 0 });
        try {
          const isConfigValid = await testModelConfig(editingConfig?.modelSettings || session.model_settings);
          message.destroy(loadingKey);
          if (!isConfigValid) {
            message.error('模型配置测试失败，请检查服务地址、API密钥和模型名称是否正确');
            return;
          }
          message.success('模型配置测试通过');
        } catch (error) {
          message.destroy(loadingKey);
          console.error('[Chat] 模型配置测试失败:', error);
          if (error instanceof Error) {
            message.error(`模型配置测试失败: ${error.message}`);
          } else {
            message.error('模型配置测试失败，请检查网络连接和配置信息');
          }
          return;
        }
      }

      // 如果没有任何变化则不提交
      if (!hasAnyConfigChanged(session)) {
        message.info('未检测到配置变化');
        setConfigModalVisible(false);
        setEditingConfig(null);
        return;
      }

      // 更新会话配置
      const updateData = {
        model_settings: editingConfig?.modelSettings,
        system_prompt: editingConfig?.systemPrompt,
        context_count: editingConfig?.contextCount
      };

      await updateSession(session.session_id, updateData as any);

      message.success('配置修改成功');
      setConfigModalVisible(false);
      setEditingConfig(null);

      // 重新获取会话列表以更新配置
      await useChatStore.getState().fetchSessions();

      // 如果是当前会话，重新建立连接
      if (currentSession?.session_id === session.session_id) {
        cleanupWebSocket();
        setTimeout(() => {
          establishConnection();
        }, 100);
      }
    } catch (e) {
      console.error(e);
      message.error('保存失败');
    }
  };

  // 修改工具按钮菜单
  const toolsMenu = (
    <Menu onClick={({ key }) => {
      if (key === 'call') {
        navigate('/call', { 
          state: { 
            sessionId: currentSession?.session_id 
          } 
        });
      }
    }}>
      <Menu.Item key="call" icon={<PhoneOutlined />}>
        打电话
      </Menu.Item>
    </Menu>
  );

  // 监听输入框变化
  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setCurrentMessage(value);
    setSentFlag(value.trim().length > 0);
  };

  // 处理剪贴板粘贴事件 - 支持图片粘贴
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // 检查当前模型是否支持图片
    if (!currentSessionSupportsImage) {
      return; // 如果不支持图片，就让默认的文本粘贴行为继续
    }

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 检查剪贴板中是否有图片文件
    const items = Array.from(clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));

    if (imageItems.length > 0) {
      // 阻止默认的粘贴行为（避免粘贴图片的文件路径或其他文本）
      e.preventDefault();

      const processedImages: File[] = [];

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;

        // 检查文件类型（虽然我们已经过滤了，但为了一致性再检查一次）
        if (!file.type.startsWith('image/')) {
          message.error(`粘贴的文件不是图片格式`);
          continue;
        }

        // 检查文件大小 (限制为10MB)
        if (file.size > 10 * 1024 * 1024) {
          message.error(`粘贴的图片大小不能超过10MB`);
          continue;
        }

        try {
          // 检查是否需要格式转换
          let processedFile = file;
          
          // 剪贴板图片经常是非标准格式，为了确保API兼容性，都转换为PNG
          // 这样可以避免WebP、BMP等格式的兼容性问题
          console.log(`剪贴板图片格式: ${file.type}，转换为PNG以确保兼容性`);
          processedFile = await convertImageToPNG(file);
          
          processedImages.push(processedFile);

          // 创建预览
          const reader = new FileReader();
          reader.onload = (event) => {
            const preview = event.target?.result as string;
            setImagePreviews(prev => [...prev, preview]);
          };
          reader.readAsDataURL(processedFile);
        } catch (error) {
          console.error('剪贴板图片处理失败:', error);
          message.error(`图片处理失败，请重试`);
          continue;
        }
      }

      if (processedImages.length > 0) {
        setSelectedImages(prev => [...prev, ...processedImages]);
        message.success(`成功粘贴 ${processedImages.length} 张图片`);
      }
    }
    // 如果没有图片，就让默认的文本粘贴行为继续
  };

  // 检测内容是否为JSON
  const isJSON = (str: string) => {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  };

  // 检测内容是否为代码块
  const isCodeBlock = (str: string) => {
    return str.startsWith('```') && str.endsWith('```');
  };

  // 提取代码块的语言和内容
  const extractCodeBlock = (str: string) => {
    const lines = str.split('\n');
    const firstLine = lines[0].slice(3).trim();
    const language = firstLine || 'plaintext';
    
    // 提取代码内容，移除首尾的空行
    let codeLines = lines.slice(1, -1); // 移除第一行（```语言）和最后一行（```）
    
    // 如果第一行有语言标识，再移除一行
    if (firstLine) {
      codeLines = codeLines.slice(1);
    }
    
    // 移除开头和结尾的空行
    while (codeLines.length > 0 && codeLines[0].trim() === '') {
      codeLines.shift();
    }
    while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === '') {
      codeLines.pop();
    }
    
    // 连接时不在末尾添加换行符
    const code = codeLines.join('\n');
    return { language, code };
  };

  // 复制代码到剪贴板
  const copyToClipboard = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();  // 阻止事件冒泡
    if (!text) return;
    
    try {
      // 使用异步函数包装
      const copyText = async () => {
        try {
          await navigator.clipboard.writeText(text);
          message.success('复制成功');
        } catch (err) {
          // 降级方案：使用传统的复制方法
          const textArea = document.createElement('textarea');
          textArea.value = text;
          document.body.appendChild(textArea);
          textArea.select();
          try {
            document.execCommand('copy');
            message.success('复制成功');
          } catch (e) {
            message.error('复制失败，请手动复制');
          }
          document.body.removeChild(textArea);
        }
      };
      copyText();
    } catch (error) {
      message.error('复制失败，请手动复制');
    }
  };

  // 删除消息函数
  const handleDeleteMessage = (index: number, content: string) => {
    setMessageToDelete({ index, content });
    setDeleteMessageModalVisible(true);
  };

  const confirmDeleteMessage = async () => {
    if (!messageToDelete || !currentSession) {
      return;
    }

    try {
      const apiUrl = getFullUrl('/api/chat/sessions');
      const response = await fetch(`${apiUrl}/${currentSession.session_id}/messages/${messageToDelete.index}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${useAuthStore.getState().token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // 从本地状态中移除消息
        setMessages(prevMessages => 
          prevMessages.filter((_, i) => i !== messageToDelete.index)
        );
        
        // 更新会话列表中的消息数量
        const newMessageCount = (currentSession.message_count || 0) - 1;
        updateSessionMessageCount(currentSession.session_id, newMessageCount);
        
        message.success('消息已删除');
      } else {
        const errorData = await response.json();
        message.error(`删除失败: ${errorData.detail || '未知错误'}`);
      }
    } catch (error) {
      console.error('删除消息失败:', error);
      message.error('删除消息失败');
    } finally {
      setDeleteMessageModalVisible(false);
      setMessageToDelete(null);
    }
  };

  // 修改消息函数
  const handleEditMessage = (index: number, content: string, images?: string[]) => {
    setMessageToEdit({ index, content, images: images || [] });
    setEditedContent(content);
    setEditedImages(images || []);
    setEditMessageModalVisible(true);
  };

  const confirmEditMessage = async () => {
    if (!messageToEdit || !currentSession) {
      return;
    }

    try {
      const apiUrl = getFullUrl('/api/chat/sessions');
      const response = await fetch(`${apiUrl}/${currentSession.session_id}/messages/${messageToEdit.index}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${useAuthStore.getState().token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: editedContent,
          images: editedImages,
          images_to_delete: (messageToEdit.images || []).filter(img => !editedImages.includes(img))
        })
      });

      if (response.ok) {
        const result = await response.json();
        // 更新本地消息状态
        setMessages(prevMessages => 
          prevMessages.map((msg, i) => 
            i === messageToEdit.index 
              ? { ...msg, content: editedContent, images: editedImages }
              : msg
          )
        );
        
        message.success('消息已修改');
      } else {
        const errorData = await response.json();
        message.error(`修改失败: ${errorData.detail || '未知错误'}`);
      }
    } catch (error) {
      console.error('修改消息失败:', error);
      message.error('修改消息失败');
    } finally {
      setEditMessageModalVisible(false);
      setMessageToEdit(null);
      setEditedContent('');
      setEditedImages([]);
    }
    };
  
  // 等待WebSocket连接就绪
  const waitForConnectionReady = async (maxWaitMs: number = 8000): Promise<boolean> => {
    // Deprecated: now using chatWSManager.ensureAuthorized
    return chatWSManager.ensureAuthorized(maxWaitMs);
  };
  
  // 将远程图片 URL 转为 File（以便复用 sendMessage 里现有的本地图片->base64 上传流程）
  const fetchUrlAsFile = async (url: string, filename?: string): Promise<File> => {
      // 对受保护的后端图片接口补充鉴权；并校验响应类型
      const headers: Record<string, string> = {};
      try {
        const origin = new URL(getFullUrl('')).origin;
        const target = new URL(url, origin);
        if (target.origin === origin && target.pathname.startsWith('/api/')) {
          // 优先使用内存中的 token，避免 localStorage 尚未同步导致 401
          let token = '';
          try {
            token = useAuthStore.getState().token || '';
          } catch {}
          if (!token) {
            const authState = JSON.parse(localStorage.getItem('auth-storage') || '{}');
            token = authState.state?.token || '';
          }
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch {}

      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`获取图片失败: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      // 若后端返回的是JSON（通常是未授权或错误），直接报错，避免把错误JSON当作图片编码
      if (blob.type && blob.type.includes('application/json')) {
        try {
          const text = await blob.text();
          console.error('[Chat] 获取图片返回JSON而非二进制：', text);
        } catch {}
        throw new Error('获取图片失败：可能未登录或没有权限');
      }

      const name = filename || url.split('/').pop() || `image_${Date.now()}.png`;
      const mime = blob.type && blob.type !== '' ? blob.type : 'image/png';
      return new File([blob], name, { type: mime });
    };
    
    const urlsToFiles = async (urls: string[]): Promise<File[]> => {
      const httpUrls = urls.map(u => (isAssistantMode ? u : convertMinioUrlToHttp(u)));
      const files = await Promise.all(httpUrls.map((u, i) => fetchUrlAsFile(u, `image_${i + 1}.png`)));
      return files;
    };
  
  // 新增：带容错的下载方法，部分失败不影响其他图片
  const urlsToFilesSafe = async (urls: string[]): Promise<{ files: File[]; previews: string[]; failed: string[] }> => {
    const httpUrls = urls.map(u => (isAssistantMode ? u : convertMinioUrlToHttp(u)));
    const results = await Promise.allSettled(
      httpUrls.map((u, i) => fetchUrlAsFile(u, `image_${i + 1}.png`))
    );
    const files: File[] = [];
    const previews: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        files.push(r.value);
        previews.push(httpUrls[i]);
      } else {
        console.error('[Chat] 图片准备失败:', httpUrls[i], r.reason);
        failed.push(httpUrls[i]);
      }
    }
    return { files, previews, failed };
  };
  
      // 从当前消息"重新发送"
  const handleResendFromMessage = async () => {
    if (!messageToEdit || !currentSession) return;
    const editingMsg = messages[messageToEdit.index];
    if (!editingMsg || editingMsg.role !== 'user') return;

    Modal.confirm({
      title: '确认重新发送？',
      content: '将删除本条消息及其之后的所有历史消息（包含图片文件），然后以前端当前编辑内容直接重新发送。不会修改数据库中的原消息。',
      okText: '确定',
      cancelText: '取消',
      async onOk() {
        try {
          if (isProcessing) {
            message.warning('当前仍在处理上一条消息，请稍后再试');
            return Promise.reject();
          }

          const finalContent = editedContent ?? messageToEdit.content ?? '';
          const finalImages = editedImages ?? messageToEdit.images ?? [];

          // 1) 先把需要重发的图片下载为本地 File，避免删除历史后取不到
          let files: File[] = [];
          let previewUrls: string[] = [];
          if (finalImages.length > 0) {
            try {
              const { files: okFiles, previews, failed } = await urlsToFilesSafe(finalImages);
              files = okFiles;
              previewUrls = previews;
              if (failed.length > 0) {
                message.warning(`部分图片处理失败（${failed.length}/${finalImages.length}），将仅发送成功部分`);
              }
            } catch (e) {
              console.error('图片准备失败:', e);
              message.warning('部分图片处理失败，将仅重新发送文本内容');
              files = [];
              previewUrls = [];
            }
          }

          // 1.1) 为即时渲染生成本地 dataURL 预览，避免使用可能已被删除的后端URL
          let localDataPreviews: string[] = [];
          if (files.length > 0) {
            try {
              localDataPreviews = await Promise.all(
                files.map(file => new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = (e) => resolve(e.target?.result as string);
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
                }))
              );
            } catch (e) {
              console.error('生成本地预览失败，将回退到后端URL预览:', e);
              localDataPreviews = previewUrls; // 回退
            }
          }

          const hasText = (finalContent || '').trim().length > 0;
          const hasAnyImage = files.length > 0;
          if (!hasText && !hasAnyImage) {
            message.warning('没有可发送的内容');
            return Promise.reject();
          }

          // 2) 再删除历史（包含当前这条）
          const apiUrl = getFullUrl('/api/chat/sessions');
          const deleteIndex = messageToEdit.index - 1; // 传 index-1 给后端的 /after，使之包含当前消息
          const resp = await fetch(`${apiUrl}/${currentSession.session_id}/messages/${deleteIndex}/after`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${useAuthStore.getState().token}`
            }
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            message.error(`删除历史失败：${err.detail || '未知错误'}`);
            return Promise.reject();
          }

          // 3) 本地也同步截断
          setMessages(prev => prev.slice(0, messageToEdit.index));
          updateSessionMessageCount(currentSession.session_id, messageToEdit.index);

          // 4) 关闭编辑态并同步输入区显示
          setEditMessageModalVisible(false);
          setMessageToEdit(null);
          setEditedContent('');
          setEditedImages([]);
          setCurrentMessage(finalContent);
          setSentFlag((finalContent || '').trim().length > 0);
          setSelectedImages(files);
          setImagePreviews(localDataPreviews);

          // 5) 发送（显式传参，避免状态竞争）
          await sendMessage({ text: finalContent, files, previews: localDataPreviews });
          message.success('已重新发送该消息');
          return Promise.resolve();
        } catch (e) {
          console.error(e);
          return Promise.reject(e);
        }
      }
    });
  };


  const handleRemoveImageFromEdit = (imageUrl: string) => {
    setEditedImages(prev => prev.filter(img => img !== imageUrl));
  };

  // 导出对话数据函数
  const handleExportChat = (session: ChatSession) => {
    setExportingSession(session);
    setExportFileName(session.name);
    setExportChatModalVisible(true);
  };

  // 清空对话（删除该会话的所有历史消息，并由后端清理其中的 MinIO 图片）
  const handleClearChat = (session: ChatSession) => {
    Modal.confirm({
      title: '确认清空',
      content: '将删除该会话的所有历史消息（包含消息中的图片文件）。此操作不可恢复，确定继续吗？',
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { className: styles.deleteButton },
      async onOk() {
        try {
          const apiUrl = getFullUrl('/api/chat/sessions');
          // 传 -1 表示删除全部历史，后端会同时清理 MinIO 图片
          const resp = await fetch(`${apiUrl}/${session.session_id}/messages/-1/after`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${useAuthStore.getState().token}`
            }
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            message.error(`清空对话失败：${err.detail || '未知错误'}`);
            return Promise.reject();
          }

          // 本地状态同步清空
          setMessages([]);
          updateSessionMessageCount(session.session_id, 0);
          message.success('对话已清空');
        } catch (e) {
          console.error('[Chat] 清空对话失败:', e);
          message.error('清空对话失败，请重试');
        }
      }
    });
  };

  const confirmExportChat = async () => {
    if (!exportingSession || !exportFileName.trim()) {
      message.error('请输入文件名');
      return;
    }

    try {
      const apiBase = getFullUrl('/api/chat/sessions');

      if (exportFormat === 'txt') {
        const response = await fetch(`${apiBase}/${exportingSession.session_id}/export`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${useAuthStore.getState().token}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          const blob = new Blob([data.data.conversation_text], { type: 'text/plain;charset=utf-8' });
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${exportFileName.trim()}.txt`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
          message.success('对话数据导出成功');
        } else {
          const errorData = await response.json();
          message.error(`导出失败: ${errorData.detail || '未知错误'}`);
        }
        return;
      }

      // JSON 导出
      const msgResp = await fetch(`${apiBase}/${exportingSession.session_id}/messages`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${useAuthStore.getState().token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!msgResp.ok) {
        const err = await msgResp.json().catch(() => ({}));
        message.error(`获取会话消息失败: ${err.detail || '未知错误'}`);
        return;
      }
      const history = await msgResp.json();

      const originalPrompt = exportingSession.system_prompt || '';
      const kbPrompt = (exportingSession as any)?.kb_settings?.kb_prompt_template || '';

      const toLocalOffsetISOString = (input: any): string | undefined => {
        if (input === undefined || input === null || input === '') return undefined;

        let d: Date;
        if (typeof input === 'number') {
          d = new Date(input);
        } else if (typeof input === 'string') {
          const hasTz = /([Zz]|[+\-]\d{2}:?\d{2})$/.test(input);
          const isoLike = /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(input);
          if (isoLike && !hasTz) {
            d = new Date(input.replace(' ', 'T') + 'Z');
          } else {
            d = new Date(input);
          }
        } else if (input instanceof Date) {
          d = input as Date;
        } else {
          d = new Date(input);
        }

        if (isNaN(d.getTime())) return undefined;

        const pad = (n: number) => String(n).padStart(2, '0');
        const year = d.getFullYear();
        const month = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const hours = pad(d.getHours());
        const minutes = pad(d.getMinutes());
        const seconds = pad(d.getSeconds());
        const offsetMin = -d.getTimezoneOffset();
        const sign = offsetMin >= 0 ? '+' : '-';
        const absMin = Math.abs(offsetMin);
        const offH = pad(Math.floor(absMin / 60));
        const offM = pad(absMin % 60);
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offH}:${offM}`;
      };

      const exportJson: any = {};
      exportJson.session_name = exportingSession.name;

      if (exportIncludeSystemPrompts) {
        const sys: any = {};
        if (originalPrompt) sys.original_prompt = originalPrompt;
        if (kbPrompt) sys.knowledge_base_prompt = kbPrompt;
        if (Object.keys(sys).length > 0) {
          exportJson.system = sys;
        }
      }

      exportJson.messages = [] as any[];
      const cleaned = Array.isArray(history) ? history : [];
      for (const msg of cleaned) {
        if (msg?.role !== 'user' && msg?.role !== 'assistant') continue;
        const item: any = {
          role: msg.role,
          content: msg.content ?? ''
        };
        if (exportIncludeTimestamps) {
          const ts = msg.timestamp || msg.create_time || msg.created_at;
          const localTs = toLocalOffsetISOString(ts);
          if (localTs) item.timestamp = localTs;
        }
        exportJson.messages.push(item);
      }

      const jsonStr = JSON.stringify(exportJson, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${exportFileName.trim()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('对话数据导出成功');
    } catch (error) {
      console.error('导出对话数据失败:', error);
      message.error('导出对话数据失败');
    } finally {
      setExportChatModalVisible(false);
      setExportingSession(null);
      setExportFileName('');
      setExportFormat('txt');
      setExportIncludeTimestamps(true);
      setExportIncludeSystemPrompts(true);
    }
  };

  // 代码块滚动控制函数 - 滚动页面到代码的不同位置
  const scrollToCodeTop = (e: React.MouseEvent, codeElement: HTMLElement) => {
    e.stopPropagation();
    // 找到代码块的标题栏进行定位
    const codeBlock = codeElement.closest(`.${styles.codeBlock}`);
    const codeHeader = codeBlock?.querySelector(`.${styles.codeHeader}`);
    const targetElement = codeHeader || codeElement;
    
    targetElement.scrollIntoView({
      behavior: 'auto', // 使用瞬间滚动，速度更快
      block: 'start',
      inline: 'nearest'
    });
  };

  const scrollToCodeBottom = (e: React.MouseEvent, codeElement: HTMLElement) => {
    e.stopPropagation();
    codeElement.scrollIntoView({
      behavior: 'auto', // 使用瞬间滚动，速度更快
      block: 'end',
      inline: 'nearest'
    });
  };

  // 渲染代码块
  const renderCodeBlock = (code: string, language: string) => {
    // 如果代码为空，返回简单提示
    if (!code || code.trim() === '') {
      return <div className={styles.codeBlock} style={{ padding: '12px', color: '#888' }}>空代码块</div>;
    }
    
    // 去除代码首尾的换行符，防止产生多余的空行
    const cleanCode = code.replace(/^\n+|\n+$/g, '');
    const codeLines = cleanCode ? cleanCode.split('\n') : [''];
    const lineCount = codeLines.length;
    const shouldShowScrollButtons = lineCount > 30; // 超过30行才显示滚动按钮
    const hasLanguage = language && language.trim() && language !== 'plaintext'; // 检查是否有有效语言
    
    // 移除基于代码长度的样式判断，所有代码块使用统一样式
    
    try {
      // 整块高亮一次，然后按行包裹并添加行号
      const highlightedBlock = getHighlightedHtml(cleanCode, language || 'plaintext');
      const highlightedLines = highlightedBlock.split('\n');
      const linesWithNumbers = highlightedLines.map((lineHtml, index) => {
        const lineNumber = index + 1;
        return `<div class="${styles.codeLine}"><span class="${styles.lineNumber}">${lineNumber}</span><span class="${styles.lineContent}">${lineHtml}</span></div>`;
      }).join('');
      
      return (
        <div className={`${styles.codeBlock} ${shouldShowScrollButtons ? styles.hasScrollButtons : ''}`}>
          {/* 只有当有语言信息时才显示头部栏 */}
          {hasLanguage ? (
            <div className={styles.codeHeader}>
              <span className={styles.codeLanguage}>{language}</span> {/* 保持原始大小写 */}
              <div className={styles.codeHeaderButtons}>
                {shouldShowScrollButtons && (
                  <Button 
                    className={styles.codeHeaderButton}
                    icon={<DownOutlined />}
                    onClick={(e) => {
                      const wrapper = e.currentTarget.closest(`.${styles.codeBlock}`)?.querySelector(`.${styles.codeWrapper}`) as HTMLElement;
                      if (wrapper) scrollToCodeBottom(e, wrapper);
                    }}
                    type="text"
                    size="small"
                    title="滚动到代码底部"
                  />
                )}
                <Button 
                  className={styles.codeHeaderButton}
                  icon={<CopyOutlined />}
                  onClick={(e) => copyToClipboard(code, e)}
                  type="text"
                  size="small"
                  title="复制代码"
                />
              </div>
            </div>
          ) : (
            /* 没有语言信息时，只显示一个复制按钮 */
          <Button 
            className={styles.copyButton}
            icon={<CopyOutlined />}
            onClick={(e) => copyToClipboard(code, e)}
            type="text"
            size="small"
              title="复制代码"
          />
          )}
          
          <div className={styles.codeWrapper}>
            <div className={styles.codeWithLineNumbers}>
              <pre className={styles.codeContentWithLineNumbers}>
                <code dangerouslySetInnerHTML={{ __html: linesWithNumbers }} />
            </pre>
          </div>
          </div>
          
          {/* 底部按钮 */}
          {shouldShowScrollButtons && (
            <>
              <Button 
                className={styles.codeScrollToTop}
                icon={<UpOutlined />}
                onClick={(e) => {
                  const wrapper = e.currentTarget.parentElement?.querySelector(`.${styles.codeWrapper}`) as HTMLElement;
                  if (wrapper) scrollToCodeTop(e, wrapper);
                }}
                type="text"
                size="small"
                title="滚动到代码顶部"
              />
              <Button 
                className={styles.codeBottomCopyButton}
                icon={<CopyOutlined />}
                onClick={(e) => copyToClipboard(code, e)}
                type="text"
                size="small"
                title="复制代码"
              />
            </>
          )}
        </div>
      );
    } catch (e) {
      // 对于无法高亮的代码，也添加行号（整块转义后再分行）
      const escapedBlock = cleanCode
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      const escapedLines = escapedBlock.split('\n');
      const linesWithNumbers = escapedLines.map((lineHtml, index) => {
        const lineNumber = index + 1;
        return `<div class="${styles.codeLine}"><span class="${styles.lineNumber}">${lineNumber}</span><span class="${styles.lineContent}">${lineHtml}</span></div>`;
      }).join('');
      
      return (
        <div className={`${styles.codeBlock} ${shouldShowScrollButtons ? styles.hasScrollButtons : ''}`}>
          {/* 只有当有语言信息时才显示头部栏 */}
          {hasLanguage ? (
            <div className={styles.codeHeader}>
              <span className={styles.codeLanguage}>{language}</span> {/* 保持原始大小写 */}
              <div className={styles.codeHeaderButtons}>
                {shouldShowScrollButtons && (
                  <Button 
                    className={styles.codeHeaderButton}
                    icon={<DownOutlined />}
                    onClick={(e) => {
                      const wrapper = e.currentTarget.closest(`.${styles.codeBlock}`)?.querySelector(`.${styles.codeWrapper}`) as HTMLElement;
                      if (wrapper) scrollToCodeBottom(e, wrapper);
                    }}
                    type="text"
                    size="small"
                    title="滚动到代码底部"
                  />
                )}
                <Button 
                  className={styles.codeHeaderButton}
                  icon={<CopyOutlined />}
                  onClick={(e) => copyToClipboard(code, e)}
                  type="text"
                  size="small"
                  title="复制代码"
                />
              </div>
            </div>
          ) : (
            /* 没有语言信息时，只显示一个复制按钮 */
          <Button 
            className={styles.copyButton}
            icon={<CopyOutlined />}
            onClick={(e) => copyToClipboard(code, e)}
            type="text"
            size="small"
              title="复制代码"
          />
          )}
          
          <div className={styles.codeWrapper}>
            <div className={styles.codeWithLineNumbers}>
              <pre className={styles.codeContentWithLineNumbers}>
                <code dangerouslySetInnerHTML={{ __html: linesWithNumbers }} />
              </pre>
          </div>
          </div>
          
          {/* 底部按钮 */}
          {shouldShowScrollButtons && (
            <>
              <Button 
                className={styles.codeScrollToTop}
                icon={<UpOutlined />}
                onClick={(e) => {
                  const wrapper = e.currentTarget.parentElement?.querySelector(`.${styles.codeWrapper}`) as HTMLElement;
                  if (wrapper) scrollToCodeTop(e, wrapper);
                }}
                type="text"
                size="small"
                title="滚动到代码顶部"
              />
              <Button 
                className={styles.codeBottomCopyButton}
                icon={<CopyOutlined />}
                onClick={(e) => copyToClipboard(code, e)}
                type="text"
                size="small"
                title="复制代码"
              />
            </>
          )}
        </div>
      );
    }
  };

  // 解析深度思考内容（支持未完成的think标签）
  const parseThinkingContent = (content: string) => {
    const parts = [];
    let lastIndex = 0;
    
    // 首先处理完整的 <think>...</think> 标签对
    const completeThinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let match;
    
    while ((match = completeThinkRegex.exec(content)) !== null) {
      // 添加think标签前的内容
      if (match.index > lastIndex) {
        const beforeThink = content.slice(lastIndex, match.index);
        if (beforeThink.trim()) {
          parts.push({ type: 'normal', content: beforeThink });
        }
      }
      
      // 添加完整的think标签内容
      parts.push({ type: 'thinking', content: match[1], isComplete: true });
      lastIndex = match.index + match[0].length;
    }

    // 检查是否有未完成的 <think> 标签（没有对应的 </think>）
    const remainingContent = content.slice(lastIndex);
    const incompleteThinkMatch = remainingContent.match(/<think>([\s\S]*)$/);
    
    if (incompleteThinkMatch) {
      // 有未完成的think标签
      const beforeIncompleteThink = remainingContent.slice(0, incompleteThinkMatch.index);
      if (beforeIncompleteThink.trim()) {
        parts.push({ type: 'normal', content: beforeIncompleteThink });
      }
      
      // 添加未完成的think内容
      parts.push({ 
        type: 'thinking', 
        content: incompleteThinkMatch[1], 
        isComplete: false 
      });
    } else if (remainingContent.trim()) {
      // 没有未完成的think标签，添加剩余的普通内容
      parts.push({ type: 'normal', content: remainingContent });
    }

    return parts.length > 0 ? parts : [{ type: 'normal', content }];
  };

  // 深度思考组件
  const ThinkingSection: React.FC<{ 
    content: string; 
    messageIndex: number; 
    thinkingIndex: number;
    messageTimestamp?: string;
    isComplete?: boolean;
    onToggle: (stateKey: string) => void;
    isExpanded: boolean;
  }> = React.memo(({ content, messageIndex, thinkingIndex, messageTimestamp, isComplete = true, onToggle, isExpanded }) => {
    // 使用消息时间戳作为稳定标识符，如果没有则使用索引
    const messageId = messageTimestamp || `msg-${messageIndex}`;
    const stateKey = `${messageId}-think-${thinkingIndex}`;
    
    const handleToggle = useCallback(() => {
      onToggle(stateKey);
    }, [onToggle, stateKey]);
    
    return (
      <div className={`${styles.thinkingSection} ${!isComplete ? styles.thinkingSectionInProgress : ''}`}>
        <div 
          className={styles.thinkingHeader}
          onClick={handleToggle}
        >
          <span className={styles.thinkingIcon}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className={styles.thinkingLabel}>
            深度思考{!isComplete && ' (进行中...)'}
          </span>
          <span className={styles.thinkingToggle}>
            {isExpanded ? '收起' : '展开'}
          </span>
        </div>
        {isExpanded && (
          <div className={styles.thinkingContent}>
            {isComplete ? (
              <ReactMarkdown
                components={{
                  code({ className, children }) {
                    const language = className?.replace('language-', '') || 'plaintext';
                    return renderCodeBlock(String(children), language);
                  },
                  p: ({ children }) => <span style={{ whiteSpace: 'normal', display: 'inline' }}>{children}</span>
                }}
                remarkPlugins={[remarkGfm]}
              >
                {content}
              </ReactMarkdown>
            ) : (
              // 对于未完成的内容，使用简单的文本渲染避免频繁的Markdown解析
              <div style={{ whiteSpace: 'normal', margin: 0, lineHeight: 1.5 }}>
                {content}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }, (prevProps, nextProps) => {
    // 自定义比较函数，只有内容真正变化时才重新渲染
    return (
      prevProps.content === nextProps.content &&
      prevProps.messageIndex === nextProps.messageIndex &&
      prevProps.thinkingIndex === nextProps.thinkingIndex &&
      prevProps.messageTimestamp === nextProps.messageTimestamp &&
      prevProps.isComplete === nextProps.isComplete &&
      prevProps.isExpanded === nextProps.isExpanded &&
      prevProps.onToggle === nextProps.onToggle
    );
  });

  // 渲染消息内容
  const renderMessageContent = useCallback((content: string, messageIndex: number, messageTimestamp?: string, references?: any[]) => {
    // 检查是否包含深度思考标签
    if (content.includes('<think>')) {
      const parts = parseThinkingContent(content);
      return (
        <div>
          {parts.map((part, index) => {
            if (part.type === 'thinking') {
              const messageId = messageTimestamp || `msg-${messageIndex}`;
              const stateKey = `${messageId}-think-${index}`;
              const isExpanded = thinkingSectionStates[stateKey] ?? false;
              
              return (
                <ThinkingSection 
                  key={`thinking-${messageIndex}-${index}`} 
                  content={part.content} 
                  messageIndex={messageIndex}
                  thinkingIndex={index}
                  messageTimestamp={messageTimestamp}
                  isComplete={part.isComplete}
                  onToggle={toggleThinkingSection}
                  isExpanded={isExpanded}
                />
              );
            } else {
              // 渲染普通内容
              return (
                <div key={`normal-${messageIndex}-${index}`}>
                  {renderNormalContent(part.content, references)}
                </div>
              );
            }
          })}
        </div>
      );
    }

    return renderNormalContent(content, references);
  }, [thinkingSectionStates, toggleThinkingSection]);

  // 仅在代码块外部将 \\n 转换为换行，避免破坏三引号代码块内容
  const decodeOutsideCodeBlocks = (text: string) => {
    const blocks: string[] = [];
    const masked = text.replace(/```[\s\S]*?```/g, (m) => {
      blocks.push(m);
      return `§CODE_BLOCK_${blocks.length - 1}§`;
    });
    const decoded = masked
      .replace(/\r\n/g, '\n')
      .replace(/\\n/g, '\n');
    return decoded.replace(/§CODE_BLOCK_(\d+)§/g, (_, i) => blocks[Number(i)]);
  };

  // 渲染普通内容（原来的逻辑）
  const renderNormalContent = (content: string, references?: any[]) => {
    // 如果是助手模式且有引用信息，处理片段标识符
    if (isAssistantMode && references && references.length > 0) {
      return renderRAGFlowContent(content, references);
    }

    // 检查是否为JSON字符串
    if (isJSON(content)) {
      try {
        const jsonData = JSON.parse(content);
        // 如果是空对象或空数组，直接显示原始文本
        if (Object.keys(jsonData).length === 0 || 
           (Array.isArray(jsonData) && jsonData.length === 0)) {
          return <pre>{content}</pre>;
        }
        return (
          <div className={styles.jsonViewer}>
            <JsonViewer.default 
              value={jsonData}
              style={{ backgroundColor: 'transparent' }}
              displayDataTypes={false}
              enableClipboard={true}
            />
          </div>
        );
      } catch (e) {
        return <pre>{content}</pre>;
      }
    }

    // 检查是否为代码块
    if (isCodeBlock(content)) {
      const { language, code } = extractCodeBlock(content);
      return renderCodeBlock(code, language);
    }

    // 如果不是JSON也不是代码块，使用ReactMarkdown渲染
    const decodedMarkdownText = decodeOutsideCodeBlocks(content);

    return (
      <ReactMarkdown
        components={{
                    code({ className, children }: any) {
            const codeContent = String(children).replace(/\n+$/, ''); // 移除末尾换行符
            const isInline = !className && !codeContent.includes('\n');
            
            // 只有多行代码块才使用代码块渲染器（有className或包含换行符）
            if (!isInline && (className || codeContent.includes('\n'))) {
            const language = className?.replace('language-', '') || 'plaintext';
              return renderCodeBlock(codeContent, language);
            }
            
            // 内联代码使用简单的code标签
            return (
              <code 
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  padding: '2px 4px',
                  borderRadius: '3px',
                  fontFamily: 'Monaco, Menlo, Ubuntu Mono, monospace',
                  fontSize: '0.9em'
                }}
              >
                {children}
              </code>
            );
          },
          // 列表与段落：去除默认外边距，保持紧凑换行
                      p: ({ children }) => <p style={{ whiteSpace: 'normal' }}>{children}</p>,
            ol: ({ children }) => <ol style={{ paddingLeft: '1.25em' }}>{children}</ol>,
            ul: ({ children }) => <ul style={{ paddingLeft: '1.25em' }}>{children}</ul>,
            li: ({ children }) => <li style={{ margin: 0 }}>{children}</li>
        }}
        remarkPlugins={[remarkGfm, remarkBreaks]}
      >
        {decodedMarkdownText}
      </ReactMarkdown>
    );
  };

  // RAGFlow内容渲染，处理片段标识符##N$$
  const renderRAGFlowContent = (content: string, references: any[]) => {
    // 匹配##数字$$模式的正则表达式
    const fragmentRegex = /##(\d+)\$\$/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = fragmentRegex.exec(content)) !== null) {
      // 添加片段标识符之前的文本
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: content.slice(lastIndex, match.index)
        });
      }

      // 添加片段标识符
      const fragmentIndex = parseInt(match[1]);
      parts.push({
        type: 'reference',
        content: match[0],
        index: fragmentIndex,
        reference: references[fragmentIndex] || null
      });

      lastIndex = match.index + match[0].length;
    }

    // 添加最后剩余的文本
    if (lastIndex < content.length) {
      parts.push({
        type: 'text',
        content: content.slice(lastIndex)
      });
    }

    // 如果没有找到片段标识符，直接渲染原始内容
    if (parts.length === 0) {
      return (
        <ReactMarkdown
          components={{
            code({ className, children }: any) {
              const codeContent = String(children).replace(/\n+$/, '');
              const isInline = !className && !codeContent.includes('\n');
              
              if (!isInline && (className || codeContent.includes('\n'))) {
                const language = className?.replace('language-', '') || 'plaintext';
                return renderCodeBlock(codeContent, language);
              }
              
              return (
                <code 
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    padding: '2px 4px',
                    borderRadius: '3px',
                    fontFamily: 'Monaco, Menlo, Ubuntu Mono, monospace',
                    fontSize: '0.9em'
                  }}
                >
                  {children}
                </code>
              );
            },
            p: ({ children }) => <span style={{ whiteSpace: 'normal', display: 'inline' }}>{children}</span>,
            ol: ({ children }) => <ol style={{ margin: 0, paddingLeft: '1.25em', display: 'inline' }}>{children}</ol>,
            ul: ({ children }) => <ul style={{ margin: 0, paddingLeft: '1.25em', display: 'inline' }}>{children}</ul>,
            li: ({ children }) => <li style={{ margin: 0 }}>{children}</li>
          }}
          remarkPlugins={[remarkGfm]}
        >
          {content}
        </ReactMarkdown>
      );
    }

    // 渲染包含片段标识符的内容
    return (
      <div style={{ display: 'inline' }}>
        {parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <ReactMarkdown
                key={index}
                components={{
                  code({ className, children }: any) {
                    const codeContent = String(children).replace(/\n+$/, '');
                    const isInline = !className && !codeContent.includes('\n');
                    
                    if (!isInline && (className || codeContent.includes('\n'))) {
                      const language = className?.replace('language-', '') || 'plaintext';
                      return renderCodeBlock(codeContent, language);
                    }
                    
                    return (
                      <code 
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          padding: '2px 4px',
                          borderRadius: '3px',
                          fontFamily: 'Monaco, Menlo, Ubuntu Mono, monospace',
                          fontSize: '0.9em'
                        }}
                      >
                        {children}
                      </code>
                    );
                  },
                  p: ({ children }) => <span style={{ whiteSpace: 'pre-wrap', display: 'inline' }}>{children}</span>
                }}
                remarkPlugins={[remarkGfm]}
              >
                {part.content}
              </ReactMarkdown>
            );
          } else if (part.type === 'reference') {
            return (
                            <Tooltip
                key={index}
                title={
                  part.reference ? (
                    <div style={{ 
                      maxWidth: '90vw', 
                      background: 'var(--bg-primary)',
                      padding: '16px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-secondary)'
                    }}>
                      <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: '16px', color: 'var(--text-primary)' }}>
                        📄 {part.reference.document_name}
                      </div>
                      <div style={{ marginBottom: 8, fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {(() => {
                          const sim = Number(part.reference?.similarity ?? part.reference?.score ?? part.reference?.relevance ?? 0);
                          return `📊 相似度: ${ (sim * 100).toFixed(1) }%`;
                        })()}
                      </div>
                      <div 
                        className={styles.referenceContentArea}
                        style={{ 
                          maxHeight: 400, 
                          overflow: 'auto',
                          overflowX: 'hidden',
                          fontSize: '14px',
                          lineHeight: '1.6',
                          background: 'var(--bg-secondary)',
                          padding: 12,
                          borderRadius: 6,
                          marginTop: 8,
                          border: '1px solid var(--border-primary)',
                          wordWrap: 'break-word',
                          overflowWrap: 'anywhere',
                          whiteSpace: 'pre-wrap',
                          color: 'var(--text-primary)'
                        }}>
                        {(() => {
                          let content = '';
                          try {
                            if (typeof part.reference.content === 'string') {
                              // 尝试解析JSON内容
                              try {
                                const jsonContent = JSON.parse(part.reference.content);
                                if (jsonContent && typeof jsonContent === 'object') {
                                  // 提取论文的摘要或标题
                                  if (jsonContent['0'] && jsonContent['0'].Abstract) {
                                    content = jsonContent['0'].Abstract.replace(/<[^>]*>/g, ''); // 移除HTML标签
                                  } else if (jsonContent['0'] && jsonContent['0'].Title) {
                                    content = jsonContent['0'].Title;
                                  } else {
                                    content = JSON.stringify(jsonContent, null, 2);
                                  }
                                } else {
                                  content = part.reference.content;
                                }
                              } catch {
                                content = part.reference.content;
                              }
                            } else {
                              content = JSON.stringify(part.reference.content, null, 2);
                            }
                          } catch {
                            // 解析失败时回退到原始文本
                            try {
                              content = String(part.reference?.content ?? '');
                            } catch {
                              content = '无法显示引用内容';
                            }
                          }
                          
                          // 不再截断内容，让用户看到完整内容并通过滚动查看
                          return content;
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div>引用信息不可用</div>
                  )
                }
                placement="top"
                trigger={["hover", "click"]}
                overlayStyle={{ maxWidth: 720, pointerEvents: 'auto' }}
                getPopupContainer={() => document.body}
                mouseEnterDelay={0.08}
                mouseLeaveDelay={0.2}
              >
                <span 
                  className={styles.referenceIndicator}
                >
                                     {(part.index ?? 0) + 1}
                </span>
              </Tooltip>
            );
          }
          return null;
        })}
      </div>
    );
  };

     // 渲染文档引用列表
   const renderDocumentReferences = (references: any[]) => {
     if (!references || references.length === 0) return null;

     // 按文档分组引用，并提取文档标题
     const groupedRefs = references.reduce((acc: any, ref: any) => {
       let docName = ref.document_name || 'Unknown Document';
       let docTitle = docName;
       
       // 尝试从content中提取文档标题
       try {
         if (ref.content && typeof ref.content === 'string') {
           const jsonContent = JSON.parse(ref.content);
           if (jsonContent && jsonContent['0'] && jsonContent['0'].Title) {
             docTitle = jsonContent['0'].Title;
           }
         }
       } catch {
         // 如果解析失败，使用原始文档名
       }
       
       if (!acc[docName]) {
         acc[docName] = {
           title: docTitle,
           filename: docName,
           refs: []
         };
       }
       acc[docName].refs.push(ref);
       return acc;
     }, {});

     return (
       <div className={styles.documentReferences}>
         {Object.entries(groupedRefs).map(([docName, docInfo]: [string, any]) => (
           <div 
             key={docName} 
             className={styles.documentReferenceItem}
             onClick={() => {
               // 这里可以添加点击查看文档的逻辑
               console.log('查看文档:', docName, docInfo);
               
               // 创建一个模态框显示文档详情
               Modal.info({
                 title: '文档详情',
                 width: 800,
                 content: (
                   <div>
                     <p><strong>文档标题:</strong> {docInfo.title}</p>
                     <p><strong>文件名:</strong> {docInfo.filename}</p>
                     <p><strong>引用片段数:</strong> {docInfo.refs.length}</p>
                     <div style={{ marginTop: 16 }}>
                       <strong>引用片段:</strong>
                       {(() => {
                         const ReferenceList: React.FC<{ refs: any[] }> = ({ refs }) => {
                           const [expanded, setExpanded] = React.useState(false);
                           const visibleRefs = expanded ? refs : refs.slice(0, 3);
                           return (
                             <div>
                               {visibleRefs.map((ref: any, index: number) => (
                                 <div key={index} style={{ 
                                   background: 'rgba(0,0,0,0.05)', 
                                   padding: 12, 
                                   margin: '8px 0', 
                                   borderRadius: 4,
                                   border: '1px solid rgba(0,0,0,0.1)'
                                 }}>
                                   <div style={{ fontSize: '12px', color: '#666', marginBottom: 4 }}>
                                     {(() => {
                                       const sim = Number(ref?.similarity ?? ref?.score ?? ref?.relevance ?? 0);
                                       return `相似度: ${ (sim * 100).toFixed(1) }%`;
                                     })()}
                                   </div>
                                   <div style={{ fontSize: '13px', lineHeight: 1.4 }}>
                                     {(() => {
                                       try {
                                         if (typeof ref.content === 'string') {
                                           const jsonContent = JSON.parse(ref.content);
                                           if (jsonContent['0'] && jsonContent['0'].Abstract) {
                                             return jsonContent['0'].Abstract.replace(/<[^>]*>/g, '').substring(0, 300) + '...';
                                           }
                                         }
                                         return typeof ref.content === 'string' 
                                           ? ref.content.substring(0, 300) + '...'
                                           : JSON.stringify(ref.content).substring(0, 300) + '...';
                                       } catch {
                                         try {
                                           return String(ref?.content ?? '');
                                         } catch {
                                           return '无法显示引用内容';
                                         }
                                       }
                                     })()}
                                   </div>
                                 </div>
                               ))}
                               {refs.length > 3 && (
                                 <div style={{ textAlign: 'center', color: '#1677ff', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}
                                   onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                                 >
                                   {expanded ? '收起' : `展开剩余 ${refs.length - 3} 条`}
                                 </div>
                               )}
                             </div>
                           );
                         };
                         return <ReferenceList refs={docInfo.refs} />;
                       })()}
                     </div>
                   </div>
                 ),
                 onOk() {}
               });
             }}
             style={{
               display: 'flex',
               alignItems: 'center',
               padding: '8px 12px',
               background: 'rgba(22, 119, 255, 0.1)',
               border: '1px solid rgba(22, 119, 255, 0.3)',
               borderRadius: '6px',
               margin: '4px 0',
               cursor: 'pointer',
               transition: 'all 0.2s ease'
             }}
             onMouseEnter={(e) => {
               e.currentTarget.style.background = 'rgba(22, 119, 255, 0.15)';
             }}
             onMouseLeave={(e) => {
               e.currentTarget.style.background = 'rgba(22, 119, 255, 0.1)';
             }}
           >
             <FileTextOutlined style={{ color: '#1677ff', marginRight: 8 }} />
             <div style={{ flex: 1 }}>
               <div style={{ fontWeight: 500, fontSize: '13px' }}>
                 {docInfo.title}
               </div>
               <div style={{ fontSize: '11px', opacity: 0.7 }}>
                 {docInfo.refs.length} 个引用片段 • {docInfo.filename}
               </div>
             </div>
             <div style={{ fontSize: '11px', color: '#1677ff' }}>
               点击查看
             </div>
           </div>
         ))}
       </div>
     );
   };

  // 会话切换时加载对应背景
  useEffect(() => {
    (async () => {
      const fetchStartedAt = Date.now();
      backgroundFetchSeqRef.current = fetchStartedAt;
      try {
        // 优先使用内存中的 token，避免 localStorage 尚未同步导致 401
        let token = '';
        try { token = useAuthStore.getState().token || ''; } catch {}
        if (!token) {
          const authState = JSON.parse(localStorage.getItem('auth-storage') || '{}');
          token = authState.state?.token || '';
        }
        if (!token) { if (backgroundManuallySetAtRef.current <= fetchStartedAt) setBackgroundImageUrl(''); return; }

        if (isAssistantMode && currentAssistantSession?.id) {
          const resp = await fetch(`/api/auth/assistant-role-background/${encodeURIComponent(currentAssistantSession.id)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (resp.ok) {
            const data = await resp.json();
            const url = convertMinioUrlToHttp(data.data_url || data.background_url || '');
            if (backgroundManuallySetAtRef.current <= fetchStartedAt && backgroundFetchSeqRef.current === fetchStartedAt) {
              await setSafeBackgroundImage(url);
            }
          } else {
            if (backgroundManuallySetAtRef.current <= fetchStartedAt && backgroundFetchSeqRef.current === fetchStartedAt) {
              setBackgroundImageUrl('');
            }
          }
        } else if (!isAssistantMode && currentSession?.session_id) {
          const resp = await fetch(`/api/auth/role-background/${encodeURIComponent(currentSession.session_id)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (resp.ok) {
            const data = await resp.json();
            const url = convertMinioUrlToHttp(data.data_url || data.background_url || '');
            if (backgroundManuallySetAtRef.current <= fetchStartedAt && backgroundFetchSeqRef.current === fetchStartedAt) {
              await setSafeBackgroundImage(url);
            }
          } else {
            if (backgroundManuallySetAtRef.current <= fetchStartedAt && backgroundFetchSeqRef.current === fetchStartedAt) {
              setBackgroundImageUrl('');
            }
          }
        } else {
          if (backgroundManuallySetAtRef.current <= fetchStartedAt && backgroundFetchSeqRef.current === fetchStartedAt) {
            setBackgroundImageUrl('');
          }
        }
      } catch (e) {
        if (backgroundManuallySetAtRef.current <= fetchStartedAt && backgroundFetchSeqRef.current === fetchStartedAt) {
          setBackgroundImageUrl('');
        }
      }
    })();
  }, [isAssistantMode, currentAssistantSession?.id, currentSession?.session_id]);

  // Safely set background image: if the URL is a protected API path, fetch with token and convert to blob URL
  const setSafeBackgroundImage = async (rawUrl: string) => {
    try {
      if (!rawUrl) {
        if (backgroundObjectUrlRef.current) {
          URL.revokeObjectURL(backgroundObjectUrlRef.current);
          backgroundObjectUrlRef.current = null;
        }
        setBackgroundImageUrl('');
        return;
      }

      const isDataUrl = rawUrl.startsWith('data:');
      const isAbsolute = /^https?:\/\//i.test(rawUrl);
      const origin = getFullUrl('');
      const isApiPath = rawUrl.includes('/api/auth/');

      // Only need authorized fetch for our protected API paths
      if (!isDataUrl && isApiPath) {
        // 优先使用内存中的 token，避免 localStorage 尚未同步导致 401
        let token = '';
        try {
          token = useAuthStore.getState().token || '';
        } catch {}
        if (!token) {
          const authState = JSON.parse(localStorage.getItem('auth-storage') || '{}');
          token = authState.state?.token || '';
        }
        // Build absolute URL if needed
        const absoluteUrl = isAbsolute ? rawUrl : `${origin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
        const resp = await fetch(absoluteUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
        if (!resp.ok) throw new Error(`背景图片获取失败: ${resp.status}`);

        // 若返回JSON（/api/auth/role-background 返回 { data_url })，解析后直接设置
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await resp.json();
          const extracted = json?.data_url || json?.background_url || '';
          if (!extracted) throw new Error('响应中缺少 data_url/background_url');
          // 递归利用本函数设置，兼容 data: 或 其他可直接访问的 URL
          await setSafeBackgroundImage(extracted);
          return;
        }

        const blob = await resp.blob();
        // 容错：如果意外拿到JSON Blob，再次解析
        if (blob.type && blob.type.includes('application/json')) {
          try {
            const text = await blob.text();
            const json = JSON.parse(text);
            const extracted = json?.data_url || json?.background_url || '';
            if (extracted) {
              await setSafeBackgroundImage(extracted);
              return;
            }
          } catch {}
          throw new Error('获取到JSON而非图片数据');
        }

        const objectUrl = URL.createObjectURL(blob);
        if (backgroundObjectUrlRef.current) {
          URL.revokeObjectURL(backgroundObjectUrlRef.current);
        }
        backgroundObjectUrlRef.current = objectUrl;
        setBackgroundImageUrl(objectUrl);
        return;
      }

      // For data URLs or public URLs, set directly
      if (backgroundObjectUrlRef.current) {
        URL.revokeObjectURL(backgroundObjectUrlRef.current);
        backgroundObjectUrlRef.current = null;
      }
      setBackgroundImageUrl(rawUrl);
    } catch (err) {
      console.error('设置背景图片失败:', err);
      // Fallback: clear background
      if (backgroundObjectUrlRef.current) {
        URL.revokeObjectURL(backgroundObjectUrlRef.current);
        backgroundObjectUrlRef.current = null;
      }
      setBackgroundImageUrl('');
    }
  };

  // 代码高亮缓存，按 code+language 进行结果缓存，避免重复高亮计算
  const highlightCacheRef = useRef<Map<string, string>>(new Map());

  const getHighlightedHtml = useCallback((codeText: string, lang: string) => {
    const cacheKey = `${lang}__SEP__${codeText}`;
    const cached = highlightCacheRef.current.get(cacheKey);
    if (cached) return cached;
    try {
      const { value } = hljs.highlight(codeText, { language: lang || 'plaintext' });
      highlightCacheRef.current.set(cacheKey, value);
      return value;
    } catch {
      // 回退到转义文本
      const escaped = codeText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      highlightCacheRef.current.set(cacheKey, escaped);
      return escaped;
    }
  }, []);

  // 渲染消息列表
  return (
    <Layout className={styles.chatLayout}>
      {/* 隐藏的助手头像选择器 */}
      <input
        ref={hiddenAssistantAvatarInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          await handleAssistantAvatarUpload(file as File);
          if (hiddenAssistantAvatarInputRef.current) {
            (hiddenAssistantAvatarInputRef.current as any).value = '';
          }
        }}
      />
      {/* 隐藏的背景图片选择器 */}
      <input
        ref={hiddenBgInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          try {
            const reader = new FileReader();
            reader.onload = async (ev) => {
              const dataUrl = ev.target?.result as string;
              try {
                const authState = JSON.parse(localStorage.getItem('auth-storage') || '{}');
                const token = authState.state?.token;
                if (!token) throw new Error('未登录');
                const base64 = dataUrl.startsWith('data:image') ? dataUrl.split(',')[1] : dataUrl;

                // 根据预先记录的"上传目标"决定上传到哪个会话
                const target = backgroundUploadTarget;
                if (target && target.type === 'assistant') {
                  const resp = await fetch('/api/auth/upload-assistant-role-background', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar: base64, assistant_id: target.assistantId, session_id: target.sessionId })
                  });
                  if (!resp.ok) throw new Error(await resp.text());
                  await resp.json();
                  // 仅当目标正是当前助手会话时，才立刻渲染
                  if (isAssistantMode && currentAssistantSession && currentAssistantSession.id === target.sessionId) {
                    backgroundManuallySetAtRef.current = Date.now();
                    await setSafeBackgroundImage(`/api/auth/assistant-role-background/${encodeURIComponent(target.sessionId)}`);
                  }
                } else if (target && target.type === 'traditional') {
                  const resp = await fetch('/api/auth/upload-role-background', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar: base64, session_id: target.sessionId })
                  });
                  if (!resp.ok) throw new Error(await resp.text());
                  await resp.json();
                  // 仅当目标正是当前传统会话时，才立刻渲染
                  if (!isAssistantMode && currentSession && currentSession.session_id === target.sessionId) {
                    backgroundManuallySetAtRef.current = Date.now();
                    await setSafeBackgroundImage(`/api/auth/role-background/${encodeURIComponent(target.sessionId)}`);
                  }
                } else if (isAssistantMode && currentAssistant && currentAssistantSession) {
                  // 回退：未记录目标但当前是助手会话，按当前助手会话上传
                  const resp = await fetch('/api/auth/upload-assistant-role-background', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar: base64, assistant_id: currentAssistant.id, session_id: currentAssistantSession.id })
                  });
                  if (!resp.ok) throw new Error(await resp.text());
                  await resp.json();
                  backgroundManuallySetAtRef.current = Date.now();
                  await setSafeBackgroundImage(`/api/auth/assistant-role-background/${encodeURIComponent(currentAssistantSession.id)}`);
                } else if (currentSession) {
                  // 回退：未记录目标但当前是传统会话，按当前传统会话上传
                  const resp = await fetch('/api/auth/upload-role-background', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar: base64, session_id: currentSession.session_id })
                  });
                  if (!resp.ok) throw new Error(await resp.text());
                  await resp.json();
                  backgroundManuallySetAtRef.current = Date.now();
                  await setSafeBackgroundImage(`/api/auth/role-background/${encodeURIComponent(currentSession.session_id)}`);
                } else {
                  // 未选择任何会话的情况：仅本地预览
                  backgroundManuallySetAtRef.current = Date.now();
                  setBackgroundImageUrl(dataUrl);
                }
              } catch (e) {
                console.error(e);
                backgroundManuallySetAtRef.current = Date.now();
                setBackgroundImageUrl(dataUrl);
              } finally {
                // 上传完成后清理目标
                setBackgroundUploadTarget(null);
              }
            };
            reader.readAsDataURL(file);
          } catch (err) {
            message.error('背景图片设置失败');
          } finally {
            if (hiddenBgInputRef.current) {
              (hiddenBgInputRef.current as any).value = '';
            }
          }
        }}
      />

      {/* 批量删除助手会话模态框 */}
      <Modal
        title="批量删除助手会话"
        open={batchDeleteModalVisible}
        onCancel={() => { setBatchDeleteModalVisible(false); setSelectedSessionIds([]); setBatchAssistantId(null); }}
        footer={[
          <Button key="cancel" onClick={() => { setBatchDeleteModalVisible(false); setSelectedSessionIds([]); setBatchAssistantId(null); }}>
            取消
          </Button>,
          <Button
            key="toggleSelect"
            onClick={() => {
              if (!batchAssistantId) return;
              const allIds = assistantSessions.filter(s => s.assistant_id === batchAssistantId).map(s => s.id);
              const allSelected = allIds.length > 0 && allIds.every(id => selectedSessionIds.includes(id));
              setSelectedSessionIds(allSelected ? [] : allIds);
            }}
          >
            {(() => {
              if (!batchAssistantId) return '全选';
              const allIds = assistantSessions.filter(s => s.assistant_id === batchAssistantId).map(s => s.id);
              const allSelected = allIds.length > 0 && allIds.every(id => selectedSessionIds.includes(id));
              return allSelected ? '取消全选' : '全选';
            })()}
          </Button>,
          <Button key="deleteAllInModal" danger onClick={() => { if (batchAssistantId) handleDeleteAllSessionsForAssistant(batchAssistantId); }}>
            删除该助手全部会话
          </Button>,
          <Button key="delete" className={styles.deleteButton} type="primary" onClick={handleBatchDeleteSessions} disabled={selectedSessionIds.length === 0}>
            删除所选
          </Button>
        ]}
      >
        {batchAssistantId ? (
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {assistantSessions.filter(s => s.assistant_id === batchAssistantId).map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
                <Checkbox
                  checked={selectedSessionIds.includes(s.id)}
                  onChange={(e) => {
                    setSelectedSessionIds(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id));
                  }}
                >
                  {s.name || '未命名对话'}
                </Checkbox>
                <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>{(s.message_count || 0)} 条消息</span>
              </div>
            ))}
          </div>
        ) : (
          <div>暂无会话</div>
        )}
      </Modal>

      {/* 新增：批量删除传统会话模态框 */}
      <Modal
        title="批量删除传统会话"
        open={traditionalBatchModalVisible}
        onCancel={() => { setTraditionalBatchModalVisible(false); setSelectedTraditionalSessionIds([]); }}
        footer={[
          <Button key="cancel" onClick={() => { setTraditionalBatchModalVisible(false); setSelectedTraditionalSessionIds([]); }}>
            取消
          </Button>,
          <Button
            key="toggleSelect"
            onClick={() => {
              const allIds = sessions.map(s => s.session_id);
              const allSelected = allIds.length > 0 && allIds.every(id => selectedTraditionalSessionIds.includes(id));
              setSelectedTraditionalSessionIds(allSelected ? [] : allIds);
            }}
          >
            {(() => {
              const allIds = sessions.map(s => s.session_id);
              const allSelected = allIds.length > 0 && allIds.every(id => selectedTraditionalSessionIds.includes(id));
              return allSelected ? '取消全选' : '全选';
            })()}
          </Button>,
          <Button key="delete" className={styles.deleteButton} type="primary" onClick={handleBatchDeleteTraditionalSessions} disabled={selectedTraditionalSessionIds.length === 0}>
            删除所选
          </Button>
        ]}
      >
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          {sessions.map(s => (
            <div key={s.session_id} style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
              <Checkbox
                checked={selectedTraditionalSessionIds.includes(s.session_id)}
                onChange={(e) => {
                  setSelectedTraditionalSessionIds(prev => e.target.checked ? [...prev, s.session_id] : prev.filter(id => id !== s.session_id));
                }}
              >
                {s.name || '新对话'}
              </Checkbox>
              <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>{(s.message_count || 0)} 条消息</span>
            </div>
          ))}
        </div>
      </Modal>

      {renderOverlay()}
      {/* 移动端菜单按钮：只在移动端且侧边栏折叠时显示 */}
      {isMobile && !siderVisible && (
        <Button
          className={styles.mobileMenuButton}
          icon={<MenuOutlined />}
          onClick={toggleMobileSider}
        />
      )}

      {/* 左侧边栏 */}
      <Sider 
        width={300} 
        collapsedWidth={0}
        collapsed={isMobile ? !siderVisible : desktopSiderCollapsed}
        className={`${styles.sider} ${isMobile ? (siderVisible ? styles.siderVisible : '') : ''}`}
        theme="light"
      >
        <div className={styles.siderContent}>
          <Button 
            type="default"
            className={styles.newSessionButton}
            onClick={handleCreateSession} 
            style={{ marginBottom: 16, width: '100%' }}
            loading={isLoading}
          >
            新建会话
          </Button>
          
          <Collapse defaultActiveKey={['sessions']}>
              

              {/* 助手管理面板 */}
              <Panel 
                header={
                  <div className={styles.panelHeader}>
                    <RobotOutlined />
                    <span>RAGFlow对话</span>
                    <span 
                      style={{ 
                        marginLeft: '8px',
                        color: '#999',
                        fontSize: '14px',
                        fontWeight: 'normal'
                      }}
                    >
                      {assistants.length}
                    </span>
                  </div>
                } 
                key="assistants"
>
                <div className={styles.sessionList}>
                  {/* 将"知识库"按钮移动到智能助手展开栏顶部 */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <Tooltip title="RAG Flow 知识库管理">
                      <Button 
                        type="text" 
                        icon={<DatabaseOutlined />}
                        onClick={() => navigate('/ragflow')}
                        className={styles.headerButton}
                      >
                        知识库
                      </Button>
                    </Tooltip>
                  </div>
                  {/* 助手列表 */}
                  {assistants.map((assistant) => (
                    <div key={assistant.id} className={styles.assistantSection}>
                      <div
                        className={`${styles.assistantHeader} ${currentAssistant?.id === assistant.id ? styles.activeAssistant : ''}`}
                        onClick={() => {
                          // 如果点击的不是当前助手，需要特殊处理
                          if (currentAssistant?.id !== assistant.id) {
                            // 切换到新助手时，将之前的助手设为折叠状态
                            setCollapsedAssistantIds(prev => {
                              const next = new Set(prev);
                              // 如果有之前的助手，将其添加到折叠列表中
                              if (currentAssistant?.id) {
                                next.add(currentAssistant.id);
                              }
                              // 新助手从折叠列表中移除（即展开）
                              next.delete(assistant.id);
                              return next;
                            });
                          } else {
                            // 点击当前助手，只是切换折叠状态
                            setCollapsedAssistantIds(prev => {
                              const next = new Set(prev);
                              if (next.has(assistant.id)) {
                                next.delete(assistant.id);
                              } else {
                                next.add(assistant.id);
                              }
                              return next;
                            });
                          }
                          
                          setCurrentAssistant(assistant);
                          // 加载该助手的会话列表
                          loadAssistantSessions(assistant.id);
                        }}
                      >
                        <Button
                          type="text"
                          size="small"
                          style={{ marginRight: 4, pointerEvents: 'none' }}
                          icon={
                            <RightOutlined 
                              className={`${styles.assistantCollapseIcon} ${
                                collapsedAssistantIds.has(assistant.id) ? styles.collapsed : styles.expanded
                              }`}
                            />
                          }
                          aria-label={collapsedAssistantIds.has(assistant.id) ? '展开' : '折叠'}
                        />
                        <img 
                          src={assistant.avatar ? convertMinioUrlToHttp(assistant.avatar) : defaultModelAvatar} 
                          alt="助手头像" 
                          style={{ 
                            width: '24px', 
                            height: '24px', 
                            borderRadius: '50%',
                            objectFit: 'cover',
                            marginRight: 8
                          }} 
                        />
                        <div className={styles.assistantInfo}>
                          <Tooltip title={assistant.name} placement="top" mouseEnterDelay={1.5}>
                            <span className={styles.assistantName}>{assistant.name}</span>
                          </Tooltip>
                          <span className={styles.assistantDatasets}>
                            {assistant.dataset_ids?.length || 0} 个知识库
                          </span>
                        </div>
                        
                        {/* 新建对话图标按钮 */}
                        <Button
                          type="text"
                          icon={<PlusOutlined />}
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation(); // 阻止触发父元素的点击事件
                            createAssistantSession(assistant.id);
                          }}
                          className={styles.assistantCreateButton}
                          title="新建对话"
                        />
                        {/* 助手操作菜单 */}
                        <Dropdown overlay={getAssistantHeaderMenu(assistant)} trigger={["click"]} placement="bottomRight">
                          <Button
                            type="text"
                            icon={<MoreOutlined />}
                            size="small"
                            onClick={(e) => e.stopPropagation()}
                            className={styles.assistantCreateButton}
                          />
                        </Dropdown>
                      </div>
                      
                      {/* 该助手的会话列表 */}
                      {currentAssistant?.id === assistant.id && !collapsedAssistantIds.has(assistant.id) && (
                        <div className={styles.assistantSessions}>
                          {assistantSessions
                            .filter(session => session.assistant_id === assistant.id)
                            .map((session) => (
                            <div
                              key={session.id}
                              className={`${styles.sessionItem} ${styles.assistantSessionItem} ${currentAssistantSession?.id === session.id ? styles.activeSession : ''}`}
                              onClick={() => handleAssistantSessionChange(session)}
                            >
                              {/* 助手会话头像 */}
                              <img 
                                src={session.role_avatar_url ? convertMinioUrlToHttp(session.role_avatar_url) : (assistant.avatar ? convertMinioUrlToHttp(assistant.avatar) : defaultModelAvatar)} 
                                alt="角色头像" 
                                style={{ 
                                  width: '32px', 
                                  height: '32px', 
                                  borderRadius: '50%',
                                  objectFit: 'cover',
                                  marginRight: 8
                                }} 
                              />
                              <div className={styles.sessionInfo}>
                                                                 <Tooltip title={session.name || '新对话'} placement="top" mouseEnterDelay={1.5}>
                                  <span className={styles.sessionName}>{session.name || '新对话'}</span>
                                </Tooltip>
                                <span className={styles.messageCount}>
                                  {session.message_count || 0} 条消息
                                </span>
                              </div>
                              <Dropdown 
                                overlay={getAssistantSessionMenu(session)} 
                                trigger={['click']}
                                placement="bottomRight"
                              >
                                <Button
                                  type="text"
                                  icon={<MoreOutlined />}
                                  className={styles.sessionMenuButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // 在打开菜单前记录触发的会话，用于"修改背景图片"上传处理
                                    setBackgroundUploadTarget({ type: 'assistant', assistantId: assistant.id, sessionId: session.id });
                                  }}
                                />
                              </Dropdown>
                            </div>
                          ))}

                        </div>
                      )}
                    </div>
                  ))}
                  
                  {assistants.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: '#999' }}>
                      暂无智能助手
                      <br />
                      <Button 
                        type="link" 
                        onClick={() => navigate('/ragflow')}
                        style={{ padding: 0, marginTop: 8 }}
                      >
                        去创建助手
                      </Button>
                    </div>
                  )}
                </div>
              </Panel>

              {/* 会话管理面板 */}
              <Panel 
                header={
                  <div className={styles.panelHeader}>
                    <FileTextOutlined />
                    <span>角色列表</span>
                    <span 
                      style={{ 
                        marginLeft: '8px',
                        color: '#999',
                        fontSize: '14px',
                        fontWeight: 'normal'
                      }}
                    >
                      {sessions.length}
                    </span>
                  </div>
                }
                extra={
                  <div onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <Dropdown overlay={getTraditionalHeaderMenu()} trigger={["click"]} placement="bottomRight">
                      <Button
                        type="text"
                        icon={<MoreOutlined />}
                        size="small"
                        className={`${styles.headerButton} ${styles.traditionalHeaderButton}`}
                        title="更多操作"
                      />
                    </Dropdown>
                  </div>
                }
                key="sessions"
              >
                <div className={styles.sessionList}>
                  <div style={{ marginBottom: 16 }}>
                    {sessions.map((session) => (
                      <div
                        key={session.session_id}
                        className={`${styles.sessionItem} ${currentSession?.session_id === session.session_id ? styles.activeSession : ''}`}
                        onClick={() => handleSessionChange(session)}
                      >
                        <img 
                          src={session.role_avatar_url ? convertMinioUrlToHttp(session.role_avatar_url) : defaultModelAvatar} 
                          alt="角色头像" 
                          style={{ 
                            width: '32px', 
                            height: '32px', 
                            borderRadius: '50%',
                            objectFit: 'cover',
                            marginRight: 8
                          }} 
                        />
                        <div className={styles.sessionInfo}>
                                                     <Tooltip title={session.name} placement="top" mouseEnterDelay={1.5}>
                            <span className={styles.sessionName}>{session.name}</span>
                          </Tooltip>
                          <span className={styles.messageCount}>
                            {session.message_count || 0} 条消息
                          </span>
                        </div>
                        <Dropdown 
                          overlay={getSessionMenu(session)} 
                          trigger={['click']}
                          placement="bottomRight"
                        >
                          <Button
                            type="text"
                            icon={<MoreOutlined />}
                            className={styles.sessionMenuButton}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                          />
                        </Dropdown>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            </Collapse>
        </div>
      </Sider>

      {/* 主内容区域 */}
      <Layout className={styles.mainLayout} style={{ position: 'relative' }}>
        {enableChatBackground && backgroundImageUrl && (
                     <div
             style={{
               position: 'absolute',
               inset: 0,
               backgroundImage: `url(${backgroundImageUrl})`,
               backgroundSize: 'cover',
               backgroundPosition: 'center',
              //  filter: 'blur(1px) saturate(1.05) brightness(0.95)',
               filter: 'saturate(1.05) brightness(0.95)',
               // 轻微粉色甜系蒙版
               mixBlendMode: 'normal',
               zIndex: 0,
               pointerEvents: 'none'
             }}
           >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(255, 182, 193, 0)' // LightPink 透明蒙层
              }}
            />
          </div>
        )}
        {/* 添加电脑端折叠按钮 */}
        {!isMobile && (
          <Button
            type="text"
            icon={desktopSiderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggleDesktopSider}
            className={styles.desktopSiderToggle}
          />
        )}
        
        {/* 标题栏 */}
                <div className={styles.header}>
           <h1 className={styles.headerTitle}>
             {isAssistantMode && currentAssistantSession 
               ? `${currentAssistantSession.assistant_name} - ${currentAssistantSession.name}`
               : currentSession 
                 ? currentSession.name 
                 : 'Fish Chat'
             }
           </h1>
           <div className={styles.headerActions}>
             <Button
               type="text"
               icon={<SettingOutlined />}
               onClick={() => setSettingsModalVisible(true)}
               title="设置"
             />
           </div>
         </div>

        <div className={`${styles.chatContent} ${(enableChatBackground && backgroundImageUrl) ? styles.hasBg : ''}`} style={{ position: 'relative', zIndex: 1, background: (enableChatBackground && backgroundImageUrl) ? 'transparent' : undefined }}>
          {/* 音频播放器 - 使用CSS控制显示/隐藏 */}
          {enableVoice && (
            <div className={`${styles.audioPlayer} ${!showAudioPlayer ? styles.audioPlayerHidden : ''}`}>
              <audio
                ref={audioRef}
                controls
                preload="auto"
                src={audioUrl || undefined}
                onError={(e) => {
                  const error = e.currentTarget.error;
                  // 只有在URL不为空时才显示错误
                  if (audioUrl) {
                    console.error('[Chat] 音频加载失败:', {
                      code: error?.code,
                      message: error?.message,
                      url: audioUrl
                    });
                    message.error('音频加载失败');
                  }
                }}
                onCanPlay={() => {
                  console.log('[Chat] 音频已准备好播放');
                }}
                onPlay={() => {
                  console.log('[Chat] 音频开始播放');
                }}
                onEnded={() => {
                  console.log('[Chat] 音频播放完成');
                }}
              />
            </div>
          )}
          {/* 消息列表 */}
          <div className={styles.messageList} ref={messageListRef}>
            {messages.map((msg: ChatMessage, index) => (
              <div
                key={msg.timestamp ? `${msg.timestamp}-${msg.role}` : `idx-${index}-${msg.role}`}
                className={`${styles.messageContainer} ${
                  msg.role === 'user' ? styles.userMessageContainer : styles.assistantMessageContainer
                }`}
              >
                {/* 模型消息：左侧头像，右侧内容 */}
                {msg.role === 'assistant' && (
                  <>
                    <div className={styles.messageAvatar}>
                      <img 
                        src={
                          isAssistantMode
                            ? (currentAssistantSession?.role_avatar_url 
                                ? convertMinioUrlToHttp(currentAssistantSession.role_avatar_url)
                                : (currentAssistant?.avatar ? convertMinioUrlToHttp(currentAssistant.avatar) : defaultModelAvatar))
                            : (currentSession?.role_avatar_url 
                                ? convertMinioUrlToHttp(currentSession.role_avatar_url)
                                : defaultModelAvatar)
                        } 
                        alt="模型头像" 
                        className={styles.avatarImage}
                      />
                    </div>
                    <div className={styles.messageWrapper}>
                      <div className={`${styles.message} ${styles.assistantMessage}`}>
                <div className={styles.messageContent}>
                  {/* 图片预览 */}
                  {msg.images && msg.images.length > 0 && (
                    <div className={styles.messageImagePreview}>
                      {msg.images.map((imageUrl: string, imgIndex: number) => {
                        // 在传统模式下将MinIO URL转换为HTTP API URL，在助手模式下直接使用URL
                        const httpImageUrl = isAssistantMode ? imageUrl : convertMinioUrlToHttp(imageUrl);
                        return (
                          <div 
                            key={imgIndex} 
                            className={styles.messageImageThumbnail}
                            onClick={() => handleImageClick(httpImageUrl)}
                          >
                            <img src={httpImageUrl} alt={`图片 ${imgIndex + 1}`} loading="lazy" />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  
                  {/* 消息内容 */}
                  {renderMessageContent(msg.content, index, msg.timestamp, msg.reference)}
                  
                  {/* RAGFlow 文档引用列表 */}
                  {isAssistantMode && msg.reference && msg.reference.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ 
                        fontSize: '12px', 
                        color: 'rgba(255, 255, 255, 0.7)', 
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        <DatabaseOutlined style={{ marginRight: '4px' }} />
                        引用来源：
                      </div>
                      {renderDocumentReferences(msg.reference)}
                    </div>
                  )}
                        </div>
                        <div className={styles.messageButtons}>
                          <Button 
                            className={styles.messageCopyButton}
                            icon={<CopyOutlined />}
                            onClick={(e) => copyToClipboard(msg.content, e)}
                            type="text"
                            size="small"
                          />
                          <Button 
                            className={styles.messageEditButton}
                            icon={<EditOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditMessage(index, msg.content, msg.images);
                            }}
                            type="text"
                            size="small"
                          />
                          <Button 
                            className={styles.messageDeleteButton}
                            icon={<DeleteOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMessage(index, msg.content);
                            }}
                            type="text"
                            size="small"
                            danger
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
                
                {/* 用户消息：左侧内容，右侧头像 */}
                {msg.role === 'user' && (
                  <>
                    <div className={styles.messageAvatar}>
                      <img 
                        src={userAvatar ? convertMinioUrlToHttp(userAvatar) : defaultAvatar} 
                        alt="用户头像" 
                        className={styles.avatarImage}
                      />
                    </div>
                    <div className={styles.messageWrapper}>
                      <div className={`${styles.message} ${styles.userMessage}`}>
                        <div className={styles.messageContent}>
                          {/* 图片预览 */}
                          {msg.images && msg.images.length > 0 && (
                            <div className={styles.messageImagePreview}>
                              {msg.images.map((imageUrl: string, imgIndex: number) => {
                                // 在传统模式下将MinIO URL转换为HTTP API URL，在助手模式下直接使用URL
                                const httpImageUrl = isAssistantMode ? imageUrl : convertMinioUrlToHttp(imageUrl);
                                return (
                                  <div 
                                    key={imgIndex} 
                                    className={styles.messageImageThumbnail}
                                    onClick={() => handleImageClick(httpImageUrl)}
                                  >
                                    <img src={httpImageUrl} alt={`图片 ${imgIndex + 1}`} />
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          
                          <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                </div>
                <div className={styles.messageButtons}>
                  <Button 
                    className={styles.messageCopyButton}
                    icon={<CopyOutlined />}
                    onClick={(e) => copyToClipboard(msg.content, e)}
                    type="text"
                    size="small"
                  />
                  <Button 
                    className={styles.messageEditButton}
                    icon={<EditOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditMessage(index, msg.content, msg.images);
                    }}
                    type="text"
                    size="small"
                  />
                  <Button 
                    className={styles.messageDeleteButton}
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteMessage(index, msg.content);
                    }}
                    type="text"
                    size="small"
                    danger
                  />
                </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
            
            {/* 模型输入指示器 */}
            {isModelTyping && (
              <div className={`${styles.messageContainer} ${styles.assistantMessageContainer}`}>
                <div className={styles.messageAvatar}>
                  <img 
                    src={
                      isAssistantMode
                        ? (currentAssistantSession?.role_avatar_url 
                            ? convertMinioUrlToHttp(currentAssistantSession.role_avatar_url)
                            : (currentAssistant?.avatar ? convertMinioUrlToHttp(currentAssistant.avatar) : defaultModelAvatar))
                        : (currentSession?.role_avatar_url 
                            ? convertMinioUrlToHttp(currentSession.role_avatar_url)
                            : defaultModelAvatar)
                    } 
                    alt="模型头像" 
                    className={styles.avatarImage}
                  />
                </div>
                <div className={styles.messageWrapper}>
              <div className={`${styles.message} ${styles.assistantMessage} ${styles.typingIndicator}`}>
                <div className={styles.messageContent}>
                  <div className={styles.typingAnimation}>
                    <span className={styles.typingDot}></span>
                    <span className={styles.typingDot}></span>
                    <span className={styles.typingDot}></span>
                  </div>
                  <span className={styles.typingText}>正在输入中...</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} style={{ height: '1px' }} />
          </div>

          {/* 输入区域 */}
          <div className={styles.inputArea}>
            {/* 图片预览 */}
            {imagePreviews.length > 0 && (
              <div className={styles.imagePreviewWrapper}>
                <div 
                  className={styles.imagePreviewContainer}
                  onWheel={handleImagePreviewWheel}
                >
                  {imagePreviews.map((preview, index) => (
                    <div key={index} className={styles.imagePreview}>
                      <img 
                        src={preview} 
                        alt={`预览 ${index + 1}`}
                        onClick={() => handleImageClick(preview, true)}
                        style={{ cursor: 'pointer' }}
                        title="点击查看大图"
                      />
                      <button
                        className={styles.imageRemoveButton}
                        onClick={() => handleImageRemove(index)}
                        title="删除图片"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className={styles.imageRemoveAllButton}
                  onClick={handleImageRemoveAll}
                  title="删除所有图片"
                >
                  删除全部
                </button>
              </div>
            )}
            
            <div 
              className={styles.inputContainer}
              onClick={handleInputContainerClick}
            >
              <Input.TextArea
                ref={inputRef}
                value={currentMessage}
                onChange={handleMessageChange}
                onPaste={handlePaste}
                placeholder="输入消息..."
                autoSize={{ minRows: 1, maxRows: 8 }}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              
              <div className={styles.inputButtons}>
                {/* 图片上传按钮 - 仅对支持图片的模型显示 */}
                {currentSessionSupportsImage && (
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageSelect}
                    style={{ display: 'none' }}
                    id="image-upload"
                  />
                )}
                

                
                {currentSessionSupportsImage && (
                  <Button
                    type="text"
                    icon={<PictureOutlined />}
                    onClick={() => document.getElementById('image-upload')?.click()}
                    title="上传图片"
                    loading={isImageUploading}
                  />
                )}
                
                {sent_flag ? (
                  <Button 
                    type="primary" 
                    icon={<SendOutlined />}
                    onClick={() => sendMessage()}
                    loading={isProcessing}
                  >
                    发送
                  </Button>
                ) : (
                  <Dropdown 
                    overlay={toolsMenu} 
                    trigger={['click']}
                    placement="topRight"
                  >
                    <Button 
                      type="primary" 
                      icon={<AppstoreOutlined />}
                    >
                      功能
                    </Button>
                  </Dropdown>
                )}
              </div>
            </div>
          </div>
        </div>
      </Layout>

      {/* 设置模态框：承载原左侧四个面板 */}
      <Modal
        title="设置"
        open={settingsModalVisible}
        onCancel={() => setSettingsModalVisible(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Collapse defaultActiveKey={[]}>
          {/* 用户信息面板 */}
          <Panel 
            header={
              <div className={styles.panelHeader}>
                <UserOutlined />
                <span>用户信息</span>
              </div>
            } 
            key="userInfo"
          >
            <div className={styles.userInfo}>
              <div 
                className={styles.userAvatarSection}
                onClick={handleUserAvatarClick}
                style={{ cursor: 'pointer' }}
              >
                <img 
                  src={userAvatar ? convertMinioUrlToHttp(userAvatar) : defaultAvatar} 
                  alt="用户头像" 
                  className={styles.userAvatar}
                />
                <span className={styles.userName}>
                  {user?.account || '未登录'}
                </span>
              </div>
            </div>
          </Panel>

          {/* 系统设置面板 */}
          <Panel 
            header={
              <div className={styles.panelHeader}>
                <ApiOutlined />
                <span>系统设置</span>
              </div>
            }
            key="systemSettings"
          >
            <div className={styles.modelSettings}>
              {/* 主题切换移动到用户信息面板底部 */}
              <div style={{ marginTop: 12 }}>
                <ThemeToggle />
              </div>

              <div className={styles.settingItem}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PictureOutlined />
                  <span>对话背景</span>
                </div>
                <Switch
                  checked={enableChatBackground}
                  onChange={setEnableChatBackground}
                />
              </div>
            </div>
          </Panel>

          {/* 模型设置面板 */}
          <Panel 
            header={
              <div className={styles.panelHeader}>
                <RobotOutlined />
                <span>模型设置</span>
              </div>
            } 
            key="modelSettings"
          >
              {/* 模型选择 */}
              <div className={styles.settingItem}>
                <div className={styles.settingLabel}>
                  <RobotOutlined /> 选择模型
                </div>
                <Select 
                  value={modelService}
                  optionLabelProp="label"
                  className={styles.modelSelectWrapper}
                  onChange={async (value) => {
                    setModelService(value);
                    console.log('选择模型服务:', value);
                    
                    // 尝试从后端获取配置
                    const config = await getModelConfigFromServer(value);
                    console.log('获取到的配置:', config);
                    
                    // 同步更新modelSettings
                    setModelSettings(prev => {
                      let newApiKey = '';
                      
                      // 根据不同的模型服务处理API密钥
                      if (value === 'ollama') {
                        // Ollama使用占位符API key
                        newApiKey = 'ollama';
                      } else if (config?.apiKey) {
                        // 如果有查询到API密钥，则使用
                        newApiKey = config.apiKey;
                      } else {
                        // 其他情况清空API密钥
                        newApiKey = '';
                      }
                      
                      const newSettings = {
                        ...prev,
                        modelService: value,
                        baseUrl: config?.baseUrl || getDefaultBaseUrl(value),
                        apiKey: newApiKey,
                        // 重置模型名称为新服务的第一个选项
                        modelName: getModelNameOptions(value)[0]?.value || prev.modelName
                      };
                      console.log('更新后的设置:', newSettings);
                      return newSettings;
                    });
                  }}
                  style={{ width: '100%' }}
                  dropdownStyle={{ zIndex: 1000 }}
                >
                  {MODEL_SERVICES.map(option => (
                    <Option key={option.value} value={option.value} label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img 
                          src={option.logo} 
                          alt={option.label} 
                          style={{ width: '16px', height: '16px', objectFit: 'contain' }}
                        />
                        <span>{option.label}</span>
                      </div>
                    }>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img 
                          src={option.logo} 
                          alt={option.label} 
                          style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                        />
                        <span>{option.label}</span>
                      </div>
                    </Option>
                  ))}
                </Select>
              </div>

              {/* API设置 */}
              <div className={styles.settingItem}>
                <div className={styles.settingLabel}>
                  <ApiOutlined /> 服务地址
                </div>
                <Input 
                  value={modelSettings.baseUrl}
                  onChange={(e) => setModelSettings({...modelSettings, baseUrl: e.target.value})}
                  placeholder="输入服务地址"
                />
              </div>

                <div className={styles.settingItem}>
                  <div className={styles.settingLabel}>
                    <ApiOutlined /> API密钥
                  </div>
                  {modelService === 'ollama' ? (
                    <Input
                      value={modelSettings.apiKey}
                      disabled
                      style={{ color: '#999' }}
                      placeholder="Ollama使用占位符API key"
                    />
                  ) : (
                    <Input.Password
                      value={modelSettings.apiKey}
                      onChange={(e) => setModelSettings({...modelSettings, apiKey: e.target.value})}
                      placeholder="输入API密钥"
                    />
                  )}
                </div>

              <div className={styles.settingItem}>
                <div className={styles.settingLabel}>
                  <GlobalOutlined /> 模型名称
                </div>
                <Select 
                  value={modelSettings.modelName}
                  onChange={(value) => setModelSettings({...modelSettings, modelName: value})}
                  style={{ width: '100%' }}
                  onDropdownVisibleChange={async (open) => {
                    if (open && modelService === 'ollama') {
                      await fetchOllamaModels(modelSettings.baseUrl || getDefaultBaseUrl('ollama'));
                    }
                  }}
                  notFoundContent={modelService === 'ollama' && isLoadingOllamaModels ? '加载中...' : undefined}
                >
                  {modelService === 'ollama' ? (
                    ollamaModels.map(option => (
                      <Option key={option.value} value={option.value}>
                        <span className={styles.modelOption}>
                          {('imageLabel' in option && (option as any).imageLabel) && (
                            <span className={styles.modelImageLabel}>{(option as any).imageLabel}</span>
                          )}
                          {option.label}
                        </span>
                      </Option>
                    ))
                  ) : (
                    getModelNameOptions(modelService).map(option => (
                      <Option key={option.value} value={option.value}>
                        <span className={styles.modelOption}>
                          {('imageLabel' in option && (option as any).imageLabel) && (
                            <span className={styles.modelImageLabel}>{(option as any).imageLabel}</span>
                          )}
                          {option.label}
                        </span>
                      </Option>
                    ))
                  )}
                </Select>
              </div>

            <div className={styles.settingItem}>
              <Button 
                type="primary" 
                onClick={() => setSystemPromptModalVisible(true)}
                className={styles.systemPromptButton}
                style={{ width: '100%', marginTop: '10px' }}
              >
                设置System Prompt
              </Button>
              </div>
          </Panel>

          {/* 语音配置面板 */}
          <Panel 
            header={
              <div className={styles.panelHeader}>
                <AudioOutlined />
                <span>语音配置</span>
              </div>
            } 
            key="voiceSettings"
          >
            <div className={styles.settingItem}>
              <div className={styles.settingLabel}>
                <SoundOutlined /> 语音播放
              </div>
              <Switch 
                checked={enableVoice}
                onChange={setEnableVoice}
              />
            </div>

        <div className={styles.settingItem}>
          <div className={styles.settingLabel}>
            <EditOutlined /> 文本清洗
            <Tooltip title="清洗掉括号内容、特殊标记等，但保留引号内容">
              <QuestionCircleOutlined style={{ marginLeft: 4 }} />
            </Tooltip>
          </div>
          <Switch 
            checked={enableTextCleaning}
            onChange={setEnableTextCleaning}
          />
        </div>

            <div className={styles.settingItem}>
              <div className={styles.settingLabel}>
                <AudioOutlined /> 显示播放器
              </div>
              <Switch 
                checked={showAudioPlayer}
                onChange={setShowAudioPlayer}
              />
            </div>
          </Panel>
        </Collapse>
      </Modal>

      {/* System Prompt设置模态框 */}
      {renderSystemPromptModal()}

      {/* 角色信息模态框 */}
      <Modal
        title="角色信息设置"
        open={roleInfoModalVisible}
        onCancel={() => {
          setRoleInfoModalVisible(false);
          setNewSessionName('');
          setEditingSession(null);
          setEditingAssistantSession(null);
          setRoleAvatar('');
        }}
        footer={[
          <Button key="cancel" onClick={() => {
            setRoleInfoModalVisible(false);
            setNewSessionName('');
            setEditingSession(null);
            setEditingAssistantSession(null);
            setRoleAvatar('');
          }}>
            取消
          </Button>,
          <Button 
            key="save" 
            type="primary" 
            onClick={handleRoleInfoSave}
            loading={isUploadingRoleAvatar}
          >
            保存
          </Button>
        ]}
        width={500}
        centered
        destroyOnClose
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ marginBottom: '20px' }}>
            <Upload
              name="roleAvatar"
              listType="picture-card"
              className="avatar-uploader"
              showUploadList={false}
              beforeUpload={handleRoleAvatarUpload}
              accept="image/*"
            >
              <img 
                src={roleAvatar ? convertMinioUrlToHttp(roleAvatar) : defaultModelAvatar} 
                alt="角色头像" 
                style={{ 
                  width: '100px', 
                  height: '100px', 
                  borderRadius: '50%', 
                  objectFit: 'cover', 
                  cursor: 'pointer'
                }} 
              />
            </Upload>
          </div>
          <div style={{ marginBottom: '20px' }}>
        <Input
          value={newSessionName}
          onChange={(e) => setNewSessionName(e.target.value)}
              placeholder="请输入会话名称"
              style={{ marginTop: 16 }}
        />
          </div>
          <div style={{ textAlign: 'center', marginBottom: '12px' }}>
            <Button
              icon={<PictureOutlined />}
              onClick={() => hiddenBgInputRef.current?.click()}
            >
              修改背景图片
            </Button>
          </div>
          <p style={{ color: '#666', fontSize: '14px' }}>
            点击头像上传，支持 JPG、PNG 格式，文件大小不超过 5MB
          </p>
        </div>
      </Modal>
      {renderConfigModal()} {/* 添加配置修改模态框 */}
      {renderTtsProviderModal()} {/* TTS服务商选择模态框 */}
      {renderTtsConfigModal()} {/* TTS配置模态框 */}

      {/* 知识库配置模态框 */}
      <Modal
        title="配置知识库"
        open={kbConfigModalVisible}
        onOk={handleSaveKbConfig}
        onCancel={() => { setKbConfigModalVisible(false); setKbEditingSession(null); }}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <div className={styles.configForm}>
          <div style={{ marginBottom: 8 }}>
            {!!kbEditingSession && (kbEditingSession as any).kb_parsed ? (
              <Tag color="green">已解析：{(kbEditingSession as any).kb_settings?.collection_name || '已解析'}</Tag>
            ) : (
              <Tag color="default">未解析</Tag>
            )}
          </div>
          <div className={styles.formItem}>
            <div className={styles.formLabel}>
              启用知识库
            </div>
            <Switch
              checked={!!kbConfig.enabled}
              onChange={(v) => setKbConfig((prev: any) => ({ ...prev, enabled: v }))}
            />
          </div>

          <div className={styles.formItem}>
            <div className={styles.formLabel}>知识库提示词（使用 {`{knowledge}`} 占位符）</div>
            <Input.TextArea
              value={kbConfig.kb_prompt_template}
              onChange={(e) => setKbConfig((prev: any) => ({ ...prev, kb_prompt_template: e.target.value }))}
              rows={6}
              placeholder={`在此编写完整提示词，包含 {knowledge} 以插入检索内容。\n首次默认填入当前会话的原始提示词，您可以在合适位置加入 {knowledge}。`}
            />
          </div>

          <div className={styles.formItem}>
            <div className={styles.formLabel}>向量数据库</div>
            <Select
              value={kbConfig.vector_db}
              onChange={(v) => setKbConfig((prev: any) => ({ ...prev, vector_db: v }))}
              style={{ width: '100%' }}
            >
              <Option value="chroma">ChromaDB</Option>
            </Select>
          </div>

          <div className={styles.formItem}>
            <div className={styles.formLabel}>知识库名称</div>
            <Input
              value={kbConfig.collection_name}
              onChange={(e) => setKbConfig((prev: any) => ({ ...prev, collection_name: e.target.value }))}
              placeholder="请输入知识库名称（collection）"
            />
          </div>

          <div className={styles.formItem}>
            <div className={styles.formLabel}>嵌入模型 - 厂商</div>
            <Select
              value={kbConfig.embeddings?.provider}
              onChange={handleKbProviderChange}
              style={{ width: '100%' }}
            >
              <Option value="ollama">Ollama</Option>
              <Option value="local">本地</Option>
              <Option value="ark">火山引擎</Option>
            </Select>
          </div>

          {kbConfig.embeddings?.provider === 'ollama' && (
            <>
              <div className={styles.formItem}>
                <div className={styles.formLabel}>Ollama 服务地址</div>
                <Input
                  value={kbConfig.embeddings?.base_url || ''}
                  onChange={(e) => setKbConfig((prev: any) => ({ ...prev, embeddings: { ...prev.embeddings, base_url: e.target.value } }))}
                  placeholder="http://localhost:11434"
                  onBlur={(e) => {
                    const normalized = ensureHttpProtocol(e.target.value || '');
                    if (normalized !== (kbConfig.embeddings?.base_url || '')) {
                      setKbConfig((prev: any) => ({ ...prev, embeddings: { ...prev.embeddings, base_url: normalized } }));
                    }
                  }}
                />
              </div>
              <div className={styles.formItem}>
                <div className={styles.formLabel}>Ollama 模型</div>
                <Select
                  value={kbConfig.embeddings?.model || ''}
                  onChange={(v) => setKbConfig((prev: any) => ({ ...prev, embeddings: { ...prev.embeddings, model: v } }))}
                  style={{ width: '100%' }}
                  onDropdownVisibleChange={async (open) => {
                    if (open) {
                      await fetchOllamaModels(kbConfig.embeddings?.base_url || getDefaultBaseUrl('ollama'));
                      setKbOllamaModels(ollamaModels);
                    }
                  }}
                  notFoundContent={isLoadingOllamaModels ? '加载中...' : undefined}
                >
                  {kbOllamaModels.map((m) => (
                    <Option key={m.value} value={m.value}>{m.label}</Option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {kbConfig.embeddings?.provider === 'local' && (
            <>
              <div className={styles.formItem}>
                <div className={styles.formLabel}>本地模型</div>
                <Select value={kbConfig.embeddings?.model || 'all-MiniLM-L6-v2'} onChange={(v) => setKbConfig((prev: any) => ({ ...prev, embeddings: { ...prev.embeddings, model: v } }))} style={{ width: '100%' }}>
                  <Option value="all-MiniLM-L6-v2">all-MiniLM-L6-v2</Option>
                </Select>
              </div>
              <div className={styles.formItem}>
                <div className={styles.formLabel}>本地模型路径</div>
                <Input
                  value={kbConfig.embeddings?.local_model_path || 'backend/models/all-MiniLM-L6-v2'}
                  onChange={(e) => setKbConfig((prev: any) => ({ ...prev, embeddings: { ...prev.embeddings, local_model_path: e.target.value } }))}
                  placeholder="backend/models/all-MiniLM-L6-v2"
                />
              </div>
            </>
          )}

          {kbConfig.embeddings?.provider === 'ark' && (
            <>
              <div className={styles.formItem}>
                <div className={styles.formLabel}>火山引擎模型</div>
                <Select value={kbConfig.embeddings?.model || 'doubao-embedding-large-text-250515'} onChange={(v) => setKbConfig((prev: any) => ({ ...prev, embeddings: { ...prev.embeddings, model: v } }))} style={{ width: '100%' }}>
                  <Option value="doubao-embedding-large-text-250515">doubao-embedding-large-text-250515</Option>
                </Select>
              </div>
              <div className={styles.formItem}>
                <div className={styles.formLabel}>API Key</div>
                <Input.Password
                  value={kbConfig.embeddings?.api_key || ''}
                  onChange={(e) => setKbConfig((prev: any) => ({ ...prev, embeddings: { ...prev.embeddings, api_key: e.target.value } }))}
                  placeholder="请输入火山引擎 API Key"
                />
              </div>
            </>
          )}

          <Collapse ghost>
            <Panel header="分片设置（可选）" key="split-params">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className={styles.formItem}>
                  <div className={styles.formLabel}>chunk_size</div>
                  <InputNumber min={100} max={4000} step={50} style={{ width: '100%' }} value={kbConfig.split_params?.chunk_size} onChange={(v) => setKbConfig((prev: any) => ({ ...prev, split_params: { ...prev.split_params, chunk_size: v } }))} />
                </div>
                <div className={styles.formItem}>
                  <div className={styles.formLabel}>chunk_overlap</div>
                  <InputNumber min={0} max={2000} step={10} style={{ width: '100%' }} value={kbConfig.split_params?.chunk_overlap} onChange={(v) => setKbConfig((prev: any) => ({ ...prev, split_params: { ...prev.split_params, chunk_overlap: v } }))} />
                </div>
                <div className={styles.formItem} style={{ gridColumn: '1 / span 2' }}>
                  <div className={styles.formLabel}>分隔符（逗号分隔）</div>
                  <Input
                    value={(kbConfig.split_params?.separators || []).join(',')}
                    onChange={(e) => setKbConfig((prev: any) => ({ ...prev, split_params: { ...prev.split_params, separators: e.target.value.split(',').map(s => s) } }))}
                    placeholder="例如：\n\n,\n,。,！,？,，, ,"
                  />
                </div>
              </div>
            </Panel>
          </Collapse>

          {/* 文件上传与解析 */}
          <div className={styles.formItem}>
            <div className={styles.formLabel}>文档文件</div>
            <div>
              <input type="file" style={{ display: 'none' }} ref={kbFileInputRef} onChange={handleKbFileChange} />
              <Button onClick={() => kbFileInputRef.current?.click()}>选择文件</Button>
              <span style={{ marginLeft: 8 }}>{kbSelectedFile?.name}</span>
              <Button type="primary" style={{ marginLeft: 12 }} loading={kbParsing} onClick={handleKbParseFile}>解析并入库</Button>
            </div>
          </div>
        </div>
      </Modal>
      
      {/* 用户头像模态框 */}
      <Modal
                title="用户账号设置"
        open={userAvatarModalVisible}
        onCancel={handleUserAvatarModalClose}
        footer={[
            <Button key="cancel" onClick={handleUserAvatarModalClose}>
            取消
          </Button>,
          <Button key="logout" danger onClick={handleLogout}>
            退出登录
          </Button>,
          <Button key="delete-account" danger type="primary" onClick={handleDeleteAccount} loading={deletingAccount}>
            注销账号
          </Button>,
          <Button 
            key="save" 
            type="primary" 
            onClick={handleAvatarSave}
            loading={isUploadingAvatar}
          >
            保存
          </Button>
        ]}
        width={500}
        centered
        destroyOnClose
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ marginBottom: '20px' }}>
            <Upload
              name="avatar"
              listType="picture-card"
              className="avatar-uploader"
              showUploadList={false}
              beforeUpload={handleAvatarUpload}
              accept="image/*"
            >
              <img 
                src={userAvatar ? convertMinioUrlToHttp(userAvatar) : defaultAvatar} 
                alt="当前头像" 
                style={{ 
                  width: '100px', 
                  height: '100px', 
                  borderRadius: '50%', 
                  objectFit: 'cover', 
                  cursor: 'pointer'
                }} 
              />
            </Upload>
          </div>
          <p style={{ color: '#666', fontSize: '14px' }}>
            点击头像上传，支持 JPG、PNG 格式，文件大小不超过 5MB
          </p>
        </div>
      </Modal>
      
      {/* 注销账号确认与逻辑 */}
      
      {/* 增强的图片预览模态框 */}
      <Modal
        open={imageModalVisible}
        onCancel={handleImageModalClose}
        footer={null}
        width="80%"
        centered
        destroyOnClose
        closable={false}
        styles={{
          body: { padding: 0 },
          content: { 
            padding: 0, 
            background: 'rgba(0, 0, 0, 0.95)',
            border: 'none',
            borderRadius: 8,
            overflow: 'hidden'
          }
        }}
      >
        <div className={styles.enhancedImageModal}>
          {/* 顶部工具栏 */}
          <div className={styles.imageModalToolbar}>
            <div className={styles.imageModalTitle}>
              <span className={styles.buttonTextDesktop}>
                图片预览 {imageScale !== initialFitScale && `(${Math.round((imageScale / initialFitScale) * 100)}%)`}
              </span>
              <span className={styles.buttonTextMobile}>
                预览 {imageScale !== initialFitScale && `${Math.round((imageScale / initialFitScale) * 100)}%`}
              </span>
            </div>
            <div className={styles.imageModalControls}>
              <Button 
                type="text" 
                icon={<ZoomOutOutlined />} 
                onClick={handleImageZoomOut}
                className={styles.imageModalButton}
                title="缩小"
              />
              <Button 
                type="text" 
                icon={<ZoomInOutlined />} 
                onClick={handleImageZoomIn}
                className={styles.imageModalButton}
                title="放大"
              />
              <Button 
                type="text" 
                onClick={handleImageFitToWindow}
                className={styles.imageModalButton}
                title="适合窗口"
              >
                <span className={styles.buttonTextDesktop}>适配</span>
                <span className={styles.buttonTextMobile}>适配</span>
              </Button>
              {isViewingPendingImage && (
                <Button 
                  type="text" 
                  icon={<CompressOutlined />} 
                  onClick={handleImageCompress}
                  className={styles.imageModalButton}
                  title="压缩图片"
                >
                  <span className={styles.buttonTextDesktop}>压缩</span>
                  <span className={styles.buttonTextMobile}>压缩</span>
                </Button>
              )}
              <Button 
                type="text" 
                icon={<DownloadOutlined />} 
                onClick={handleImageDownload}
                className={styles.imageModalButton}
                title="下载图片"
              />
              <Button 
                type="text" 
                icon={<CloseOutlined />} 
                onClick={handleImageModalClose}
                className={styles.imageModalButton}
                title="关闭"
              />
            </div>
          </div>

          {/* 图片容器 */}
          <div 
            className={styles.imageModalContainer}
            onMouseMove={handleImageMouseMove}
            onMouseUp={handleImageMouseUp}
            onMouseLeave={handleImageMouseUp}
            onWheel={handleImageWheel}
          >
                      <img 
              src={selectedImage} 
              alt="预览图片" 
              className={styles.imageModalImage}
              style={{
                transform: `scale(${imageScale}) translate(${imagePosition.x}px, ${imagePosition.y}px)`,
                cursor: imageScale > initialFitScale ? (isDragging ? 'grabbing' : 'grab') : 'default',
                visibility: imageNaturalSize.width > 0 ? 'visible' : 'hidden'
              }}
              onMouseDown={handleImageMouseDown}
              onLoad={handleImageLoad}
              onError={(e) => {
                console.error('图片加载失败:', e);
                message.error('图片加载失败');
              }}
              draggable={false}
            />
          </div>

          {/* 底部提示 */}
          <div className={styles.imageModalHint}>
            <span>鼠标滚轮缩放 • 拖拽移动 • ESC键关闭</span>
          </div>
        </div>
      </Modal>

      {/* 删除消息确认对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
            <span>删除消息</span>
          </div>
        }
        open={deleteMessageModalVisible}
        onOk={confirmDeleteMessage}
        onCancel={() => {
          setDeleteMessageModalVisible(false);
          setMessageToDelete(null);
        }}
        okText="确定删除"
        cancelText="取消"
        okButtonProps={{ className: styles.deleteButton }}
      >
        <p>确定要删除这条消息吗？</p>
        {messageToDelete && (
          <div className={styles.modalPreviewArea}>
            <p className={styles.modalPreviewText}>
              {messageToDelete.content.length > 100 
                ? `${messageToDelete.content.substring(0, 100)}...` 
                : messageToDelete.content
              }
            </p>
          </div>
        )}
        <p className={styles.modalWarningText}>
          删除后无法恢复，请谨慎操作。
        </p>
      </Modal>

      {/* 修改消息对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <EditOutlined style={{ color: '#1890ff' }} />
            <span>修改消息</span>
          </div>
        }
        open={editMessageModalVisible}
        onOk={confirmEditMessage}
        onCancel={() => {
          setEditMessageModalVisible(false);
          setMessageToEdit(null);
          setEditedContent('');
          setEditedImages([]);
        }}
        okText="确定修改"
        cancelText="取消"
        width={isMobile ? '95vw' : 800}
        bodyStyle={{
          maxHeight: isMobile ? '70vh' : '80vh',
          overflowY: 'auto',
          padding: isMobile ? '16px 12px' : '24px'
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setEditMessageModalVisible(false);
              setMessageToEdit(null);
              setEditedContent('');
              setEditedImages([]);
            }}
          >
            取消
          </Button>,
          (messageToEdit && messages[messageToEdit.index] && messages[messageToEdit.index].role === 'user') ? (
            <Button key="resend" type="dashed" danger onClick={handleResendFromMessage}>
              重新发送
            </Button>
          ) : null,
          <Button key="ok" type="primary" onClick={confirmEditMessage}>
            确定修改
          </Button>
        ]}
      >
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            消息内容：
          </label>
          <Input.TextArea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            placeholder="请输入消息内容..."
            autoSize={{
              minRows: isMobile ? 4 : 6,
              maxRows: isMobile ? 15 : 20
            }}
            maxLength={10000}
            showCount
            style={{
              fontSize: isMobile ? '16px' : '14px',
              lineHeight: '1.6',
              borderRadius: '8px',
              resize: 'none'
            }}
          />
        </div>

        {editedImages.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              消息图片：
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {editedImages.map((imageUrl, index) => {
                const httpImageUrl = isAssistantMode ? imageUrl : convertMinioUrlToHttp(imageUrl);
                return (
                  <div
                    key={index}
                    style={{
                      position: 'relative',
                      width: '80px',
                      height: '80px',
                      border: '1px solid #d9d9d9',
                      borderRadius: '6px',
                      overflow: 'hidden'
                    }}
                  >
                    <img
                      src={httpImageUrl}
                      alt={`图片 ${index + 1}`}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<CloseOutlined />}
                      onClick={() => handleRemoveImageFromEdit(imageUrl)}
                      style={{
                        position: 'absolute',
                        top: '2px',
                        right: '2px',
                        width: '20px',
                        height: '20px',
                        padding: '0',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        color: 'white',
                        border: 'none'
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <p style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>
              点击图片右上角的 × 可以删除图片
            </p>
          </div>
        )}
      </Modal>

      {/* 导出对话数据确认对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileTextOutlined style={{ color: '#1890ff' }} />
            <span>导出对话数据</span>
          </div>
        }
        open={exportChatModalVisible}
        onOk={confirmExportChat}
        onCancel={() => {
          setExportChatModalVisible(false);
          setExportingSession(null);
          setExportFileName('');
          setExportFormat('txt');
          setExportIncludeTimestamps(true);
          setExportIncludeSystemPrompts(true);
        }}
        okText="确定导出"
        cancelText="取消"
        okButtonProps={{ type: 'primary' }}
      >
        <p>确定要导出这个会话的对话数据吗？</p>
        {exportingSession && (
          <div className={styles.modalPreviewArea}>
            <p className={styles.modalPreviewText}>
              会话名称: {exportingSession.name}
            </p>
            <p className={styles.modalPreviewText}>
              消息数量: {exportingSession.message_count || 0}
            </p>
          </div>
        )}
        <div style={{ marginTop: '15px' }}>
          <p style={{ marginBottom: '8px', fontSize: '14px' }}>文件名:</p>
          <Input
            value={exportFileName}
            onChange={(e) => setExportFileName(e.target.value)}
            placeholder="请输入文件名（不包含扩展名）"
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginTop: '15px' }}>
          <p style={{ marginBottom: '8px', fontSize: '14px' }}>导出格式:</p>
          <Select
            value={exportFormat}
            onChange={(v) => setExportFormat(v as 'txt' | 'json')}
            style={{ width: '100%' }}
            options={[
              { label: '纯文本（.txt）', value: 'txt' },
              { label: '结构化 JSON（.json）', value: 'json' }
            ]}
          />
        </div>
        {exportFormat === 'json' && (
          <div style={{ marginTop: '15px' }}>
            <Checkbox
              checked={exportIncludeTimestamps}
              onChange={(e) => setExportIncludeTimestamps(e.target.checked)}
              style={{ display: 'block', marginBottom: '8px' }}
            >
              包含对话时间字段（将转换为您的本地时区）
            </Checkbox>
            <Checkbox
              checked={exportIncludeSystemPrompts}
              onChange={(e) => setExportIncludeSystemPrompts(e.target.checked)}
              style={{ display: 'block' }}
            >
              包含系统提示词（原始 SYSTEM_PROMPT 与当前知识库提示词）
            </Checkbox>
          </div>
        )}
        <p style={{ color: '#999', fontSize: '12px', marginTop: '10px' }}>
          导出的文件将包含完整的对话历史记录。
        </p>
      </Modal>

      {/* 用户头像裁剪组件 */}
      <AvatarCropper
        visible={userAvatarCropperVisible}
        imageUrl={tempAvatarUrl}
        onCancel={handleUserAvatarCropCancel}
        onConfirm={handleUserAvatarCropConfirm}
      />

      {/* 角色头像裁剪组件 */}
      <AvatarCropper
        visible={roleAvatarCropperVisible}
        imageUrl={tempAvatarUrl}
        onCancel={handleRoleAvatarCropCancel}
        onConfirm={handleRoleAvatarCropConfirm}
      />
      {/* 助手头像裁剪组件 */}
      <AvatarCropper
        visible={assistantAvatarCropperVisible}
        imageUrl={tempAvatarUrl}
        onCancel={handleAssistantAvatarCropCancel}
        onConfirm={handleAssistantAvatarCropConfirm}
      />

      {/* 图片压缩组件 */}
      <ImageCompressor
        visible={compressorModalVisible}
        images={selectedImages}
        imagePreviews={imagePreviews}
        onCancel={handleCompressorCancel}
        onConfirm={handleCompressorConfirm}
      />

    </Layout>
  );
};

export default Chat; 