from motor.motor_asyncio import AsyncIOMotorClient
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
import logging
from bson import ObjectId

from ..models.ragflow_message import RAGFlowSession, RAGFlowMessage, ReferenceChunk, SaveMessageRequest

logger = logging.getLogger(__name__)


class RAGFlowMessageService:
	def __init__(self, db: AsyncIOMotorClient):
		self.db = db
		self.collection = db.fish_chat.ragflow_sessions

	async def get_session(self, session_id: str, user_id: str) -> Optional[RAGFlowSession]:
		"""获取现有会话（不创建新会话）"""
		try:
			# 构建查询条件 - 支持多种session_id格式
			query_conditions = [
				{"session_id": session_id, "user_id": user_id},  # 标准格式
				{"_id": session_id, "user_id": user_id}          # 字符串_id格式
			]
			
			# 如果session_id是有效的ObjectId字符串，也尝试用ObjectId查询
			if ObjectId.is_valid(session_id):
				query_conditions.append({"_id": ObjectId(session_id), "user_id": user_id})
			
			existing = await self.collection.find_one({
				"$or": query_conditions
			})
			
			if existing:
				# 确保会话有messages字段（兼容旧数据）
				if "messages" not in existing:
					existing["messages"] = []
				if "message_count" not in existing:
					existing["message_count"] = 0
				
				# 统一session_id字段
				if "session_id" not in existing:
					existing["session_id"] = str(existing["_id"])
				
				return RAGFlowSession(**existing)
			return None
				
		except Exception as e:
			logger.error(f"获取会话失败: {str(e)}")
			return None

	async def save_conversation(
		self,
		session_id: str,
		assistant_id: str,
		user_id: str,
		user_message: str,
		assistant_message: str,
		reference: Optional[List[Dict[str, Any]]] = None,
		assistant_message_id: Optional[str] = None
	) -> bool:
		"""保存一轮完整对话（用户消息 + 助手回复）"""
		try:
			logger.info(f"🔍 开始保存对话 - 会话ID: {session_id}, 用户ID: {user_id}, 助手ID: {assistant_id}")
			
			# 直接保存消息，不需要验证会话是否存在
			# 如果会话不存在，update操作会失败，我们可以在那时处理
			
			# 创建用户消息
			user_msg = RAGFlowMessage(
				message_id=str(uuid.uuid4()),
				role="user",
				content=user_message,
				reference=[],
				timestamp=datetime.utcnow()
			)
			
			# 处理引用数据
			processed_references = []
			if reference:
				logger.info(f"准备处理引用数据: 收到 {len(reference)} 个引用")
				processed_references = self._process_references(reference)
				logger.info(f"处理引用数据完成: 合法 {len(processed_references)} 个，丢弃 {len(reference) - len(processed_references)} 个")
				if processed_references:
					logger.debug(f"引用示例: {processed_references[0].dict()}")
			
			# 创建助手消息
			assistant_msg = RAGFlowMessage(
				message_id=assistant_message_id or str(uuid.uuid4()),
				role="assistant", 
				content=assistant_message,
				reference=processed_references,
				timestamp=datetime.utcnow()
			)
			
			# 批量保存两条消息 - 支持多种会话ID格式
			update_conditions = [
				{"session_id": session_id, "user_id": user_id},  # 标准格式
				{"_id": session_id, "user_id": user_id}          # 字符串_id格式
			]
			
			# 如果session_id是有效的ObjectId，也尝试ObjectId格式
			if ObjectId.is_valid(session_id):
				update_conditions.append({"_id": ObjectId(session_id), "user_id": user_id})
			
			update_filter = {"$or": update_conditions}
			logger.info(f"🔍 保存对话使用的过滤条件: {update_filter}")
			
			# 先检查会话是否存在，用于调试
			logger.info(f"🔍 开始检查会话是否存在...")
			existing_session = await self.collection.find_one(update_filter)
			if existing_session:
				logger.info(f"✅ 找到现有会话: {existing_session.get('_id')}, 名称: {existing_session.get('name')}")
				logger.info(f"📊 会话详情: user_id={existing_session.get('user_id')}, session_id={existing_session.get('session_id')}")
			else:
				logger.error(f"❌ 未找到匹配的会话!")
				
				# 尝试查找所有相关会话进行调试
				logger.info(f"🔍 开始调试查询...")
				
				# 查找该用户的所有会话
				user_sessions = await self.collection.find({"user_id": user_id}).to_list(None)
				logger.info(f"🔍 该用户({user_id})共有 {len(user_sessions)} 个会话:")
				for session in user_sessions:
					logger.info(f"  - 会话ID: {session.get('_id')}, session_id字段: {session.get('session_id')}, 名称: {session.get('name')}")
				
				# 查找所有包含该session_id的会话（不限用户）
				session_matches = await self.collection.find({
					"$or": [
						{"session_id": session_id},
						{"_id": session_id}
					]
				}).to_list(None)
				logger.info(f"🔍 所有匹配session_id({session_id})的会话共 {len(session_matches)} 个:")
				for session in session_matches:
					logger.info(f"  - 用户ID: {session.get('user_id')}, 会话ID: {session.get('_id')}, session_id字段: {session.get('session_id')}")
			
			result = await self.collection.update_one(
				update_filter,
				{
					"$push": {
						"messages": {
							"$each": [
								user_msg.dict(by_alias=True, exclude_unset=True),
								assistant_msg.dict(by_alias=True, exclude_unset=True)
							]
						}
					},
					"$inc": {"message_count": 2},
					"$set": {"updated_at": datetime.now().isoformat()}
				}
			)
			
			logger.info(f"更新结果: matched={result.matched_count}, modified={result.modified_count}")
			if result.modified_count > 0:
				logger.info(f"保存对话成功: 会话 {session_id}, 新增2条消息 (引用数: {len(processed_references)})")
				return True
			else:
				logger.error(f"保存对话失败: 会话 {session_id} 未找到或未修改 (引用数: {len(processed_references)})")
				return False
				
		except Exception as e:
			logger.error(f"保存对话失败: {str(e)}")
			return False

	async def get_session_messages(
		self, 
		session_id: str, 
		user_id: str,
		limit: Optional[int] = None
	) -> List[RAGFlowMessage]:
		"""获取会话的消息历史"""
		try:
			# 构建查询条件 - 支持多种会话ID格式
			query_conditions = [
				{"session_id": session_id, "user_id": user_id},  # 标准格式
				{"_id": session_id, "user_id": user_id}          # 字符串_id格式
			]
			
			# 如果session_id是有效的ObjectId字符串，也尝试用ObjectId查询
			if ObjectId.is_valid(session_id):
				query_conditions.append({"_id": ObjectId(session_id), "user_id": user_id})
			
			# 构建查询管道 - 支持两种会话ID格式
			pipeline = [
				{
					"$match": {
						"$or": query_conditions
					}
				},
				{
					"$project": {
						"messages": 1
					}
				}
			]
			
			if limit:
				pipeline.append({
					"$project": {
						"messages": {"$slice": ["$messages", -limit]}
					}
				})
			
			result = await self.collection.aggregate(pipeline).to_list(1)
			
			if result and result[0].get("messages"):
				messages = []
				for msg_data in result[0]["messages"]:
					# 处理引用数据
					if msg_data.get("reference"):
						references = []
						for ref in msg_data["reference"]:
							if isinstance(ref, dict):
								references.append(ReferenceChunk(**ref))
						msg_data["reference"] = references
					
					messages.append(RAGFlowMessage(**msg_data))
				
				logger.info(f"获取会话消息成功: {session_id}, 共{len(messages)}条消息")
				return messages
			else:
				logger.info(f"会话 {session_id} 暂无消息")
				return []
				
		except Exception as e:
			logger.error(f"获取会话消息失败: {str(e)}")
			return []

	async def get_user_sessions(
		self, 
		user_id: str, 
		page: int = 1, 
		page_size: int = 20
	) -> List[RAGFlowSession]:
		"""获取用户的会话列表"""
		try:
			skip = (page - 1) * page_size
			
			cursor = self.collection.find(
				{"user_id": user_id},
				{"messages": 0}  # 不返回消息内容，只返回会话基本信息
			).sort("updated_at", -1).skip(skip).limit(page_size)
			
			sessions = []
			async for session_data in cursor:
				# 兼容处理
				if "session_id" not in session_data:
					session_data["session_id"] = str(session_data["_id"])
				if "messages" not in session_data:
					session_data["messages"] = []
				if "message_count" not in session_data:
					session_data["message_count"] = 0
					
				sessions.append(RAGFlowSession(**session_data))
			
			logger.info(f"获取用户会话列表成功: 用户 {user_id}, 共{len(sessions)}个会话")
			return sessions
			
		except Exception as e:
			logger.error(f"获取用户会话列表失败: {str(e)}")
			return []

	async def delete_session(self, session_id: str, user_id: str) -> bool:
		"""删除会话"""
		try:
			# 支持两种会话ID格式
			result = await self.collection.delete_one({
				"$or": [
					{"_id": session_id, "user_id": user_id},
					{"session_id": session_id, "user_id": user_id}
				]
			})
			
			if result.deleted_count > 0:
				logger.info(f"删除会话成功: {session_id}")
				return True
			else:
				logger.warning(f"删除会话失败: 会话 {session_id} 不存在")
				return False
				
		except Exception as e:
			logger.error(f"删除会话失败: {str(e)}")
			return False

	def _process_references(self, references: List[Dict[str, Any]]) -> List[ReferenceChunk]:
		"""处理引用数据"""
		processed = []
		try:
			for idx, ref in enumerate(references):
				try:
					if isinstance(ref, dict):
						# 确保必需字段存在
						chunk_data = {
							"id": ref.get("id", ""),
							"content": ref.get("content", ""),
							"document_id": ref.get("document_id", ""),
							"document_name": ref.get("document_name", ""),
							"dataset_id": ref.get("dataset_id", ""),
							"position": ref.get("position", [])
						}
						
						# 统一 position 类型为字符串列表
						pos_val = chunk_data.get("position", [])
						if pos_val is None:
							pos_list = []
						elif isinstance(pos_val, list):
							pos_list = [str(p) for p in pos_val]
						else:
							pos_list = [str(pos_val)]
						chunk_data["position"] = pos_list
						
						# 添加可选字段
						optional_fields = [
							"img_id", "image_id", "similarity", 
							"vector_similarity", "term_similarity", 
							"url", "doc_type"
						]
						
						for field in optional_fields:
							if field in ref:
								chunk_data[field] = ref[field]
						
						processed.append(ReferenceChunk(**chunk_data))
				except Exception as single_err:
					logger.warning(f"单条引用解析失败 (index={idx}): {single_err}; 数据={ref}")
		except Exception as e:
			logger.error(f"处理引用数据失败: {str(e)}")
			
		return processed

	async def update_session_name(self, session_id: str, user_id: str, new_name: str) -> bool:
		"""更新会话名称"""
		try:
			# 支持两种会话ID格式
			result = await self.collection.update_one(
				{
					"$or": [
						{"_id": session_id, "user_id": user_id},
						{"session_id": session_id, "user_id": user_id}
					]
				},
				{
					"$set": {
						"name": new_name,  # 使用name字段与routers/ragflow.py保持一致
						"updated_at": datetime.now().isoformat()
					}
				}
			)
			
			if result.modified_count > 0:
				logger.info(f"更新会话名称成功: {session_id} -> {new_name}")
				return True
			else:
				logger.warning(f"更新会话名称失败: 会话 {session_id} 不存在")
				return False
				
		except Exception as e:
			logger.error(f"更新会话名称失败: {str(e)}")
			return False

	# 移除create_session和get_or_create_session方法
	# 会话创建统一由routers/ragflow.py中的create_assistant_session处理 