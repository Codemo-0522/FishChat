// RAG Flow API 类型定义

export interface RAGFlowConfig {
  apiKey: string;
  baseUrl: string;
}

export interface Dataset {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
  embedding_model: string;
  permission: 'me' | 'team';
  chunk_method: string;
  chunk_count: number;
  document_count: number;
  create_time: string;
  update_time: string;
  parser_config?: any;
  pagerank?: number;
  language?: string;
  similarity_threshold?: number;
  vector_similarity_weight?: number;
}

export interface Document {
  id: string;
  name: string;
  display_name: string;
  thumbnail?: string;
  dataset_id: string;
  chunk_method: string;
  source_type: string;
  type: string;
  created_by: string;
  size: number;
  token_count: number;
  chunk_count: number;
  progress: number;
  progress_msg: string;
  process_begin_at?: string;
  process_duration: number;
  run: 'UNSTART' | 'RUNNING' | 'CANCEL' | 'DONE' | 'FAIL';
  status: string;
  parser_config?: any;
  meta_fields?: Record<string, any>;
  // 添加时间相关字段
  created_at?: string;
  updated_at?: string;
  create_time?: string;
  update_time?: string;
}

export interface Chunk {
  id: string;
  content: string;
  important_keywords: string[];
  create_time: string;
  create_timestamp: number;
  dataset_id: string;
  document_name: string;
  document_id: string;
  available: boolean;
  // 检索时的额外字段
  img_id?: string;
  position?: string[];
  similarity?: number;
  vector_similarity?: number;
  term_similarity?: number;
}

export interface ChatAssistant {
  id: string;
  name: string;
  avatar: string;
  dataset_ids: string[];
  llm: LLMSettings;
  prompt: PromptSettings;
  create_time: string;
  update_time: string;
}

export interface LLMSettings {
  model_name?: string;
  temperature: number;
  top_p: number;
  presence_penalty: number;
  frequency_penalty: number;
}

export interface PromptSettings {
  similarity_threshold: number;
  keywords_similarity_weight: number;
  vector_similarity_weight: number;
  top_n: number;
  variables: Array<{key: string; optional: boolean}>;
  rerank_model?: string;
  top_k: number;
  empty_response?: string;
  opener: string;
  show_quote: boolean;
  prompt?: string;
}

export interface Session {
  id: string;
  name: string;
  messages: Message[];
  chat_id?: string;
  agent_id?: string;
  create_time?: string;
  update_time?: string;
  message_count?: number;
  role_avatar_url?: string;
  role_background_url?: string;
}

export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  reference?: Reference[];
  create_time?: string;
}

export interface Reference {
  id: string;
  content: string;
  img_id?: string;
  image_id?: string;
  document_id: string;
  document_name: string;
  position: string[];
  dataset_id: string;
  similarity: number;
  vector_similarity: number;
  term_similarity: number;
  url?: string;
  doc_type?: string;
}

// Agent 相关类型 (新增)
export interface Agent {
  id: string;
  title: string;
  description?: string;
  dsl: any;
  create_time?: string;
  update_time?: string;
  created_by?: string;
}

// API响应类型
export interface RAGFlowResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

export interface ListResponse<T> {
  data: T[];
  total: number;
}

// 上传文档的参数
export interface UploadDocumentParams {
  display_name: string;
  blob: Blob;
}

// 创建知识库的参数
export interface CreateDatasetParams {
  name: string;
  avatar?: string;
  description?: string;
  embedding_model?: string;
  permission?: 'me' | 'team';
  chunk_method?: string;
  parser_config?: any;
}

// 更新知识库的参数
export interface UpdateDatasetParams {
  name?: string;
  avatar?: string;
  description?: string;
  embedding_model?: string;
  permission?: 'me' | 'team';
  pagerank?: number;
  chunk_method?: string;
  parser_config?: any;
}

// 检索参数
export interface RetrieveParams {
  question: string;
  dataset_ids?: string[];
  document_ids?: string[];
  page?: number;
  page_size?: number;
  similarity_threshold?: number;
  vector_similarity_weight?: number;
  top_k?: number;
  rerank_id?: string;
  keyword?: boolean;
  highlight?: boolean;
  cross_languages?: string[];
}

// OpenAI 兼容 API 类型 (新增)
export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatCompletionMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  reference?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      reference?: any;
    };
    finish_reason: string;
    logprobs?: any;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reference?: any;
      final_content?: string;
    };
    finish_reason?: string;
    logprobs?: any;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
} 