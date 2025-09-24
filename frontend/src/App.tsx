import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useThemeStore } from './stores/themeStore';
import { useRAGFlowStore } from './stores/ragflowStore';
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import Chat from './pages/Chat/Chat';
import Call from './pages/Call/Call';
import RAGFlowManage from './pages/RAGFlow/RAGFlowManage';
import './styles/themes.css';

// 受保护的路由组件
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const App: React.FC = () => {
  const { initializeAuth, isAuthenticated } = useAuthStore();
  const { initializeTheme } = useThemeStore();
  const { initializeConnection } = useRAGFlowStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        await initializeAuth();
        initializeTheme(); // 初始化主题
      } catch (error) {
        console.error('Failed to initialize app:', error);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [initializeAuth, initializeTheme]);

  // 单独处理RAG Flow初始化，只在用户已登录时执行
  useEffect(() => {
    if (isAuthenticated) {
      initializeConnection().catch(error => {
        console.error('Failed to initialize RAG Flow connection:', error);
      });
    }
  }, [isAuthenticated, initializeConnection]);

  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        Loading...
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            isAuthenticated ? (
              <Navigate to="/chat" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/login"
          element={
            isAuthenticated ? <Navigate to="/chat" replace /> : <Login />
          }
        />
        <Route
          path="/register"
          element={
            isAuthenticated ? <Navigate to="/chat" replace /> : <Register />
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <Chat />
            </ProtectedRoute>
          }
        />
        <Route
          path="/call"
          element={
            <ProtectedRoute>
              <Call />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ragflow"
          element={
            <ProtectedRoute>
              <RAGFlowManage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
};

export default App; 