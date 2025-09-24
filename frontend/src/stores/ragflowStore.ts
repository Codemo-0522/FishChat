import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ragflowService } from '../services/ragflow';
import type { 
  RAGFlowConfig, 
  Dataset, 
  Document, 
  Chunk, 
  ChatAssistant,
  CreateDatasetParams,
  UpdateDatasetParams,
  UploadDocumentParams
} from '../types/ragflow';

interface RAGFlowStore {
  // 配置状态
  config: RAGFlowConfig | null;
  isConnected: boolean;
  
  // 知识库状态
  datasets: Dataset[];
  currentDataset: Dataset | null;
  
  // 文档状态
  documents: Document[];
  currentDocument: Document | null;
  documentTotal: number;
  
  // 分块状态
  chunks: Chunk[];
  
  // 对话助手状态
  assistants: ChatAssistant[];
  currentAssistant: ChatAssistant | null;
  
  // 加载状态
  loading: {
    datasets: boolean;
    documents: boolean;
    chunks: boolean;
    assistants: boolean;
    upload: boolean;
    parse: boolean;
  };
  
  // WebSocket状态
  documentStatusWs: WebSocket | null;
  
  // Actions
  setConfig: (config: RAGFlowConfig) => void;
  testConnection: () => Promise<boolean>;
  initializeConnection: () => Promise<void>;
  
  // 知识库操作
  loadDatasets: () => Promise<void>;
  createDataset: (params: CreateDatasetParams) => Promise<Dataset>;
  updateDataset: (id: string, params: UpdateDatasetParams) => Promise<void>;
  deleteDataset: (id: string) => Promise<void>;
  deleteDatasets: (ids: string[]) => Promise<void>;
  setCurrentDataset: (dataset: Dataset | null) => void;
  
  // 文档操作
  loadDocuments: (datasetId: string, params?: {page?: number; page_size?: number; keywords?: string}) => Promise<void>;
  uploadDocuments: (datasetId: string, uploadParams: UploadDocumentParams[]) => Promise<void>;
  deleteDocuments: (datasetId: string, documentIds: string[]) => Promise<void>;
  parseDocuments: (datasetId: string, documentIds: string[]) => Promise<void>;
  cancelParseDocuments: (datasetId: string, documentIds: string[]) => Promise<void>;
  updateDocument: (datasetId: string, documentId: string, updateData: any) => Promise<void>;
  setCurrentDocument: (document: Document | null) => void;
  
  // 分块操作
  loadChunks: (datasetId: string, documentId: string) => Promise<void>;
  createChunk: (datasetId: string, documentId: string, content: string, keywords?: string[]) => Promise<void>;
  updateChunk: (datasetId: string, documentId: string, chunkId: string, updateData: any) => Promise<void>;
  deleteChunk: (datasetId: string, documentId: string, chunkId: string) => Promise<void>;
  deleteChunks: (datasetId: string, documentId: string, chunkIds: string[]) => Promise<void>;
  
  // 对话助手操作
  loadAssistants: () => Promise<void>;
  createAssistant: (params: any) => Promise<ChatAssistant>;
  updateAssistant: (id: string, params: any) => Promise<void>;
  deleteAssistant: (id: string) => Promise<void>;
  deleteAssistants: (ids: string[]) => Promise<void>;
  setCurrentAssistant: (assistant: ChatAssistant | null) => void;

  // WebSocket连接管理
  connectDocumentStatus: (datasetId: string) => void;
  disconnectDocumentStatus: () => void;
  startDocumentParsing: () => void;
  
  // 重置状态
  reset: () => void;
}

