// API配置
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://192.168.161.103:8000';  // 默认本地开发地址

// RAGFlow 配置
export const RAGFLOW_BASE_URL = import.meta.env.VITE_RAGFLOW_BASE_URL || '';  // RAGFlow 服务地址
export const RAGFLOW_DEFAULT_API_KEY = import.meta.env.VITE_RAGFLOW_DEFAULT_API_KEY || '';  // RAGFlow 默认 API Key

// 获取完整的API URL
export const getFullUrl = (path?: string) => {
    if (!path) {
        return API_BASE_URL;
    }
    
    if (path.startsWith('http')) {
        return path;  // 如果是完整URL，直接返回
    }
    
    // 确保API_BASE_URL不为空
    const baseUrl = API_BASE_URL || 'http://localhost:8000';
    return `${baseUrl}${path}`;
}; 