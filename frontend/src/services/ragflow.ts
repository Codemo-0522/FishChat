import type { 
  Dataset, 
  Document, 
  Chunk, 
  ChatAssistant,
  CreateDatasetParams,
  UpdateDatasetParams,
  UploadDocumentParams,
  RetrieveParams,
  RAGFlowConfig,
  Session,
  Message
} from '../types/ragflow';
import { API_BASE_URL } from '../config';
import { useAuthStore } from '../stores/authStore';

class RAGFlowService {
  private config: RAGFlowConfig | null = null;

  // 设置配置
  setConfig(config: RAGFlowConfig) {
    this.config = config;
  }

  // 获取配置
  getConfig(): RAGFlowConfig | null {
    return this.config;
  }

  // 通用请求方法 - 现在通过后端代理
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    console.log('=== [RAGFlowService] HTTP请求开始 ===');
    
    // 使用后端API而不是直接调用RAGFlow
    const url = `${API_BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    // 添加认证头部
    const token = useAuthStore.getState().token;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 如果有FormData，移除Content-Type让浏览器自动设置
    if (options.body instanceof FormData) {
      delete (headers as any)['Content-Type'];
      console.log('[RAGFlowService] 检测到FormData，移除Content-Type头');
    }

    console.log('[RAGFlowService] 请求参数:', {
      url,
      method: options.method || 'GET',
      headers,
      bodyType: options.body ? options.body.constructor.name : 'none',
      bodySize: options.body instanceof FormData ? 'FormData' : 
                options.body ? (options.body as any).length || 'unknown' : 'none'
    });

    try {
      console.log('[RAGFlowService] 发送fetch请求...');
    const response = await fetch(url, {
      ...options,
      headers,
    });

      console.log('[RAGFlowService] 收到响应:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        url: response.url
      });

    if (!response.ok) {
        console.error('[RAGFlowService] 响应状态不正常:', response.status, response.statusText);
        let errorData;
        try {
          errorData = await response.json();
          console.error('[RAGFlowService] 错误响应数据:', errorData);
        } catch (e) {
          console.error('[RAGFlowService] 无法解析错误响应为JSON:', e);
          errorData = {};
        }
      throw new Error(errorData.detail || errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }

      let data;
      try {
        data = await response.json();
        console.log('[RAGFlowService] 成功解析响应数据:', data);
      } catch (e) {
        console.error('[RAGFlowService] 响应JSON解析失败:', e);
        throw new Error('响应数据格式错误');
      }

      console.log('=== [RAGFlowService] HTTP请求成功完成 ===');
    return data;
    } catch (error) {
      console.error('=== [RAGFlowService] HTTP请求失败 ===');
      console.error('[RAGFlowService] 请求错误:', {
        error,
        message: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  // 测试连接
  async testConnection(): Promise<boolean> {
    try {
      if (!this.config) {
        throw new Error('RAG Flow 配置未设置');
      }
      
      const result = await this.request<{success: boolean}>('/api/v1/ragflow/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl: this.config.baseUrl,
          apiKey: this.config.apiKey
        })
      });
      return result.success;
    } catch (error) {
      console.error('RAGFlow connection test failed:', error);
      return false;
    }
  }

  // 知识库管理 API
  async createDataset(params: CreateDatasetParams): Promise<Dataset> {
    return this.request<Dataset>('/api/v1/ragflow/datasets', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async listDatasets(params?: {
    page?: number;
    page_size?: number;
    orderby?: string;
    desc?: boolean;
    id?: string;
    name?: string;
  }): Promise<Dataset[]> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, value.toString());
        }
      });
    }

    return this.request<Dataset[]>(`/api/v1/ragflow/datasets?${searchParams}`);
  }

  async updateDataset(datasetId: string, params: UpdateDatasetParams): Promise<void> {
    return this.request<void>(`/api/v1/ragflow/datasets/${datasetId}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  async deleteDatasets(ids?: string[]): Promise<void> {
    return this.request<void>('/api/v1/ragflow/datasets', {
      method: 'DELETE',
      body: JSON.stringify(ids || []),
    });
  }

  async getDataset(datasetId: string): Promise<Dataset> {
    return this.request<Dataset>(`/api/v1/ragflow/datasets/${datasetId}`);
  }

