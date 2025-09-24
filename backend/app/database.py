from motor.motor_asyncio import AsyncIOMotorClient
from .config import settings
from typing import AsyncGenerator
import logging

# 配置日志
logger = logging.getLogger(__name__)

# MongoDB连接
client = AsyncIOMotorClient(settings.mongodb_url)
db = client[settings.mongodb_db_name]

# 数据库集合
users_collection = db.users
chat_sessions_collection = db.chat_sessions

async def get_database() -> AsyncIOMotorClient:
    """获取数据库连接"""
    return client

async def _check_index_exists(collection, index_name: str) -> bool:
    """检查索引是否已存在"""
    try:
        indexes = await collection.list_indexes().to_list(length=None)
        return any(index.get('name') == index_name for index in indexes)
    except Exception:
        return False

async def _create_index_if_not_exists(collection, index_spec, **kwargs):
    """如果索引不存在则创建"""
    try:
        # 创建索引，如果已存在MongoDB会自动忽略
        index_name = await collection.create_index(index_spec, **kwargs)
        return index_name
    except Exception as e:
        # 如果是索引已存在的错误，忽略它
        if "already exists" in str(e).lower() or "duplicate key" in str(e).lower():
            return None
        raise e

# 创建索引
async def init_indexes():
    """智能初始化数据库索引"""
    # 检查是否跳过索引初始化
    if settings.skip_index_check:
        print("⚡ 跳过数据库索引检查（SKIP_INDEX_CHECK=true）")
        logger.info("跳过数据库索引检查")
        return
    
    logger.info("开始检查和初始化数据库索引...")
    
    created_indexes = []
    skipped_indexes = []
    
    try:
        # 定义所有需要的索引
        index_configs = [
            # 用户集合索引
            {
                'collection': client.fish_chat.users,
                'collection_name': 'users',
                'spec': "account",
                'options': {'unique': True},
                'description': 'account唯一索引'
            },
            
            # 聊天会话集合索引
            {
                'collection': client.fish_chat.chat_sessions,
                'collection_name': 'chat_sessions',
                'spec': "user_id",
                'options': {},
                'description': 'user_id索引'
            },
            {
                'collection': client.fish_chat.chat_sessions,
                'collection_name': 'chat_sessions',
                'spec': "create_time",
                'options': {},
                'description': 'create_time索引'
            },
            
            # RAGFlow会话集合索引
            {
                'collection': client.fish_chat.ragflow_sessions,
                'collection_name': 'ragflow_sessions',
                'spec': [("session_id", 1), ("user_id", 1)],
                'options': {'unique': True},
                'description': 'session_id+user_id复合唯一索引'
            },
            {
                'collection': client.fish_chat.ragflow_sessions,
                'collection_name': 'ragflow_sessions',
                'spec': "user_id",
                'options': {},
                'description': 'user_id索引'
            },
            {
                'collection': client.fish_chat.ragflow_sessions,
                'collection_name': 'ragflow_sessions',
                'spec': "assistant_id",
                'options': {},
                'description': 'assistant_id索引'
            },
            {
                'collection': client.fish_chat.ragflow_sessions,
                'collection_name': 'ragflow_sessions',
                'spec': "update_time",
                'options': {},
                'description': 'update_time索引'
            },
            {
                'collection': client.fish_chat.ragflow_sessions,
                'collection_name': 'ragflow_sessions',
                'spec': "create_time",
                'options': {},
                'description': 'create_time索引'
            },
            
            # 消息查询优化索引
            {
                'collection': client.fish_chat.ragflow_sessions,
                'collection_name': 'ragflow_sessions',
                'spec': [("user_id", 1), ("update_time", -1)],
                'options': {},
                'description': 'user_id+update_time复合索引（查询优化）'
            }
        ]
        
        # 批量创建索引
        for config in index_configs:
            try:
                index_name = await _create_index_if_not_exists(
                    config['collection'], 
                    config['spec'], 
                    **config['options']
                )
                
                if index_name:
                    created_indexes.append(f"{config['collection_name']}.{config['description']}")
                    logger.debug(f"✓ 创建索引: {config['collection_name']}.{config['description']}")
                else:
                    skipped_indexes.append(f"{config['collection_name']}.{config['description']}")
                    
            except Exception as e:
                logger.warning(f"✗ 创建索引失败 {config['collection_name']}.{config['description']}: {e}")
        
        # 输出结果摘要
        if created_indexes:
            logger.info(f"✓ 成功创建 {len(created_indexes)} 个新索引")
            for idx in created_indexes:
                logger.debug(f"  - {idx}")
        
        if skipped_indexes:
            logger.debug(f"⚡ 跳过 {len(skipped_indexes)} 个已存在的索引")
        
        total_expected = len(index_configs)
        total_ready = len(created_indexes) + len(skipped_indexes)
        
        if total_ready == total_expected:
            print("数据库索引初始化成功")
            logger.info(f"数据库索引检查完成: {total_ready}/{total_expected} 个索引就绪")
        else:
            failed_count = total_expected - total_ready
            logger.warning(f"数据库索引初始化部分失败: {total_ready}/{total_expected} 个索引就绪，{failed_count} 个失败")
            
    except Exception as e:
        logger.error(f"数据库索引初始化过程出错: {e}")
        print(f"数据库索引初始化失败: {e}")

async def close_db_connection():
    """关闭数据库连接"""
    client.close()
    logger.info("数据库连接已关闭") 