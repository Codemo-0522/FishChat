import React, { useState } from 'react';
import { Layout, Button, Switch, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  MoreOutlined,
  PictureOutlined,
  AudioOutlined,
  AudioMutedOutlined,
  PhoneOutlined,
  VideoCameraOutlined
} from '@ant-design/icons';
import styles from './Call.module.css';
import { useNavigate } from 'react-router-dom';

const Call: React.FC = () => {
  const navigate = useNavigate();
  // const sessionId = location.state?.sessionId;
  const [showSubtitle, setShowSubtitle] = useState(true);
  const [isAudioMuted, setIsAudioMuted] = useState(false);

  const handleHangup = () => {
    navigate('/chat');
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'background',
      icon: <PictureOutlined />,
      label: '更换背景'
    }
  ];

  return (
    <Layout className={styles.callLayout}>
      {/* 顶部菜单区域 */}
      <div className={styles.topBar}>
        <Dropdown menu={{ items: menuItems }} trigger={['click']}>
          <Button type="text" className={styles.menuButton} icon={<MoreOutlined />} />
        </Dropdown>
        <Switch
          checkedChildren="字幕"
          unCheckedChildren="字幕"
          defaultChecked
          onChange={setShowSubtitle}
        />
      </div>

      {/* 中间内容区域 */}
      <div className={styles.content}>
        <div className={styles.circleContainer} />
        
        <div className={styles.status}>
          正在对话...
        </div>

        {showSubtitle && (
          <div className={styles.subtitle}>
            你可以开始说话
          </div>
        )}
      </div>

      {/* 底部控制栏 */}
      <div className={styles.bottomBar}>
        <Button 
          icon={isAudioMuted ? <AudioMutedOutlined /> : <AudioOutlined />}
          size="large"
          onClick={() => setIsAudioMuted(!isAudioMuted)}
        />
        <Button 
          className={styles.hangupBtn}
          icon={<PhoneOutlined />}
          size="large"
          onClick={handleHangup}
        />
        <Button 
          icon={<VideoCameraOutlined />} 
          size="large"
        />
      </div>
    </Layout>
  );
};

export default Call; 