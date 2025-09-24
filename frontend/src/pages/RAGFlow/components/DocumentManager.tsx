import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  message,
  Popconfirm,
  Tag,
  Typography,
  Upload,
  List,
  Progress,
  Alert,
  Tooltip,
  Form,
  Input,
  Select,
  Row,
  Col,
  Divider,
  Spin
} from 'antd';
import {
  FileTextOutlined,
  DeleteOutlined,
  EyeOutlined,
  UploadOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DownloadOutlined,
  EditOutlined
} from '@ant-design/icons';
import { useRAGFlowStore } from '../../../stores/ragflowStore';
import { ragflowService } from '../../../services/ragflow';
import ChunkManager from './ChunkManager';
import type { Document, Dataset } from '../../../types/ragflow';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile, UploadProps } from 'antd/es/upload';


const { Dragger } = Upload;
const { Title, Text } = Typography;

interface DocumentManagerProps {
  dataset: Dataset;
}

const DocumentManager: React.FC<DocumentManagerProps> = ({ dataset }) => {
  const {
    documents,
    documentTotal,
    loading,
    loadDocuments,
    uploadDocuments,
    deleteDocuments,
    parseDocuments,
    cancelParseDocuments,
    updateDocument
  } = useRAGFlowStore();

  // 添加批量选择状态
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [processingSelection, setProcessingSelection] = useState(false);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [chunkModalVisible, setChunkModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [editingDocument, setEditingDocument] = useState<Document | null>(null);
  const [searchKeywords, setSearchKeywords] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [editForm] = Form.useForm();
  const [isDragOver, setIsDragOver] = useState(false);

  // 添加分页状态
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0
  });

  // 新增：队列上传进度状态
  const [queueState, setQueueState] = useState({
    enabled: false,
    totalBatches: 0,
    currentBatch: 0,
    uploadedFiles: 0,
    totalFiles: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    percent: 0
  });

  // 解析全部未解析（跨分页）
  const [isParsingAll, setIsParsingAll] = useState(false);
  const [parseAllProgress, setParseAllProgress] = useState<{
    doneBatches: number;
    totalBatches: number;
    submittedDocs: number;
    totalDocs: number;
  }>({ doneBatches: 0, totalBatches: 0, submittedDocs: 0, totalDocs: 0 });
  // 会话目标与完成数量（用于“已解析/总需解析”）
  const [parseAllTargetIds, setParseAllTargetIds] = useState<string[]>([]);
  const [parseAllCompletedDocs, setParseAllCompletedDocs] = useState(0);

  // 当数据集改变时重置分页和搜索
  useEffect(() => {
    if (dataset?.id) {
      setPagination(prev => ({ ...prev, current: 1 }));
      setSearchKeywords('');
      setSearchInput('');
    }
  }, [dataset?.id]);

  // 调试：打印文档数据结构
  useEffect(() => {
    if (documents && documents.length > 0) {
      console.log('[DocumentManager] 文档数据样例:', documents[0]);
      console.log('[DocumentManager] 文档字段keys:', Object.keys(documents[0]));
    }
  }, [documents]);

  // 搜索关键词变化时重置分页
  useEffect(() => {
    setPagination(prev => ({ ...prev, current: 1 }));
  }, [searchKeywords]);

  // 延迟搜索：输入停止500ms后自动搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== searchKeywords) {
        setSearchKeywords(searchInput);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchInput, searchKeywords]);

  // 加载文档
  useEffect(() => {
    if (dataset?.id) {
      console.log('[DocumentManager] 开始加载文档，datasetId:', dataset.id);
      loadDocuments(dataset.id, {
        page: pagination.current,
        page_size: pagination.pageSize,
        keywords: searchKeywords || undefined
      }).catch(err => {
        message.error('加载文档失败');
        console.error(err);
      });
    }
  }, [dataset?.id, pagination.current, pagination.pageSize, searchKeywords, loadDocuments]);

  // 更新分页总数
  useEffect(() => {
    setPagination(prev => ({ ...prev, total: documentTotal }));
  }, [documentTotal]);

  // 只在有WebSocket连接时检查是否需要断开连接
  useEffect(() => {
    if (!dataset?.id) return;

    const currentWs = useRAGFlowStore.getState().documentStatusWs;
    
    // 只有当已经有WebSocket连接时，才检查是否需要断开
    if (currentWs) {
      const hasParsingDocuments = documents?.some(doc => 
        doc.run === 'RUNNING' || doc.run === 'UNSTART'
      );

      if (!hasParsingDocuments && !isParsingAll) {
        // 没有解析中的文档且有WebSocket连接，断开连接
        console.log('[DocumentManager] 所有文档解析完成，断开WebSocket连接');
        useRAGFlowStore.getState().disconnectDocumentStatus();
      }
    }
  }, [dataset?.id, documents, isParsingAll]);

  // 基于 WebSocket 的实时进度：统计目标集合中已完成数量
  useEffect(() => {
    if (!isParsingAll || parseAllTargetIds.length === 0) return;
    // 使用 Set 提升包含判断性能
    const targetSet = new Set(parseAllTargetIds);
    const all = documents || [];
    let done = 0;
    for (const d of all) {
      if (targetSet.has(d.id) && d.run === 'DONE') done += 1;
    }
    if (done !== parseAllCompletedDocs) setParseAllCompletedDocs(done);

    // 若已全部完成，收尾：保留一次成功提示并关闭进度
    if (parseAllProgress.totalDocs > 0 && done >= parseAllProgress.totalDocs) {
      setIsParsingAll(false);
      setTimeout(() => {
        useRAGFlowStore.getState().disconnectDocumentStatus();
        setParseAllTargetIds([]);
        // 不清零 parseAllProgress，让用户还能看到最终数值，稍后手动操作会覆盖
      }, 300);
    }
  }, [documents, isParsingAll, parseAllTargetIds, parseAllProgress.totalDocs, parseAllCompletedDocs]);

  // 组件卸载时断开连接
  useEffect(() => {
    return () => {
      console.log('[DocumentManager] 组件卸载，断开WebSocket连接');
      useRAGFlowStore.getState().disconnectDocumentStatus();
    };
  }, []);

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 查看分块
  const handleViewChunks = (document: Document) => {
    setCurrentDocument(document);
    setChunkModalVisible(true);
  };

  // 上传文档
  const handleUpload = async () => {
    console.log('=== [DocumentManager] 开始上传流程 ===');
    console.log('[DocumentManager] 当前文件列表长度:', fileList.length);
    console.log('[DocumentManager] 目标数据集:', {
      id: dataset?.id,
      name: dataset?.name,
      description: dataset?.description
    });

    if (fileList.length === 0) {
      console.warn('[DocumentManager] 没有选择文件');
      message.warning('请选择要上传的文件');
      return;
    }

    if (!dataset?.id) {
      console.error('[DocumentManager] 没有选择数据集');
      message.error('请先选择知识库');
      return;
    }

    try {
      console.log('[DocumentManager] 开始验证和处理文件...');

      // 统一提取 File 对象
      const files: File[] = fileList.map((file) => {
        const actual = (file as any).originFileObj instanceof File
          ? (file as any).originFileObj as File
          : (file as any) as File;
        return actual;
      });

      // 计算批次（RAGFlow 服务端限制：单次最多 32 个文件，总大小不超过 1GB）
      const MAX_FILES_PER_BATCH = 32;
      const MAX_BYTES_PER_BATCH = 1 * 1024 * 1024 * 1024; // 1GB

      type Batch = { files: File[]; size: number };
      const batches: Batch[] = [];
      let current: Batch = { files: [], size: 0 };

      for (const f of files) {
        const nextCount = current.files.length + 1;
        const nextSize = current.size + (f.size || 0);
        if (nextCount > MAX_FILES_PER_BATCH || nextSize > MAX_BYTES_PER_BATCH) {
          if (current.files.length > 0) {
            batches.push(current);
          }
          current = { files: [f], size: f.size || 0 };
        } else {
          current.files.push(f);
          current.size = nextSize;
        }
      }
      if (current.files.length > 0) batches.push(current);

      // 队列信息
      const totalFiles = files.length;
      const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
      // 始终启用进度条，以便单批次上传也有可视进度
      setQueueState({
        enabled: true,
        totalBatches: batches.length,
        currentBatch: 0,
        uploadedFiles: 0,
        totalFiles,
        uploadedBytes: 0,
        totalBytes,
        percent: 0
      });

      // 逐批、逐文件上传（按文件粒度更新进度）
      let uploadedFiles = 0;
      let uploadedBytes = 0;
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        setQueueState(prev => ({
          ...prev,
          currentBatch: i + 1
        }));

        for (const f of batch.files) {
          // 直接调用服务逐个上传，避免每个文件后刷新列表导致界面频繁加载
          await ragflowService.uploadDocument(dataset.id, { display_name: f.name, blob: f } as any);
          uploadedFiles += 1;
          uploadedBytes += f.size || 0;
          setQueueState(prev => ({
            ...prev,
            uploadedFiles,
            uploadedBytes,
            percent: Math.min(100, Math.round((uploadedFiles / totalFiles) * 100))
          }));
        }
      }

      console.log('[DocumentManager] 上传成功');
      message.success('文档上传成功');
      // 全部上传完成后再刷新一次列表
      await loadDocuments(dataset.id);
      setUploadModalVisible(false);
      setFileList([]);
      setQueueState(prev => ({ ...prev, enabled: false }));
    } catch (error) {
      console.error('=== [DocumentManager] 上传失败 ===');
      console.error('[DocumentManager] 错误详情:', {
        error,
        message: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined
      });
      message.error(`文档上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setQueueState(prev => ({ ...prev, enabled: false }));
    }
  };

  // 删除文档
  const handleDelete = async (documentIds: string[]) => {
    try {
      await deleteDocuments(dataset.id, documentIds);
      message.success('删除成功');
      setSelectedRowKeys([]); // 清空选择
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  // 解析文档
  const handleParse = async (documentIds: string[]) => {
    try {
      // 先建立WebSocket连接以监听解析状态
      console.log('[DocumentManager] 用户点击解析，建立WebSocket连接');
      useRAGFlowStore.getState().connectDocumentStatus(dataset.id);
      
      // 延迟发送开始解析消息，确保WebSocket连接稳定
      setTimeout(() => {
        const ws = useRAGFlowStore.getState().documentStatusWs;
        if (ws && ws.readyState === WebSocket.OPEN) {
          console.log('[DocumentManager] 发送开始解析消息');
          useRAGFlowStore.getState().startDocumentParsing();
        }
      }, 1000);
      
      // 开始解析文档
      await parseDocuments(dataset.id, documentIds);
      
      message.success('开始解析文档');
    } catch (error) {
      message.error('解析失败');
      console.error(error);
    }
  };

  // 取消解析
  const handleCancelParse = async (documentIds: string[]) => {
    try {
      await cancelParseDocuments(dataset.id, documentIds);
      
      // 检查是否还有其他正在解析的文档
      const remainingParsingDocs = documents?.filter(doc => 
        !documentIds.includes(doc.id) && (doc.run === 'RUNNING' || doc.run === 'UNSTART')
      );
      
      // 如果没有正在解析的文档了，断开WebSocket连接
      if (!remainingParsingDocs || remainingParsingDocs.length === 0) {
        console.log('[DocumentManager] 没有正在解析的文档，断开WebSocket连接');
        useRAGFlowStore.getState().disconnectDocumentStatus();
      }
      
      message.success('已取消解析');
    } catch (error) {
      message.error('取消解析失败');
      console.error(error);
    }
  };

  // 解析全部未解析（跨分页）
  const fetchAllUnparsedDocumentIds = async (): Promise<string[]> => {
    if (!dataset?.id) return [];
    const pageSize = 500;
    let page = 1;
    let total = 0;
    const unparsedIds: string[] = [];

    while (true) {
      const resp = await ragflowService.listDocuments(dataset.id, { page, page_size: pageSize });
      const docs = Array.isArray(resp.docs) ? resp.docs : [];
      total = resp.total || total;
      for (const doc of docs) {
        if (doc.run === 'UNSTART' || doc.run === 'FAIL') {
          unparsedIds.push(doc.id);
        }
      }
      const fetched = page * pageSize;
      if (docs.length < pageSize || fetched >= total) break;
      page += 1;
    }

    return unparsedIds;
  };

  const handleParseAllUnparsed = async () => {
    if (!dataset?.id) {
      message.error('未选择知识库');
      return;
    }
    try {
      setIsParsingAll(true);
      setParseAllProgress({ doneBatches: 0, totalBatches: 0, submittedDocs: 0, totalDocs: 0 });
      setParseAllTargetIds([]);
      setParseAllCompletedDocs(0);
      const key = 'parse-all';
      message.loading({ content: '正在统计未解析文档...', key, duration: 0 });

      // 统计全部未解析文档ID
      const allIds = await fetchAllUnparsedDocumentIds();
      if (allIds.length === 0) {
        message.success({ content: '没有未解析或失败的文档需要处理', key });
        setIsParsingAll(false);
        return;
      }

      // 记录此次会话的目标集合
      setParseAllTargetIds(allIds);

      // 建立状态监听
      useRAGFlowStore.getState().connectDocumentStatus(dataset.id);
      setTimeout(() => {
        const ws = useRAGFlowStore.getState().documentStatusWs;
        if (ws && ws.readyState === WebSocket.OPEN) {
          useRAGFlowStore.getState().startDocumentParsing();
        }
      }, 800);

      // 分批调用解析
      const batchSize = 200; // 保守批量，避免单次过大
      const batches: string[][] = [];
      for (let i = 0; i < allIds.length; i += batchSize) {
        batches.push(allIds.slice(i, i + batchSize));
      }
      setParseAllProgress({ doneBatches: 0, totalBatches: batches.length, submittedDocs: 0, totalDocs: allIds.length });
      message.loading({ content: `开始批量解析，共 ${allIds.length} 个文档，分为 ${batches.length} 批`, key, duration: 0 });

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        // 先乐观更新“提交进度”，确保用户能立刻看到条形进度前进
        setParseAllProgress(prev => ({
          doneBatches: Math.min(prev.totalBatches, i + 1),
          totalBatches: prev.totalBatches,
          submittedDocs: Math.min(prev.totalDocs, prev.submittedDocs + batch.length),
          totalDocs: prev.totalDocs
        }));
        // 再发起提交
        await parseDocuments(dataset.id, batch);
        message.loading({ content: `正在解析：第 ${i + 1}/${batches.length} 批（共 ${allIds.length} 个）`, key, duration: 0 });
      }

      message.success({ content: `已提交解析任务：${allIds.length} 个文档`, key });
    } catch (error) {
      console.error('解析全部未解析失败:', error);
      message.error('解析全部未解析失败');
    }
  };

  // 下载文档
  const handleDownload = async (doc: Document) => {
    try {
      const blob = await ragflowService.downloadDocument(dataset.id, doc.id);
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = doc.display_name;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success('下载成功');
    } catch (error: any) {
      // 显示更友好的错误信息
      const errorMessage = error?.message || '下载失败';
      message.error(errorMessage);
      console.error('Download error:', error);
    }
  };

  // 编辑文档
  const handleEdit = (doc: Document) => {
    setEditingDocument(doc);
    editForm.setFieldsValue({
      display_name: doc.display_name,
      chunk_method: doc.chunk_method,
    });
    setEditModalVisible(true);
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingDocument) return;
    
    try {
      const values = await editForm.validateFields();
      await updateDocument(dataset.id, editingDocument.id, values);
      message.success('更新成功');
      setEditModalVisible(false);
      setEditingDocument(null);
      editForm.resetFields();
    } catch (error) {
      message.error('更新失败');
      console.error(error);
    }
  };

  // 处理分页变化
  const handleTableChange = (page: number, pageSize: number) => {
    setPagination(prev => ({
      ...prev,
      current: page,
      pageSize: pageSize
    }));
  };



  // 调试日志
  console.log('[DocumentManager] documents from store:', documents);
  console.log('[DocumentManager] loading state:', loading);

  // 渲染状态标签
  const renderStatus = (status: string) => {
    switch (status) {
      case 'UNSTART':
        return <Tag color="default">未开始</Tag>;
      case 'RUNNING':
        return <Tag color="processing">解析中</Tag>;
      case 'DONE':
        return <Tag color="success">完成</Tag>;
      case 'FAIL':
        return <Tag color="error">失败</Tag>;
      case 'CANCEL':
        return <Tag color="warning">已取消</Tag>;
      default:
        return <Tag color="default">未知</Tag>;
    }
  };

  // 统一的文件过滤与列表变更处理
  const handleUploadChange: UploadProps['onChange'] = ({ fileList: newFileList }) => {
    console.log('=== [DocumentManager] 文件列表变更 ===');
    console.log('[DocumentManager] 新文件列表长度:', newFileList.length);
    setProcessingSelection(true);
    const allowed = new Set([
      // 文本文档
      '.txt', '.pdf', '.doc', '.docx', '.md', '.markdown', '.html', '.htm', '.json', '.csv', '.xlsx', '.xls', '.ppt', '.pptx', '.rtf', '.odt', '.epub', '.tex', '.log', '.rst', '.org',
      // 代码与配置
      '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.kt', '.kts', '.scala', '.go', '.rs', '.rb', '.php', '.cs', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.m', '.mm', '.swift', '.dart', '.lua', '.pl', '.pm', '.r', '.jl', '.sql', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd', '.vb', '.vbs', '.groovy', '.gradle', '.make', '.mk', '.cmake', '.toml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.properties', '.env', '.editorconfig', '.dockerfile', '.gql', '.graphql', '.svelte', '.vue',
      // 图片
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.svg', '.ico', '.heic'
    ]);
    // 异步处理，避免主线程长时间阻塞导致UI卡顿
    setTimeout(() => {
      const filtered = newFileList.filter(f => {
        const name = f.name || '';
        const ext = name.includes('.') ? name.substring(name.lastIndexOf('.')).toLowerCase() : '';
        return allowed.has(ext);
      });
      const skipped = newFileList.length - filtered.length;
      if (skipped > 0) {
        message.warning(`有 ${skipped} 个文件类型不被支持，已自动忽略`);
      }

      filtered.forEach((file, index) => {
        console.log(`[DocumentManager] 文件 ${index + 1}:`, {
          name: file.name,
          uid: file.uid,
          size: file.size,
          status: file.status,
          hasOriginFileObj: !!file.originFileObj,
          originFileObjType: file.originFileObj?.constructor.name
        });
      });
      setFileList(filtered);
      setProcessingSelection(false);
    }, 0);
  };

  // 支持拖拽文件夹：递归遍历DataTransferItem条目
  const collectFilesFromItems = async (items: DataTransferItemList): Promise<File[]> => {
    const getAllFiles = async (entry: any, pathPrefix = ''): Promise<File[]> => {
      return new Promise<File[]>((resolve) => {
        if (!entry) return resolve([]);
        if (entry.isFile) {
          entry.file((file: File) => {
            // 保留相对路径信息（若可用）
            (file as any).webkitRelativePath = pathPrefix + file.name;
            resolve([file]);
          }, () => resolve([]));
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const entries: any[] = [];
          const readEntries = () => {
            reader.readEntries(async (batch: any[]) => {
              if (!batch.length) {
                const nested: File[][] = await Promise.all(entries.map((ent) => getAllFiles(ent, pathPrefix + entry.name + '/')));
                resolve(nested.flat());
              } else {
                entries.push(...batch);
                readEntries();
              }
            }, () => resolve([]));
          };
          readEntries();
        } else {
          resolve([]);
        }
      });
    };

    const tasks: Promise<File[]>[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const entry = (it as any).webkitGetAsEntry ? (it as any).webkitGetAsEntry() : null;
      if (entry) {
        tasks.push(getAllFiles(entry));
      } else if (it.kind === 'file') {
        const file = it.getAsFile();
        if (file) tasks.push(Promise.resolve([file]));
      }
    }
    const fileGroups = await Promise.all(tasks);
    return fileGroups.flat();
  };

  const handleDrop: UploadProps['onDrop'] = async (e) => {
    setIsDragOver(false);
    try {
      console.log('[DocumentManager] onDrop 触发，处理拖拽的文件/文件夹');
      const items = e.dataTransfer?.items as DataTransferItemList | undefined;
      const filesList = e.dataTransfer?.files as FileList | undefined;

      // 优先使用 DataTransferItemList 以便支持目录遍历
      if (items && items.length > 0) {
        let hasDirectory = false;
        for (let i = 0; i < items.length; i++) {
          const entry = (items[i] as any).webkitGetAsEntry ? (items[i] as any).webkitGetAsEntry() : null;
          if (entry && entry.isDirectory) { hasDirectory = true; break; }
        }
        // 仅当包含目录时，接管默认行为
        if (hasDirectory) {
          e.preventDefault?.();
          e.stopPropagation?.();
        }
        setProcessingSelection(true);
        const files = hasDirectory ? await collectFilesFromItems(items) : Array.from(filesList || []).map(f => f as File);
        const mapped: UploadFile[] = files.map((f, idx) => ({
          uid: `${Date.now()}_${idx}_${f.name}`,
          name: f.name,
          size: f.size,
          status: 'done',
          originFileObj: f as any,
        }));
        const merged = [...fileList, ...mapped];
        handleUploadChange({ fileList: merged } as any);
        return;
      }

      // 退化方案：某些环境无 items，仅有 files
      if (filesList && filesList.length > 0) {
        // 仅文件时不阻止默认，让 Dragger 正常处理，这里只作为兜底
        setProcessingSelection(true);
        const files = Array.from(filesList);
        const mapped: UploadFile[] = files.map((f, idx) => ({
          uid: `${Date.now()}_${idx}_${f.name}`,
          name: f.name,
          size: f.size,
          status: 'done',
          originFileObj: f as any,
        }));
        const merged = [...fileList, ...mapped];
        handleUploadChange({ fileList: merged } as any);
      }
    } catch (err) {
      console.error('[DocumentManager] 处理拖拽数据失败:', err);
      setProcessingSelection(false);
    }
  };

  const commonUploadBehavior: Pick<UploadProps, 'beforeUpload' | 'onChange' | 'accept' | 'multiple'> = {
    multiple: true,
    beforeUpload: (file) => {
      console.log('=== [DocumentManager] 文件选择事件 ===');
      console.log('[DocumentManager] beforeUpload called with file:', {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        constructor: file.constructor.name,
        isFile: file instanceof File,
        webkitRelativePath: (file as any).webkitRelativePath
      });
      console.log('[DocumentManager] 当前知识库:', dataset?.name, 'ID:', dataset?.id);
      console.log('[DocumentManager] 当前文件列表长度:', fileList.length);
      return false;
    },
    onChange: handleUploadChange,
    accept: [
      // 文本文档
      '.txt','.pdf','.doc','.docx','.md','.markdown','.html','.htm','.json','.csv','.xlsx','.xls','.ppt','.pptx','.rtf','.odt','.epub','.tex','.log','.rst','.org',
      // 代码与配置
      '.py','.js','.jsx','.ts','.tsx','.java','.kt','.kts','.scala','.go','.rs','.rb','.php','.cs','.cpp','.cc','.cxx','.c','.h','.hpp','.m','.mm','.swift','.dart','.lua','.pl','.pm','.r','.jl','.sql','.sh','.bash','.zsh','.ps1','.psm1','.bat','.cmd','.vb','.vbs','.groovy','.gradle','.make','.mk','.cmake','.toml','.yaml','.yml','.ini','.cfg','.conf','.properties','.env','.editorconfig','.dockerfile','.gql','.graphql','.svelte','.vue',
      // 图片
      '.png','.jpg','.jpeg','.gif','.bmp','.tiff','.tif','.webp','.svg','.ico','.heic'
    ].join(',')
  };

  // 仅选择“文件”的上传配置
  const uploadFilesProps: UploadProps = {
    ...commonUploadBehavior,
    directory: false,
    fileList,
    // onDrop 由外层容器接管，避免 Upload.Dragger 吞掉目录条目
  };

  // 仅选择“文件夹”的上传配置
  const uploadFolderProps: UploadProps = {
    ...commonUploadBehavior,
    directory: true,
    fileList
  };

  // 表格列定义
  const columns: ColumnsType<Document> = [
    {
      title: '文档名称',
      dataIndex: 'display_name',
      key: 'display_name',
      render: (text: string, record: Document) => {
        // 尝试多个可能的名称字段
        const displayName = text || record.display_name || record.name || record.id || '未命名文档';
        return (
          <Space>
            <FileTextOutlined style={{ color: '#1890ff' }} />
            <span>{displayName}</span>
          </Space>
        );
      },
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: 'Token数量',
      dataIndex: 'token_count',
      key: 'token_count',
      width: 100,
      render: (count: number) => count ? count.toLocaleString() : '0',
    },
    {
      title: '分块数量',
      dataIndex: 'chunk_count',
      key: 'chunk_count',
      width: 100,
      render: (count: number, record: Document) => (
        <Button 
          type="link" 
          onClick={() => handleViewChunks(record)}
          disabled={count === 0}
        >
          {count}
        </Button>
      ),
    },
    {
      title: '解析状态',
      dataIndex: 'run',
      key: 'run',
      width: 100,
      render: (status: string) => renderStatus(status),
    },
    {
      title: '解析进度',
      key: 'progress',
      width: 150,
      render: (_, record: Document) => (
        <div>
          <Progress
            percent={Math.round(record.progress * 100)}
            size="small"
            status={record.run === 'FAIL' ? 'exception' : undefined}
          />
          {record.run === 'RUNNING' && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.chunk_count || 0} / {record.token_count || 0} tokens
            </Text>
          )}
        </div>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (time: string, record: Document) => {
        // 尝试多种时间字段格式
        const timeValue = time || record.create_time || record.process_begin_at;
        if (!timeValue) return '-';
        
        try {
          return new Date(timeValue).toLocaleString();
        } catch {
          return timeValue;
        }
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record: Document) => (
        <Space size="small">
          <Tooltip title="查看分块">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => handleViewChunks(record)}
              disabled={!record.chunk_count || record.chunk_count === 0}
            />
          </Tooltip>
          
          <Tooltip title="下载文档">
            <Button
              type="text"
              icon={<DownloadOutlined />}
              onClick={() => handleDownload(record)}
            />
          </Tooltip>
          
          <Tooltip title="编辑文档">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          
          {record.run === 'UNSTART' && (
            <Tooltip title="开始解析">
              <Button
                type="text"
                icon={<PlayCircleOutlined />}
                onClick={() => handleParse([record.id])}
              />
            </Tooltip>
          )}
          
          {record.run === 'RUNNING' && (
            <Tooltip title="取消解析">
              <Button
                type="text"
                icon={<StopOutlined />}
                onClick={() => handleCancelParse([record.id])}
              />
            </Tooltip>
          )}
          
          {record.run === 'FAIL' && (
            <Tooltip title="重新解析">
              <Button
                type="text"
                icon={<PlayCircleOutlined />}
                onClick={() => handleParse([record.id])}
                style={{ color: '#faad14' }}
              />
            </Tooltip>
          )}
          
          <Popconfirm
            title="确定要删除这个文档吗？"
            onConfirm={() => handleDelete([record.id])}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 批量解析选中的文档
  const handleBatchParse = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要解析的文档');
      return;
    }

    // 筛选出可以解析的文档（状态为UNSTART或FAIL）
    const parseableDocuments = documents?.filter(doc => 
      selectedRowKeys.includes(doc.id) && (doc.run === 'UNSTART' || doc.run === 'FAIL')
    ) || [];

    if (parseableDocuments.length === 0) {
      message.warning('所选文档中没有可解析的文档（需要状态为未开始或解析失败）');
      return;
    }

    const parseableIds = parseableDocuments.map(doc => doc.id);
    
    Modal.confirm({
      title: '批量解析确认',
      content: `确定要解析选中的 ${parseableIds.length} 个文档吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        await handleParse(parseableIds);
        setSelectedRowKeys([]); // 清空选择
      },
    });
  };

  // 批量取消解析选中的文档
  const handleBatchCancelParse = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要取消解析的文档');
      return;
    }

    // 筛选出正在解析的文档
    const cancelableDocuments = documents?.filter(doc => 
      selectedRowKeys.includes(doc.id) && doc.run === 'RUNNING'
    ) || [];

    if (cancelableDocuments.length === 0) {
      message.warning('所选文档中没有正在解析的文档');
      return;
    }

    const cancelableIds = cancelableDocuments.map(doc => doc.id);
    
    Modal.confirm({
      title: '批量取消解析确认',
      content: `确定要取消解析选中的 ${cancelableIds.length} 个文档吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        await handleCancelParse(cancelableIds);
        setSelectedRowKeys([]); // 清空选择
      },
    });
  };

  // 批量删除选中的文档
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的文档');
      return;
    }

    Modal.confirm({
      title: '批量删除确认',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个文档吗？此操作不可恢复。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        await handleDelete(selectedRowKeys);
        setSelectedRowKeys([]); // 清空选择
      },
    });
  };

  // 表格行选择配置
  const rowSelection = {
    selectedRowKeys,
    onChange: (selectedKeys: React.Key[]) => {
      setSelectedRowKeys(selectedKeys as string[]);
    },
    getCheckboxProps: (record: Document) => ({
      name: record.display_name,
    }),
  };

  // 获取文档统计信息
  const getDocumentStats = () => {
    const allDocs = documents || [];
    const unstartCount = allDocs.filter(doc => doc.run === 'UNSTART').length;
    const failCount = allDocs.filter(doc => doc.run === 'FAIL').length;
    const runningCount = allDocs.filter(doc => doc.run === 'RUNNING').length;
    const doneCount = allDocs.filter(doc => doc.run === 'DONE').length;
    
    return {
      total: allDocs.length,
      parseable: unstartCount + failCount, // 可解析的（包括重试）
      running: runningCount,
      done: doneCount,
    };
  };

  // 获取批量操作按钮的状态
  const getSelectedDocumentStats = () => {
    const selectedDocs = documents?.filter(doc => selectedRowKeys.includes(doc.id)) || [];
    const unstartCount = selectedDocs.filter(doc => doc.run === 'UNSTART').length;
    const failCount = selectedDocs.filter(doc => doc.run === 'FAIL').length;
    const runningCount = selectedDocs.filter(doc => doc.run === 'RUNNING').length;
    
    return {
      total: selectedDocs.length,
      canParse: unstartCount + failCount, // 未开始和失败的都可以解析
      canCancel: runningCount,
    };
  };

  const selectedStats = getSelectedDocumentStats();
  const docStats = getDocumentStats();

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={4}>文档管理</Title>
            <Text type="secondary">
              总计 {documents?.length || 0} 个文档
              {selectedRowKeys.length > 0 && (
                <span style={{ marginLeft: 8, color: '#1890ff' }}>
                  已选择 {selectedRowKeys.length} 个
                </span>
              )}
            </Text>
          </Col>
          <Col style={{ maxWidth: '100%' }}>
            <Space wrap size="small" style={{ display: 'flex', justifyContent: 'flex-end', rowGap: 8 }}>
              {/* 搜索框 */}
              <Input.Search
                placeholder="搜索文档名称"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                }}
                onSearch={(value) => {
                  setSearchKeywords(value);
                }}
                onPressEnter={() => {
                  setSearchKeywords(searchInput);
                }}
                style={{ width: 250 }}
                allowClear
                onClear={() => {
                  setSearchInput('');
                  setSearchKeywords('');
                }}
              />
              
              {/* 选择按钮组 */}
              <Space.Compact>
                <Button
                  size="small"
                  onClick={() => {
                    const allIds = documents?.map(doc => doc.id) || [];
                    setSelectedRowKeys(allIds);
                  }}
                  disabled={docStats.total === 0}
                >
                  全选 ({docStats.total})
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    const parseableIds = documents?.filter(doc => 
                      doc.run === 'UNSTART' || doc.run === 'FAIL'
                    ).map(doc => doc.id) || [];
                    setSelectedRowKeys(parseableIds);
                  }}
                  disabled={docStats.parseable === 0}
                >
                  选择可解析 ({docStats.parseable})
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    const parsedIds = documents?.filter(doc => 
                      doc.run === 'DONE'
                    ).map(doc => doc.id) || [];
                    setSelectedRowKeys(parsedIds);
                  }}
                  disabled={docStats.done === 0}
                >
                  选择已解析 ({docStats.done})
                </Button>
              </Space.Compact>
              
              {/* 解析全部未解析（跨分页） */}
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={isParsingAll || loading.parse}
                disabled={docStats.parseable === 0}
                onClick={() => {
                  Modal.confirm({
                    title: '解析全部未解析的文档',
                    content: '将跨分页统计所有未解析或失败的文档，并分批提交解析任务。是否继续？',
                    okText: '开始解析',
                    cancelText: '取消',
                    onOk: () => handleParseAllUnparsed()
                  });
                }}
              >
                解析全部未解析
                {parseAllProgress.totalBatches > 0 && (
                  <span style={{ marginLeft: 8, fontWeight: 400 }}>
                    {parseAllProgress.doneBatches}/{parseAllProgress.totalBatches}
                  </span>
                )}
              </Button>

              {/* 分隔线 */}
              {selectedRowKeys.length > 0 && <Divider type="vertical" />}
              
              {/* 批量操作按钮组 */}
              {selectedRowKeys.length > 0 && (
                <>
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={handleBatchParse}
                    disabled={selectedStats.canParse === 0}
                  >
                    解析/重试 ({selectedStats.canParse})
                  </Button>
                  
                  <Button
                    icon={<StopOutlined />}
                    onClick={handleBatchCancelParse}
                    disabled={selectedStats.canCancel === 0}
                  >
                    批量取消 ({selectedStats.canCancel})
                  </Button>
                  
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={handleBatchDelete}
                  >
                    批量删除 ({selectedStats.total})
                  </Button>
                  
                  <Button
                    onClick={() => setSelectedRowKeys([])}
                  >
                    取消选择
                  </Button>
                </>
              )}
              
              <Button 
                type="primary" 
                icon={<UploadOutlined />}
                onClick={() => setUploadModalVisible(true)}
              >
                上传文档
              </Button>
            </Space>
          </Col>
        </Row>
        {(isParsingAll || parseAllCompletedDocs > 0) && parseAllProgress.totalDocs > 0 && (
          <div style={{ marginTop: 8 }}>
            <Space size={24} wrap>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Progress
                  percent={parseAllProgress.totalBatches === 0 ? 0 : Math.round((parseAllProgress.doneBatches / parseAllProgress.totalBatches) * 100)}
                  size="small"
                  style={{ width: 220 }}
                />
                <Text type="secondary">
                  提交 {parseAllProgress.submittedDocs}/{parseAllProgress.totalDocs}
                </Text>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Progress
                  percent={parseAllProgress.totalDocs === 0 ? 0 : Math.round((parseAllCompletedDocs / parseAllProgress.totalDocs) * 100)}
                  size="small"
                  status={isParsingAll ? 'active' : undefined}
                  style={{ width: 220 }}
                />
                <Text type="secondary">
                  已解析 {parseAllCompletedDocs}/{parseAllProgress.totalDocs}
                </Text>
              </div>
            </Space>
          </div>
        )}
      </Card>

      <Card>
        <Table<Document>
          rowSelection={rowSelection}
          columns={columns}
          dataSource={documents}
          rowKey="id"
          loading={loading.documents}
          scroll={{ y: 520 }}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) =>
              `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            onChange: handleTableChange,
            onShowSizeChange: handleTableChange,
          }}
        />
      </Card>

      {/* 上传文档模态框 */}
      <Modal
        title="上传文档"
        open={uploadModalVisible}
        onOk={handleUpload}
        onCancel={() => {
          setUploadModalVisible(false);
          setFileList([]);
        }}
        width={600}
        okText="开始上传"
        cancelText="取消"
      >
        <Alert
          message="上传说明"
          description={
            <div>
              <div>支持单次或批量上传；可选择文件夹或多选文件；拖拽可同时支持文件与文件夹。</div>
              <div>服务端限制：单次最多 32 个文件，单次总大小不超过 1GB。</div>
              <div>若超过限制，将自动排队分批上传，并显示进度。</div>
            </div>
          }
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
        />
        <Form
          layout="vertical"
        >
          <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#ff4d4f' }}>*</span>
            <Text style={{ margin: 0 }}>目标知识库</Text>
            <Text type="secondary">{dataset?.name || '-'}</Text>
          </div>

          <div
            className={`dm-dragger-has-scroll${fileList.length > 0 ? ' dm-has-files' : ''}${isDragOver ? ' dm-drag-active' : ''}`}
            onDragEnter={() => setIsDragOver(true)}
            onDragOverCapture={(ev: React.DragEvent<HTMLDivElement>) => { ev.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDropCapture={handleDrop as any}
          >
            <Dragger
              {...uploadFilesProps}
              showUploadList={{ showRemoveIcon: true }}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
              <p className="ant-upload-hint">
                支持单个或批量上传；拖拽时文件与文件夹均可识别。
              </p>
            </Dragger>
          </div>

          {fileList.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
              <Text type="secondary" style={{ margin: 0, fontSize: 12 }}>
                待上传文件 ({fileList.length})
              </Text>
            </div>
          )}
 
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <Upload {...uploadFilesProps} showUploadList={false}>
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
            <Upload {...uploadFolderProps} showUploadList={false}>
              <Button icon={<UploadOutlined />}>选择文件夹</Button>
            </Upload>
          </div>

          <style>{`
            .dm-dragger-has-scroll .ant-upload-list {
              max-height: 320px;
              overflow: auto;
              margin-top: 4px;
            }
            .dm-drag-active {
              transition: all 0.15s ease-in-out;
            }
            .dm-drag-active .ant-upload.ant-upload-drag {
              border-color: #1677ff !important;
              background: rgba(22, 119, 255, 0.04);
              box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.15) inset;
            }
            .dm-drag-active .ant-upload.ant-upload-drag .ant-upload-drag-container .ant-upload-text {
              color: #1677ff;
            }
          `}</style>

          {queueState.enabled && (
            <div style={{ marginTop: 16 }}>
              <Title level={5}>上传进度</Title>
              <div style={{ marginBottom: 8 }}>
                批次 {queueState.currentBatch}/{queueState.totalBatches}，
                文件 {queueState.uploadedFiles}/{queueState.totalFiles}
              </div>
              <Progress percent={queueState.percent} status={loading.upload ? 'active' : undefined} />
              <Text type="secondary">
                {formatFileSize(queueState.uploadedBytes)} / {formatFileSize(queueState.totalBytes)}
              </Text>
            </div>
          )}
        </Form>
      </Modal>

      {/* 分块管理模态框 */}
      <Modal
        title={`分块管理 - ${currentDocument?.display_name}`}
        open={chunkModalVisible}
        onCancel={() => {
          setChunkModalVisible(false);
          setCurrentDocument(null);
        }}
        width={1200}
        footer={null}
        destroyOnClose
      >
        {currentDocument && (
          <ChunkManager
            dataset={dataset}
            document={currentDocument}
          />
        )}
      </Modal>

      {/* 编辑文档模态框 */}
      <Modal
        title="编辑文档"
        open={editModalVisible}
        onOk={handleSaveEdit}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingDocument(null);
          editForm.resetFields();
        }}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={editForm}
          layout="vertical"
        >
          <Form.Item
            name="display_name"
            label="文档名称"
            rules={[{ required: true, message: '请输入文档名称' }]}
          >
            <Input placeholder="请输入文档名称" />
          </Form.Item>
          
          <Form.Item
            name="chunk_method"
            label="分块方法"
            rules={[{ required: true, message: '请选择分块方法' }]}
          >
            <Select placeholder="请选择分块方法">
              <Select.Option value="naive">通用分块</Select.Option>
              <Select.Option value="manual">手动分块</Select.Option>
              <Select.Option value="qa">问答分块</Select.Option>
              <Select.Option value="table">表格分块</Select.Option>
              <Select.Option value="paper">论文分块</Select.Option>
              <Select.Option value="book">书籍分块</Select.Option>
              <Select.Option value="laws">法律分块</Select.Option>
              <Select.Option value="presentation">演示文稿分块</Select.Option>
              <Select.Option value="picture">图片分块</Select.Option>
              <Select.Option value="one">一个分块</Select.Option>
              <Select.Option value="knowledge_graph">知识图谱分块</Select.Option>
              <Select.Option value="email">邮件分块</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DocumentManager; 