export const useRAGFlowStore = create<RAGFlowStore>()(
  persist(
    (set, get) => ({
      // 初始状态
      config: null,
      isConnected: false,
      datasets: [],
      currentDataset: null,
      documents: [],
      currentDocument: null,
      documentTotal: 0,
      chunks: [],
      assistants: [],
      currentAssistant: null,
      loading: {
        datasets: false,
        documents: false,
        chunks: false,
        assistants: false,
        upload: false,
        parse: false,
      },
      documentStatusWs: null,

      // 设置配置
      setConfig: (config: RAGFlowConfig) => {
        ragflowService.setConfig(config);
        set({ config, isConnected: false });
      },

      // 测试连接
      testConnection: async () => {
        try {
          const success = await ragflowService.testConnection();
          set({ isConnected: success });
          return success;
        } catch (error) {
          console.error('RAG Flow 连接测试失败:', error);
          set({ isConnected: false });
          return false;
        }
      },

      // 初始化连接状态
      initializeConnection: async () => {
        try {
          const state = get();
          if (!state.config) {
            return;
          }
          
          // 设置配置到服务
          ragflowService.setConfig(state.config);
          
          // 测试连接
          const success = await ragflowService.testConnection();
          set({ isConnected: success });
          
          if (success) {
            console.log('RAG Flow 连接初始化成功');
          } else {
            console.log('RAG Flow 连接初始化失败');
          }
        } catch (error) {
          console.error('RAG Flow 连接初始化失败:', error);
          set({ isConnected: false });
        }
      },

      // 加载知识库列表
      loadDatasets: async () => {
        set(state => ({ loading: { ...state.loading, datasets: true } }));
        try {
          const response = await ragflowService.listDatasets();
          
          // 处理不同的响应格式
          let datasets: Dataset[] = [];
          if (Array.isArray(response)) {
            // 直接是知识库数组
            datasets = response;
          } else if (response && typeof response === 'object' && 'data' in response) {
            // 包装在data字段中的知识库列表
            const responseData = response as { data: Dataset[] };
            datasets = Array.isArray(responseData.data) ? responseData.data : [];
          }
          
          console.log('🔍 知识库数据调试:', {
            response,
            datasets,
            count: datasets.length
          });
          
          set({ datasets });
        } catch (error) {
          console.error('加载知识库列表失败:', error);
          // 发生错误时确保datasets是空数组
          set({ datasets: [] });
          throw error;
        } finally {
          set(state => ({ loading: { ...state.loading, datasets: false } }));
        }
      },

      // 创建知识库
      createDataset: async (params: CreateDatasetParams) => {
        try {
          const dataset = await ragflowService.createDataset(params);
          set(state => {
            // 确保datasets是数组
            const currentDatasets = Array.isArray(state.datasets) ? state.datasets : [];
            return { 
              datasets: [...currentDatasets, dataset] 
            };
          });
          return dataset;
        } catch (error) {
          console.error('创建知识库失败:', error);
          throw error;
        }
      },

      // 更新知识库
      updateDataset: async (id: string, params: UpdateDatasetParams) => {
        try {
          await ragflowService.updateDataset(id, params);
          set(state => {
            const currentDatasets = Array.isArray(state.datasets) ? state.datasets : [];
            return {
              datasets: currentDatasets.map(d => 
                d.id === id ? { ...d, ...params } : d
              ),
              currentDataset: state.currentDataset?.id === id 
                ? { ...state.currentDataset, ...params } 
                : state.currentDataset
            };
          });
        } catch (error) {
          console.error('更新知识库失败:', error);
          throw error;
        }
      },

      // 删除知识库
      deleteDataset: async (id: string) => {
        try {
          await ragflowService.deleteDatasets([id]);
          set(state => {
            const currentDatasets = Array.isArray(state.datasets) ? state.datasets : [];
            return {
              datasets: currentDatasets.filter(d => d.id !== id),
              currentDataset: state.currentDataset && state.currentDataset.id === id 
                ? null 
                : state.currentDataset
            };
          });
        } catch (error) {
          console.error('删除知识库失败:', error);
          throw error;
        }
      },

      // 批量删除知识库
      deleteDatasets: async (ids: string[]) => {
        try {
          await ragflowService.deleteDatasets(ids);
          set(state => {
            const currentDatasets = Array.isArray(state.datasets) ? state.datasets : [];
            return {
              datasets: currentDatasets.filter(d => !ids.includes(d.id)),
              currentDataset: state.currentDataset && ids.includes(state.currentDataset.id) 
                ? null 
                : state.currentDataset
            };
          });
        } catch (error) {
          console.error('批量删除知识库失败:', error);
          throw error;
        }
      },

      // 设置当前知识库
      setCurrentDataset: (dataset: Dataset | null) => {
        set({ currentDataset: dataset });
      },

      // 加载文档列表
      loadDocuments: async (datasetId: string, params?: {page?: number; page_size?: number; keywords?: string}) => {
        set(state => ({ loading: { ...state.loading, documents: true } }));
        try {
          const response = await ragflowService.listDocuments(datasetId, params);
          console.log('[RAGFlowStore] loadDocuments 原始响应:', response);
          console.log('[RAGFlowStore] loadDocuments 响应类型:', typeof response);
          console.log('[RAGFlowStore] loadDocuments 是否为数组:', Array.isArray(response));
          
          // RAGFlow API 返回格式：{docs: [], total: number}
          const documents = Array.isArray(response.docs) ? response.docs : [];
          const total = response.total || 0;
          console.log('[RAGFlowStore] loadDocuments 处理后的documents:', documents);
          console.log('[RAGFlowStore] loadDocuments 文档数量:', documents.length);
          console.log('[RAGFlowStore] loadDocuments 总数量:', total);
          
          set({ documents, documentTotal: total });
        } catch (error) {
          console.error('加载文档列表失败:', error);
          // 发生错误时确保documents是空数组
          set({ documents: [], documentTotal: 0 });
          throw error;
        } finally {
          set(state => ({ loading: { ...state.loading, documents: false } }));
        }
      },

      // 上传文档
      uploadDocuments: async (datasetId: string, uploadParams: UploadDocumentParams[]) => {
        set(state => ({ loading: { ...state.loading, upload: true } }));
        try {
          await ragflowService.uploadDocuments(datasetId, uploadParams);
          // 重新加载文档列表
          await get().loadDocuments(datasetId);
        } catch (error) {
          console.error('上传文档失败:', error);
          throw error;
        } finally {
          set(state => ({ loading: { ...state.loading, upload: false } }));
        }
      },

      // 删除文档
      deleteDocuments: async (datasetId: string, documentIds: string[]) => {
        try {
          await ragflowService.deleteDocuments(datasetId, documentIds);
          set(state => ({
            documents: state.documents.filter(d => !documentIds.includes(d.id)),
            currentDocument: documentIds.includes(state.currentDocument?.id || '') 
              ? null 
              : state.currentDocument
          }));
        } catch (error) {
          console.error('删除文档失败:', error);
          throw error;
        }
      },

      // 解析文档
      parseDocuments: async (datasetId: string, documentIds: string[]) => {
        set(state => ({ loading: { ...state.loading, parse: true } }));
        try {
          await ragflowService.parseDocuments(datasetId, documentIds);
          
          // 重新加载文档列表以获取最新状态
          await get().loadDocuments(datasetId);
          
        } catch (error) {
          console.error('解析文档失败:', error);
          throw error;
        } finally {
          set(state => ({ loading: { ...state.loading, parse: false } }));
        }
      },

      // 取消解析文档
      cancelParseDocuments: async (datasetId: string, documentIds: string[]) => {
        try {
          await ragflowService.cancelParseDocuments(datasetId, documentIds);
          // 重新加载文档列表以更新状态
          await get().loadDocuments(datasetId);
        } catch (error) {
          console.error('取消解析文档失败:', error);
          throw error;
        }
      },

      // 更新文档
      updateDocument: async (datasetId: string, documentId: string, updateData: any) => {
        set(state => ({ loading: { ...state.loading, documents: true } }));
        try {
          await ragflowService.updateDocument(datasetId, documentId, updateData);
          // 重新加载文档列表以获取最新状态
          await get().loadDocuments(datasetId);
        } catch (error) {
          console.error('更新文档失败:', error);
          throw error;
        } finally {
          set(state => ({ loading: { ...state.loading, documents: false } }));
        }
      },

      // 设置当前文档
      setCurrentDocument: (document: Document | null) => {
        set({ currentDocument: document });
      },

      // 加载分块列表
      loadChunks: async (datasetId: string, documentId: string) => {
        set(state => ({ loading: { ...state.loading, chunks: true } }));
        try {
          const response = await ragflowService.listChunks(datasetId, documentId);
          // RAGFlow API 直接返回分块数组，不是 {data: [], total: number} 格式
          const chunks = Array.isArray(response) ? response : [];
          set({ chunks });
        } catch (error) {
          console.error('加载分块列表失败:', error);
          // 发生错误时确保chunks是空数组
          set({ chunks: [] });
          throw error;
        } finally {
          set(state => ({ loading: { ...state.loading, chunks: false } }));
        }
      },

      // 添加分块
      createChunk: async (datasetId: string, documentId: string, content: string, keywords?: string[]) => {
        try {
          await ragflowService.addChunk(datasetId, documentId, content, keywords);
          // 重新加载分块列表
          await get().loadChunks(datasetId, documentId);
        } catch (error) {
          console.error('添加分块失败:', error);
          throw error;
        }
      },

      // 更新分块
      updateChunk: async (datasetId: string, documentId: string, chunkId: string, updateData: any) => {
        try {
          await ragflowService.updateChunk(datasetId, documentId, chunkId, updateData);
          // 重新加载分块列表
          await get().loadChunks(datasetId, documentId);
        } catch (error) {
          console.error('更新分块失败:', error);
          throw error;
        }
      },

      // 删除分块
       deleteChunk: async (datasetId: string, documentId: string, chunkId: string) => {
         try {
           await ragflowService.deleteChunks(datasetId, documentId, [chunkId]);
           // 重新加载分块列表
           await get().loadChunks(datasetId, documentId);
         } catch (error) {
           console.error('删除分块失败:', error);
           throw error;
         }
       },

      // 批量删除分块
      deleteChunks: async (datasetId: string, documentId: string, chunkIds: string[]) => {
        try {
          await ragflowService.deleteChunks(datasetId, documentId, chunkIds);
          // 重新加载分块列表
          await get().loadChunks(datasetId, documentId);
        } catch (error) {
          console.error('批量删除分块失败:', error);
          throw error;
        }
      },

      // 加载对话助手列表
      loadAssistants: async () => {
        set(state => ({ loading: { ...state.loading, assistants: true } }));
        try {
          const response = await ragflowService.listAssistants();
          
          // 添加调试日志
          console.log('🔍 助手数据调试:', {
            response,
            responseType: typeof response,
            isArray: Array.isArray(response),
            hasData: response && 'data' in response
          });
          
          // 处理不同的响应格式
          let assistants: ChatAssistant[] = [];
          if (Array.isArray(response)) {
            // 直接是助手数组
            assistants = response;
          } else if (response && typeof response === 'object' && 'data' in response) {
            // 包装在data字段中的助手列表
            const responseData = response as { data: ChatAssistant[] };
            assistants = Array.isArray(responseData.data) ? responseData.data : [];
          }
          
          console.log('🔍 处理后的助手数据:', {
            assistants,
            count: assistants.length,
            firstAssistant: assistants[0]
          });
          
          set({ assistants });
        } catch (error) {
          console.error('加载对话助手列表失败:', error);
          // 发生错误时确保assistants是空数组
          set({ assistants: [] });
          throw error;
        } finally {
          set(state => ({ loading: { ...state.loading, assistants: false } }));
        }
      },

      // 创建对话助手
      createAssistant: async (params: any) => {
        try {
          console.log('🚀 开始创建助手，参数:', params);
          const assistant = await ragflowService.createAssistant(params);
          console.log('✅ 助手创建成功，返回数据:', assistant);
          set(state => ({ 
            assistants: [...state.assistants, assistant] 
          }));
          return assistant;
        } catch (error) {
          console.error('❌ 创建对话助手失败，详细错误:', error);
          console.error('错误类型:', typeof error);
          console.error('是否为Error实例:', error instanceof Error);
          if (error instanceof Error) {
            console.error('错误消息:', error.message);
            console.error('错误堆栈:', error.stack);
          }
          throw error;
        }
      },

      // 更新对话助手
      updateAssistant: async (id: string, params: any) => {
        try {
          await ragflowService.updateAssistant(id, params);
          set(state => ({
            assistants: state.assistants.map(a => 
              a.id === id ? { ...a, ...params } : a
            ),
            currentAssistant: state.currentAssistant?.id === id 
              ? { ...state.currentAssistant, ...params } 
              : state.currentAssistant
          }));
        } catch (error) {
          console.error('更新对话助手失败:', error);
          throw error;
        }
      },

      // 删除对话助手
      deleteAssistant: async (id: string) => {
        try {
          await ragflowService.deleteAssistants([id]);
          set(state => ({
            assistants: state.assistants.filter(a => a.id !== id),
            currentAssistant: state.currentAssistant?.id === id 
              ? null 
              : state.currentAssistant
          }));
        } catch (error) {
          console.error('删除对话助手失败:', error);
          throw error;
        }
      },

      // 批量删除对话助手
      deleteAssistants: async (ids: string[]) => {
        try {
          await ragflowService.deleteAssistants(ids);
          set(state => ({
            assistants: state.assistants.filter(a => !ids.includes(a.id)),
            currentAssistant: state.currentAssistant && ids.includes(state.currentAssistant.id) 
              ? null 
              : state.currentAssistant
          }));
        } catch (error) {
          console.error('批量删除对话助手失败:', error);
          throw error;
        }
      },

      // 设置当前对话助手
      setCurrentAssistant: (assistant: ChatAssistant | null) => {
        set({ currentAssistant: assistant });
      },

             // WebSocket连接管理
             connectDocumentStatus: (datasetId: string) => {
        // 先断开之前的连接
        const currentWs = get().documentStatusWs;
        if (currentWs) {
          ragflowService.disconnectDocumentStatus(currentWs);
        }
        
        const ws = ragflowService.connectDocumentStatus(
          datasetId,
          (documents: Document[]) => {
            console.log('[RAGFlowStore] 收到文档状态更新:', documents);
            set({ documents });
          },
          (error: any) => {
            console.error('[RAGFlowStore] WebSocket错误:', error);
          }
        );
        
        set({ documentStatusWs: ws });
      },
           disconnectDocumentStatus: () => {
       const ws = get().documentStatusWs;
       ragflowService.disconnectDocumentStatus(ws);
       set({ documentStatusWs: null });
       console.log(`[RAGFlowStore] WebSocket连接已断开`);
      },

      startDocumentParsing: () => {
        const ws = get().documentStatusWs;
        ragflowService.sendStartParsing(ws);
      },

      // 重置状态
      reset: () => {
        // 断开WebSocket连接
        const ws = get().documentStatusWs;
        ragflowService.disconnectDocumentStatus(ws);
        
        set({
          config: null,
          isConnected: false,
          datasets: [],
          currentDataset: null,
          documents: [],
          currentDocument: null,
          chunks: [],
          assistants: [],
          currentAssistant: null,
          loading: {
            datasets: false,
            documents: false,
            chunks: false,
            assistants: false,
            upload: false,
            parse: false,
          },
          documentStatusWs: null,
        });
      },
    }),
    {
      name: 'ragflow-store',
      partialize: (state) => ({ 
        config: state.config,
        isConnected: state.isConnected 
      }), // 持久化配置和连接状态
    }
  )
); 