  // 文档管理 API
  async uploadDocument(datasetId: string, params: UploadDocumentParams): Promise<Document> {
    const formData = new FormData();
    formData.append('files', params.blob, params.display_name);

    return this.request<Document>(`/api/v1/ragflow/datasets/${datasetId}/documents/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        // 不设置Content-Type，让浏览器自动设置multipart/form-data边界
      },
    });
  }

  async listDocuments(datasetId: string, params?: {
    page?: number;
    page_size?: number;
    orderby?: string;
    desc?: boolean;
    keywords?: string;
  }): Promise<{docs: Document[], total: number}> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, value.toString());
        }
      });
    }

    return this.request<{docs: Document[], total: number}>(`/api/v1/ragflow/datasets/${datasetId}/documents?${searchParams}`);
  }

  // 上传文档
  async uploadDocuments(datasetId: string, documents: UploadDocumentParams[]): Promise<any> {
    console.log('=== [RAGFlowService] 上传文档API调用开始 ===');
    console.log('[RAGFlowService] 参数验证:', {
      datasetId,
      datasetIdType: typeof datasetId,
      datasetIdEmpty: !datasetId,
      documentCount: documents.length,
      documentsIsArray: Array.isArray(documents)
    });
    
    if (!datasetId) {
      console.error('[RAGFlowService] datasetId 为空或未定义');
      throw new Error('数据集ID不能为空');
    }
    
    if (!Array.isArray(documents) || documents.length === 0) {
      console.error('[RAGFlowService] documents 参数无效:', documents);
      throw new Error('文档列表不能为空');
    }
    
    console.log('[RAGFlowService] 文档详情:', documents.map((doc, index) => ({
      index: index + 1,
      display_name: doc.display_name,
      blobType: Object.prototype.toString.call(doc.blob),
      blobSize: doc.blob instanceof File ? doc.blob.size : 'unknown',
      blobName: doc.blob instanceof File ? doc.blob.name : 'unknown',
      blobConstructor: doc.blob?.constructor?.name,
      hasBlob: !!doc.blob,
      isFile: doc.blob instanceof File
    })));
    
    const formData = new FormData();
    
    console.log('[RAGFlowService] 开始构建FormData...');
    // 添加每个文件到FormData
    documents.forEach((doc, index) => {
      console.log(`=== [RAGFlowService] 处理文档 ${index + 1}/${documents.length} ===`);
      console.log(`[RAGFlowService] 文档信息:`, {
        display_name: doc.display_name,
        blob: doc.blob,
        blobConstructor: doc.blob?.constructor?.name,
        isFile: doc.blob instanceof File,
        size: doc.blob instanceof File ? doc.blob.size : 'unknown',
        type: doc.blob instanceof File ? doc.blob.type : 'unknown',
        name: doc.blob instanceof File ? doc.blob.name : 'unknown'
      });
      
      if (!(doc.blob instanceof File)) {
        console.error(`[RAGFlowService] 文档 ${index + 1} 的blob不是File对象:`, {
          blob: doc.blob,
          type: typeof doc.blob,
          constructor: doc.blob?.constructor?.name
        });
        throw new Error(`文档 ${doc.display_name} 不是有效的文件对象`);
      }
      
      formData.append('files', doc.blob, doc.display_name);
      console.log(`[RAGFlowService] 文档 ${index + 1} 已添加到FormData，键名: files`);
    });

    console.log('=== [RAGFlowService] FormData构建完成，准备发送请求 ===');
    console.log('[RAGFlowService] 请求详情:', {
      url: `/api/v1/ragflow/datasets/${datasetId}/documents/upload`,
      method: 'POST',
      datasetId,
      formDataEntries: Array.from(formData.entries()).map(([key, value]) => ({
        key,
        valueType: typeof value,
        isFile: value instanceof File,
        fileName: value instanceof File ? value.name : 'N/A',
        fileSize: value instanceof File ? value.size : 'N/A'
      }))
    });

    try {
      console.log('[RAGFlowService] 开始发送HTTP请求...');
      const result = await this.request(`/api/v1/ragflow/datasets/${datasetId}/documents/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        // 不设置Content-Type，让浏览器自动设置multipart/form-data边界
      },
    });
      
      console.log('=== [RAGFlowService] 请求成功 ===');
      console.log('[RAGFlowService] 响应结果:', result);
      return result;
    } catch (error) {
      console.error('=== [RAGFlowService] 请求失败 ===');
      console.error('[RAGFlowService] 错误详情:', {
        error,
        message: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  // 解析文档
  async parseDocuments(datasetId: string, documentIds: string[]): Promise<void> {
    await this.request(`/api/v1/ragflow/datasets/${datasetId}/documents/parse`, {
      method: 'POST',
      body: JSON.stringify(documentIds)
    });
  }

  // 取消解析文档
  async cancelParseDocuments(datasetId: string, documentIds: string[]): Promise<void> {
    await this.request(`/api/v1/ragflow/datasets/${datasetId}/documents/cancel_parse`, {
      method: 'POST',
      body: JSON.stringify(documentIds)
    });
  }

  // 更新文档
  async updateDocument(datasetId: string, documentId: string, updateData: any): Promise<void> {
    await this.request(`/api/v1/ragflow/datasets/${datasetId}/documents/${documentId}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
  }

  async deleteDocuments(datasetId: string, ids: string[]): Promise<void> {
    return this.request<void>(`/api/v1/ragflow/datasets/${datasetId}/documents`, {
      method: 'DELETE',
      body: JSON.stringify(ids),
    });
  }

  async getDocument(datasetId: string, documentId: string): Promise<Document> {
    return this.request<Document>(`/api/v1/ragflow/datasets/${datasetId}/documents/${documentId}`);
  }

  async downloadDocument(_datasetId: string, _documentId: string): Promise<Blob> {
    // RAGFlow官方API不提供HTTP下载端点，只支持Python SDK的Document.download()方法
    throw new Error('文档下载功能暂不可用，RAGFlow官方API不支持HTTP下载端点');
    
    // 如果将来需要实现下载功能，需要在后端通过Python SDK实现代理服务
    // const url = `${API_BASE_URL}/api/v1/ragflow/datasets/${datasetId}/documents/${documentId}/download`;
    // const response = await fetch(url, {
    //   method: 'GET',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    // });
    // 
    // if (!response.ok) {
    //   const errorData = await response.json().catch(() => ({}));
    //   throw new Error(errorData.detail || errorData.message || `Download failed: ${response.statusText}`);
    // }
    // 
    // return response.blob();
  }

  // 分块管理 API
  async listChunks(datasetId: string, documentId: string, params?: {
    page?: number;
    page_size?: number;
    keywords?: string;
  }): Promise<Chunk[]> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, value.toString());
        }
      });
    }

    return this.request<Chunk[]>(`/api/v1/ragflow/datasets/${datasetId}/documents/${documentId}/chunks?${searchParams}`);
  }

  async deleteChunks(datasetId: string, documentId: string, chunkIds: string[]): Promise<void> {
    return this.request<void>(`/api/v1/ragflow/datasets/${datasetId}/documents/${documentId}/chunks`, {
      method: 'DELETE',
      body: JSON.stringify({ chunk_ids: chunkIds }),
    });
  }

  async addChunk(datasetId: string, documentId: string, content: string, keywords?: string[]): Promise<Chunk> {
    return this.request<Chunk>(`/api/v1/ragflow/datasets/${datasetId}/documents/${documentId}/chunks`, {
      method: 'POST',
      body: JSON.stringify({ content, important_keywords: keywords || [] }),
    });
  }

  async updateChunk(datasetId: string, documentId: string, chunkId: string, content: string): Promise<void> {
    return this.request<void>(`/api/v1/ragflow/datasets/${datasetId}/documents/${documentId}/chunks/${chunkId}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  // 检索 API
  async retrieve(params: RetrieveParams): Promise<{
    chunks: Chunk[];
    total: number;
  }> {
    return this.request<{chunks: Chunk[]; total: number}>('/api/v1/ragflow/retrieve', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // 获取嵌入模型列表
  async getEmbeddingModels(): Promise<{
    models: Array<{
      id: string;
      name: string;
      description: string;
      type: string;
      language: string[];
      builtin?: boolean;
      recommended: boolean;
      verified?: boolean;
      requires_api_key?: boolean;
      provider?: string;
      status?: string;
    }>;
    total: number;
    verified_count?: number;
    builtin_count?: number;
    recommended_count: number;
    available_models?: string[];
    message?: string;
  }> {
    const response = await this.request<{
      success: boolean;
      data: {
        models: Array<{
          id: string;
          name: string;
          description: string;
          type: string;
          language: string[];
          builtin?: boolean;
          recommended: boolean;
          verified?: boolean;
          requires_api_key?: boolean;
          provider?: string;
          status?: string;
        }>;
        total: number;
        verified_count?: number;
        builtin_count?: number;
        recommended_count: number;
        available_models?: string[];
        message?: string;
      };
      message: string;
    }>('/api/v1/ragflow/embedding-models');

    if (response.success) {
      return response.data;
    } else {
      throw new Error(response.message || '获取嵌入模型列表失败');
    }
  }

  // 对话助手管理 API
  async listAssistants(params?: {
    page?: number;
    page_size?: number;
    orderby?: string;
    desc?: boolean;
    id?: string;
    name?: string;
  }): Promise<ChatAssistant[]> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, value.toString());
        }
      });
    }

    return this.request<ChatAssistant[]>(`/api/v1/ragflow/assistants?${searchParams}`);
  }

  async createAssistant(params: {
    name: string;
    avatar?: string;
    dataset_ids?: string[];
    llm?: {
      model_name?: string;
      temperature?: number;
      top_p?: number;
      presence_penalty?: number;
      frequency_penalty?: number;
    };
    prompt?: {
      similarity_threshold?: number;
      keywords_similarity_weight?: number;
      top_n?: number;
      variables?: Array<{key: string; optional: boolean}>;
      rerank_model?: string;
      top_k?: number;
      empty_response?: string;
      opener?: string;
      show_quote?: boolean;
      prompt?: string;
    };
  }): Promise<ChatAssistant> {
    return this.request<ChatAssistant>('/api/v1/ragflow/assistants', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async updateAssistant(assistantId: string, params: {
    name?: string;
    avatar?: string;
    dataset_ids?: string[];
    llm?: {
      model_name?: string;
      temperature?: number;
      top_p?: number;
      presence_penalty?: number;
      frequency_penalty?: number;
    };
    prompt?: {
      similarity_threshold?: number;
      keywords_similarity_weight?: number;
      top_n?: number;
      variables?: Array<{key: string; optional: boolean}>;
      rerank_model?: string;
      top_k?: number;
      empty_response?: string;
      opener?: string;
      show_quote?: boolean;
      prompt?: string;
    };
  }): Promise<void> {
    return this.request<void>(`/api/v1/ragflow/assistants/${assistantId}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  async deleteAssistants(ids: string[]): Promise<void> {
    return this.request<void>('/api/v1/ragflow/assistants', {
      method: 'DELETE',
      body: JSON.stringify(ids),
    });
  }

  async getAssistant(assistantId: string): Promise<ChatAssistant> {
    return this.request<ChatAssistant>(`/api/v1/ragflow/assistants/${assistantId}`);
  }

  // 对话会话管理 API
  async createSession(assistantId: string, name?: string): Promise<Session> {
    return this.request<Session>(`/api/v1/ragflow/assistants/${assistantId}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async listSessions(assistantId: string, params?: {
    page?: number;
    page_size?: number;
    orderby?: string;
    desc?: boolean;
  }): Promise<Session[]> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, String(value));
        }
      });
    }

    const queryString = queryParams.toString();
    const url = `/api/v1/ragflow/assistants/${assistantId}/sessions${queryString ? `?${queryString}` : ''}`;
    
    return this.request<Session[]>(url);
  }

  // 新增：获取本地存储的会话列表
  async listLocalSessions(assistantId: string): Promise<Session[]> {
    return this.request<Session[]>(`/api/v1/ragflow/assistants/${assistantId}/sessions/local`);
  }

  // 新增：同步RAGFlow会话到本地
  async syncSessions(assistantId: string): Promise<{synced_count: number, total_count: number}> {
    return this.request<{synced_count: number, total_count: number}>(`/api/v1/ragflow/assistants/${assistantId}/sessions/sync`, {
      method: 'POST',
    });
  }

  // 新增：删除会话（本地和远程）
  async deleteSession(assistantId: string, sessionId: string): Promise<{message: string}> {
    return this.request<{message: string}>(`/api/v1/ragflow/assistants/${assistantId}/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  // 新增：更新会话名称（优先更新本地，后端如支持将同时同步到RAGFlow）
  async updateSessionName(sessionId: string, newName: string): Promise<{status?: string; message?: string}> {
    // 注意：后端路由前缀为 /v1/ragflow，且具体路径为 /ragflow/sessions/{session_id}/name
    // 因此前端完整路径需写成 /api/v1/ragflow/ragflow/sessions/{session_id}/name
    return this.request<{status?: string; message?: string}>(`/api/v1/ragflow/ragflow/sessions/${sessionId}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName })
    });
  }

  // 对话消息 API
  async sendMessage(assistantId: string, sessionId: string, message: string, stream: boolean = false): Promise<any> {
    const endpoint = `/api/v1/ragflow/assistants/${assistantId}/sessions/${sessionId}/messages`;
    
    if (stream) {
      // 流式响应处理
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, stream: true }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.body;
    } else {
      return this.request<Message>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ message, stream: false }),
      });
    }
  }

  async listMessages(assistantId: string, sessionId: string, params?: {
    page?: number;
    page_size?: number;
    orderby?: string;
    desc?: boolean;
  }): Promise<Message[]> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, value.toString());
        }
      });
    }

    return this.request<Message[]>(`/api/v1/ragflow/assistants/${assistantId}/sessions/${sessionId}/messages?${searchParams}`);
  }

  // WebSocket连接文档状态更新
  connectDocumentStatus(
    datasetId: string,
    onStatusUpdate: (documents: Document[]) => void,
    onError?: (error: any) => void
  ): WebSocket | null {
    try {
      const token = localStorage.getItem('auth-storage');
      if (!token) {
        console.error('[RAGFlow] 未找到认证信息');
        if (onError) onError(new Error('未找到认证信息'));
        return null;
      }

      const authData = JSON.parse(token);
      if (!authData.state.token) {
        console.error('[RAGFlow] 认证token无效');
        if (onError) onError(new Error('认证token无效'));
        return null;
      }

      // 构建WebSocket URL - 使用配置的API_BASE_URL
      const apiUrl = new URL(API_BASE_URL);
      const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${apiUrl.host}/api/v1/ragflow/datasets/${datasetId}/documents/status`;
      
      console.log('[RAGFlow] 建立WebSocket连接:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('[RAGFlow] WebSocket连接已建立');
        // 发送认证信息
        ws.send(JSON.stringify({
          type: 'authorization',
          token: `Bearer ${authData.state.token}`
        }));
        
        // 注意：不再自动发送start_parsing，由调用方决定何时开始轮询
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[RAGFlow] 收到WebSocket消息:', data);
          
          if (data.type === 'document_status_update' && data.documents) {
            onStatusUpdate(data.documents);
          } else if (data.type === 'pong') {
            // 心跳响应
            console.log('[RAGFlow] 收到心跳响应');
          }
        } catch (error) {
          console.error('[RAGFlow] 解析WebSocket消息失败:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('[RAGFlow] WebSocket错误:', error);
        if (onError) onError(error);
      };
      
      ws.onclose = (event) => {
        console.log('[RAGFlow] WebSocket连接关闭:', event.code, event.reason);
      };
      
      // 定时发送心跳
      const heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else {
          clearInterval(heartbeatInterval);
        }
      }, 30000); // 30秒心跳
      
      return ws;
      
    } catch (error) {
      console.error('[RAGFlow] 建立WebSocket连接失败:', error);
      if (onError) onError(error);
      return null;
    }
  }

  // 发送开始解析消息
  sendStartParsing(ws: WebSocket | null): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'start_parsing'
      }));
      console.log('[RAGFlow] 发送开始解析消息');
    }
  }

  // 断开WebSocket连接
  disconnectDocumentStatus(ws: WebSocket | null): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      console.log('[RAGFlow] WebSocket连接已断开');
    }
  }


}

// 导出单例实例
export const ragflowService = new RAGFlowService(); 