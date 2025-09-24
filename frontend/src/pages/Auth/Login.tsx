import React from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { AxiosError } from 'axios';
import styles from './Auth.module.css';

interface LoginForm {
  identifier: string;  // 可以是账号或邮箱
  password: string;
}

interface ErrorResponse {
  detail: string;
}

const Login: React.FC = () => {
  const navigate = useNavigate();
  const login = useAuthStore((state) =>state.login);
  const [form] = Form.useForm();

  const onFinish = async (values: LoginForm) => {
    try {
      await login(values.identifier, values.password);
      message.success('登录成功！');
      navigate('/');
    } catch (error) {
      const axiosError = error as AxiosError<ErrorResponse>;
      if (axiosError.response?.data) {
        message.error(axiosError.response.data.detail || '登录失败，请检查账号/邮箱和密码！');
      } else {
        message.error('登录失败，请检查账号/邮箱和密码！');
      }
    }
  };

  // 验证输入是否为有效的邮箱或账号
  const validateIdentifier = (_: any, value: string) => {
    if (!value) {
      return Promise.reject(new Error('请输入账号或邮箱！'));
    }
    
    // 邮箱格式验证
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    // 账号格式验证（3-20位字母数字下划线）
    const accountRegex = /^[a-zA-Z0-9_]{3,20}$/;
    
    if (emailRegex.test(value) || accountRegex.test(value)) {
      return Promise.resolve();
    }
    
    return Promise.reject(new Error('请输入有效的账号（3-20位字母数字下划线）或邮箱地址！'));
  };

  return (
    <div className={styles.authContainer}>
      <Card className={styles.authCard}>
        <h1 className={styles.title}>登录</h1>
        <Form
          name="login"
          form={form}
          initialValues={{ remember: true }}
          onFinish={onFinish}
          layout="vertical"
          size="large"
          onFinishFailed={({ errorFields }) => {
            if (errorFields && errorFields.length > 0) {
              const first = errorFields[0];
              const msg = (first.errors && first.errors[0]) || '请检查表单输入！';
              message.error(msg);
            }
          }}
        >
          <Form.Item
            name="identifier"
            rules={[{ validator: validateIdentifier }]}
            help={null}
            validateTrigger={[]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="账号或邮箱"
              className={styles.input}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码！' }]}
            help={null}
            validateTrigger={[]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              className={styles.input}
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              block
              className={styles.button}
              onClick={async () => {
                try {
                  const values = await form.validateFields();
                  await onFinish(values);
                } catch (err: any) {
                  const first = err?.errorFields?.[0];
                  const msg = (first?.errors && first.errors[0]) || '请检查表单输入！';
                  message.error(msg);
                }
              }}
            >
              登录
            </Button>
          </Form.Item>

          <div className={styles.tips}>
            <p>💡 支持使用账号或邮箱登录</p>
            <p>账号格式：3-20位字母、数字、下划线</p>
            <p>邮箱格式：有效的邮箱地址</p>
          </div>

          <div className={styles.links}>
            <Link to="/register">还没有账号？立即注册</Link>
          </div>
        </Form>
      </Card>
    </div>
  );
  };

export default Login; 