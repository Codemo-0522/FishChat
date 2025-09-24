import axios from 'axios';

// 创建专门用于认证的axios实例
const authAxios = axios.create();

// 添加请求拦截器
authAxios.interceptors.request.use(
  (config) => {
    // 从 localStorage 获取认证数据
    const authData = localStorage.getItem('auth-storage');
    if (authData) {
      try {
        const { state } = JSON.parse(authData);
        if (state.token) {
          config.headers.Authorization = `Bearer ${state.token}`;
        }
      } catch (error) {
        console.error('解析认证数据失败:', error);
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default authAxios; 