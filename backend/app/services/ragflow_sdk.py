"""
RAGFlow Python SDK Service
处理只能通过Python SDK实现的功能，如文档上传
"""
import os
import logging
from typing import List, Dict, Any, Optional
from ragflow_sdk import RAGFlow

logger = logging.getLogger(__name__)

class RAGFlowSDKService:
    def __init__(self, api_key: str, base_url: str):
        self.api_key = api_key
        self.base_url = base_url
        self._client = None
    
    def _get_client(self) -> RAGFlow:
        """获取RAGFlow客户端实例"""
        if self._client is None:
            logger.info(f"RAGFlow SDK: 初始化客户端 - base_url: {self.base_url}")
            self._client = RAGFlow(api_key=self.api_key, base_url=self.base_url)
        return self._client
    
    def upload_documents(self, dataset_id: str, documents: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        上传文档到指定数据集
        
        Args:
            dataset_id: 数据集ID
            documents: 文档列表，每个文档包含 display_name 和 blob
            
        Returns:
            上传结果
        """
        logger.info("=" * 80)
        logger.info("🚀 RAGFlow SDK: 开始上传文档")
        logger.info(f"📊 参数验证:")
        logger.info(f"   dataset_id: {dataset_id}")
        logger.info(f"   dataset_id type: {type(dataset_id)}")
        logger.info(f"   documents count: {len(documents) if documents else 'None'}")
        logger.info(f"   documents type: {type(documents)}")
        
        if not dataset_id:
            logger.error("❌ 数据集ID为空")
            raise ValueError("数据集ID不能为空")
            
        if not documents or not isinstance(documents, list):
            logger.error(f"❌ 文档列表无效: {documents}")
            raise ValueError("文档列表不能为空")
        
        for i, doc in enumerate(documents):
            logger.info(f"📄 文档 {i+1}:")
            logger.info(f"   display_name: {doc.get('display_name', 'N/A')}")
            logger.info(f"   blob type: {type(doc.get('blob', 'N/A'))}")
            logger.info(f"   blob size: {len(doc.get('blob', [])) if doc.get('blob') else 'N/A'}")
            
        try:
            logger.info(f"RAGFlow SDK: 开始上传 {len(documents)} 个文档到数据集 {dataset_id}")
            
            logger.info("🔗 RAGFlow SDK: 获取客户端...")
            client = self._get_client()
            logger.info(f"✅ RAGFlow SDK: 客户端获取成功 - {type(client)}")
            
            # 获取数据集
            logger.info(f"📊 RAGFlow SDK: 查找数据集 {dataset_id}...")
            try:
                datasets = client.list_datasets(id=dataset_id)
                logger.info(f"📋 RAGFlow SDK: 数据集查询返回 {len(datasets) if datasets else 0} 个结果")
            except Exception as list_error:
                logger.error(f"❌ RAGFlow SDK: 查询数据集失败: {list_error}")
                logger.error(f"   错误类型: {type(list_error).__name__}")
                raise ValueError(f"查询数据集失败: {str(list_error)}")
            
            if not datasets:
                error_msg = f"数据集 {dataset_id} 未找到"
                logger.error(f"❌ RAGFlow SDK: {error_msg}")
                raise ValueError(error_msg)
            
            dataset = datasets[0]
            logger.info(f"✅ RAGFlow SDK: 找到数据集")
            logger.info(f"   名称: {getattr(dataset, 'name', 'unknown')}")
            logger.info(f"   ID: {getattr(dataset, 'id', 'unknown')}")
            logger.info(f"   类型: {type(dataset)}")
            
            # 验证和格式化文档数据
            logger.info("🔄 RAGFlow SDK: 开始验证和格式化文档数据...")
            formatted_documents = []
            for i, doc in enumerate(documents):
                logger.info(f"📝 RAGFlow SDK: 处理文档 {i+1}/{len(documents)}: {doc.get('display_name', 'N/A')}")
                
                # 检查必需字段
                if "display_name" not in doc or "blob" not in doc:
                    error_msg = f"文档 {i+1} 缺少必需字段 (display_name, blob)"
                    logger.error(f"❌ RAGFlow SDK: {error_msg}")
                    logger.error(f"   文档内容: {doc}")
                    raise ValueError(error_msg)
                
                if not doc["display_name"]:
                    error_msg = f"文档 {i+1} 的 display_name 为空"
                    logger.error(f"❌ RAGFlow SDK: {error_msg}")
                    raise ValueError(error_msg)
                
                if not doc["blob"]:
                    error_msg = f"文档 {i+1} 的 blob 为空"
                    logger.error(f"❌ RAGFlow SDK: {error_msg}")
                    raise ValueError(error_msg)
                
                # 确保blob是bytes类型
                blob_data = doc["blob"]
                original_type = type(blob_data)
                logger.info(f"   原始blob类型: {original_type}")
                logger.info(f"   原始blob大小: {len(blob_data) if hasattr(blob_data, '__len__') else 'unknown'}")
                
                if isinstance(blob_data, str):
                    logger.info("   转换字符串blob为bytes...")
                    blob_data = blob_data.encode('utf-8')
                elif not isinstance(blob_data, bytes):
                    logger.error(f"❌ RAGFlow SDK: 文档 {i+1} blob类型错误: {type(blob_data)}")
                    logger.error(f"   blob内容preview: {str(blob_data)[:100]}...")
                    raise ValueError(f"文档 {i+1} blob必须是bytes类型")
                
                # 创建格式化的文档对象
                formatted_doc = {
                    "display_name": doc["display_name"],
                    "blob": blob_data
                }
                
                formatted_documents.append(formatted_doc)
                logger.info(f"✅ RAGFlow SDK: 文档 {i+1} 格式化完成")
                logger.info(f"   文件名: {doc['display_name']}")
                logger.info(f"   最终大小: {len(blob_data)} bytes")
                logger.info(f"   最终类型: {type(blob_data)}")
            
            logger.info(f"📋 RAGFlow SDK: 所有文档格式化完成，共 {len(formatted_documents)} 个")
            
            # 调用RAGFlow SDK上传文档
            logger.info("🚀 RAGFlow SDK: 开始调用 dataset.upload_documents()")
            logger.info(f"📄 RAGFlow SDK: 上传文档列表: {[doc['display_name'] for doc in formatted_documents]}")
            logger.info(f"📊 RAGFlow SDK: 数据集对象: {dataset}")
            logger.info(f"📊 RAGFlow SDK: 数据集方法: {[method for method in dir(dataset) if not method.startswith('_')]}")
            
            try:
                # 根据RAGFlow Python API文档，upload_documents不返回值
                dataset.upload_documents(formatted_documents)
                logger.info("✅ RAGFlow SDK: upload_documents 调用完成")
            except Exception as upload_error:
                logger.error(f"❌ RAGFlow SDK: upload_documents 调用失败: {upload_error}")
                logger.error(f"   错误类型: {type(upload_error).__name__}")
                import traceback
                logger.error(f"   错误堆栈: {traceback.format_exc()}")
                raise
            
            # 验证上传结果（获取新上传的文档）
            logger.info("RAGFlow SDK: 验证上传结果...")
            uploaded_docs = []
            
            # 获取数据集中的文档列表来验证上传
            try:
                all_docs = dataset.list_documents(page=1, page_size=100)
                for uploaded_doc in formatted_documents:
                    # 查找匹配的文档名
                    for doc in all_docs:
                        if hasattr(doc, 'name') and doc.name == uploaded_doc['display_name']:
                            uploaded_docs.append({
                                "id": doc.id,
                                "display_name": doc.name,
                                "size": getattr(doc, 'size', 0),
                                "status": getattr(doc, 'run', 'UNKNOWN')
                            })
                            break
                logger.info(f"RAGFlow SDK: 验证找到 {len(uploaded_docs)} 个上传的文档")
            except Exception as verify_error:
                logger.warning(f"RAGFlow SDK: 无法验证上传结果: {verify_error}")
                # 如果验证失败，仍然返回成功结果
                uploaded_docs = [{"display_name": doc["display_name"]} for doc in formatted_documents]
            
            # 上传成功后返回结果
            result = {
                "code": 200,
                "message": "文档上传成功",
                "data": {
                    "uploaded_count": len(formatted_documents),
                    "documents": uploaded_docs
                }
            }
            logger.info(f"RAGFlow SDK: 上传成功，返回结果: {result}")
            return result
            
        except Exception as e:
            logger.error(f"RAGFlow SDK upload error: {str(e)}")
            logger.error(f"RAGFlow SDK error type: {type(e).__name__}")
            import traceback
            logger.error(f"RAGFlow SDK traceback: {traceback.format_exc()}")
            
            # 根据错误类型提供更具体的错误信息
            if "not found" in str(e).lower():
                raise Exception(f"数据集或资源未找到: {str(e)}")
            elif "permission" in str(e).lower() or "unauthorized" in str(e).lower():
                raise Exception(f"权限错误: {str(e)}")
            elif "invalid" in str(e).lower():
                raise Exception(f"数据格式错误: {str(e)}")
            else:
                raise Exception(f"文档上传失败: {str(e)}")
    
    def parse_documents(self, dataset_id: str, document_ids: List[str]) -> Dict[str, Any]:
        """
        解析指定数据集中的文档
        
        Args:
            dataset_id: 数据集ID
            document_ids: 要解析的文档ID列表
            
        Returns:
            解析结果
        """
        logger.info("=" * 80)
        logger.info("🔄 RAGFlow SDK: 开始解析文档")
        logger.info(f"📊 参数验证:")
        logger.info(f"   dataset_id: {dataset_id}")
        logger.info(f"   document_ids: {document_ids}")
        logger.info(f"   document_ids count: {len(document_ids) if document_ids else 0}")
        
        if not dataset_id:
            logger.error("❌ 数据集ID为空")
            raise ValueError("数据集ID不能为空")
            
        if not document_ids or not isinstance(document_ids, list):
            logger.error(f"❌ 文档ID列表无效: {document_ids}")
            raise ValueError("文档ID列表不能为空")
        
        try:
            logger.info("🔗 RAGFlow SDK: 获取客户端...")
            client = self._get_client()
            logger.info(f"✅ RAGFlow SDK: 客户端获取成功 - {type(client)}")
            
            # 获取数据集
            logger.info(f"📊 RAGFlow SDK: 查找数据集 {dataset_id}...")
            try:
                datasets = client.list_datasets(id=dataset_id)
                logger.info(f"📋 RAGFlow SDK: 数据集查询返回 {len(datasets) if datasets else 0} 个结果")
            except Exception as list_error:
                logger.error(f"❌ RAGFlow SDK: 查询数据集失败: {list_error}")
                logger.error(f"   错误类型: {type(list_error).__name__}")
                raise ValueError(f"查询数据集失败: {str(list_error)}")
            
            if not datasets:
                error_msg = f"数据集 {dataset_id} 未找到"
                logger.error(f"❌ RAGFlow SDK: {error_msg}")
                raise ValueError(error_msg)
            
            dataset = datasets[0]
            logger.info(f"✅ RAGFlow SDK: 找到数据集")
            logger.info(f"   名称: {getattr(dataset, 'name', 'unknown')}")
            logger.info(f"   ID: {getattr(dataset, 'id', 'unknown')}")
            logger.info(f"   类型: {type(dataset)}")
            
            # 验证文档ID是否存在
            logger.info("📄 RAGFlow SDK: 验证文档ID...")
            all_docs = dataset.list_documents(page=1, page_size=1000)
            existing_doc_ids = [doc.id for doc in all_docs]
            logger.info(f"📋 RAGFlow SDK: 数据集中共有 {len(existing_doc_ids)} 个文档")
            
            missing_ids = [doc_id for doc_id in document_ids if doc_id not in existing_doc_ids]
            if missing_ids:
                error_msg = f"以下文档ID不存在: {missing_ids}"
                logger.error(f"❌ RAGFlow SDK: {error_msg}")
                raise ValueError(error_msg)
            
            logger.info(f"✅ RAGFlow SDK: 所有文档ID验证通过")
            
            # 调用解析方法
            logger.info("🚀 RAGFlow SDK: 开始调用 dataset.async_parse_documents()")
            logger.info(f"📄 RAGFlow SDK: 解析文档ID列表: {document_ids}")
            
            try:
                # 根据RAGFlow Python API文档，async_parse_documents不返回值
                dataset.async_parse_documents(document_ids)
                logger.info("✅ RAGFlow SDK: async_parse_documents 调用完成")
            except Exception as parse_error:
                logger.error(f"❌ RAGFlow SDK: async_parse_documents 调用失败: {parse_error}")
                logger.error(f"   错误类型: {type(parse_error).__name__}")
                import traceback
                logger.error(f"   错误堆栈: {traceback.format_exc()}")
                raise
            
            # 解析成功后返回结果
            result = {
                "code": 200,
                "message": "文档解析已开始",
                "data": {
                    "dataset_id": dataset_id,
                    "document_ids": document_ids,
                    "parse_count": len(document_ids)
                }
            }
            logger.info(f"RAGFlow SDK: 解析启动成功，返回结果: {result}")
            return result
            
        except Exception as e:
            logger.error(f"RAGFlow SDK parse error: {str(e)}")
            logger.error(f"RAGFlow SDK error type: {type(e).__name__}")
            import traceback
            logger.error(f"RAGFlow SDK traceback: {traceback.format_exc()}")
            
            # 根据错误类型提供更具体的错误信息
            if "not found" in str(e).lower():
                raise Exception(f"数据集或文档未找到: {str(e)}")
            elif "permission" in str(e).lower() or "unauthorized" in str(e).lower():
                raise Exception(f"权限错误: {str(e)}")
            elif "invalid" in str(e).lower():
                raise Exception(f"参数错误: {str(e)}")
            else:
                raise Exception(f"文档解析失败: {str(e)}")
    
    def cancel_parse_documents(self, dataset_id: str, document_ids: List[str]) -> Dict[str, Any]:
        """
        取消解析指定数据集中的文档
        
        Args:
            dataset_id: 数据集ID
            document_ids: 要取消解析的文档ID列表
            
        Returns:
            取消解析结果
        """
        logger.info("=" * 80)
        logger.info("⏹️ RAGFlow SDK: 开始取消文档解析")
        logger.info(f"📊 参数验证:")
        logger.info(f"   dataset_id: {dataset_id}")
        logger.info(f"   document_ids: {document_ids}")
        logger.info(f"   document_ids count: {len(document_ids) if document_ids else 0}")
        
        if not dataset_id:
            logger.error("❌ 数据集ID为空")
            raise ValueError("数据集ID不能为空")
            
        if not document_ids or not isinstance(document_ids, list):
            logger.error(f"❌ 文档ID列表无效: {document_ids}")
            raise ValueError("文档ID列表不能为空")
        
        try:
            logger.info("🔗 RAGFlow SDK: 获取客户端...")
            client = self._get_client()
            logger.info(f"✅ RAGFlow SDK: 客户端获取成功 - {type(client)}")
            
            # 获取数据集
            logger.info(f"📊 RAGFlow SDK: 查找数据集 {dataset_id}...")
            try:
                datasets = client.list_datasets(id=dataset_id)
                logger.info(f"📋 RAGFlow SDK: 数据集查询返回 {len(datasets) if datasets else 0} 个结果")
            except Exception as list_error:
                logger.error(f"❌ RAGFlow SDK: 查询数据集失败: {list_error}")
                logger.error(f"   错误类型: {type(list_error).__name__}")
                raise ValueError(f"查询数据集失败: {str(list_error)}")
            
            if not datasets:
                error_msg = f"数据集 {dataset_id} 未找到"
                logger.error(f"❌ RAGFlow SDK: {error_msg}")
                raise ValueError(error_msg)
            
            dataset = datasets[0]
            logger.info(f"✅ RAGFlow SDK: 找到数据集")
            logger.info(f"   名称: {getattr(dataset, 'name', 'unknown')}")
            logger.info(f"   ID: {getattr(dataset, 'id', 'unknown')}")
            logger.info(f"   类型: {type(dataset)}")
            
            # 调用取消解析方法
            logger.info("⏹️ RAGFlow SDK: 开始调用 dataset.async_cancel_parse_documents()")
            logger.info(f"📄 RAGFlow SDK: 取消解析文档ID列表: {document_ids}")
            
            try:
                # 根据RAGFlow Python API文档，async_cancel_parse_documents不返回值
                dataset.async_cancel_parse_documents(document_ids)
                logger.info("✅ RAGFlow SDK: async_cancel_parse_documents 调用完成")
            except Exception as cancel_error:
                logger.error(f"❌ RAGFlow SDK: async_cancel_parse_documents 调用失败: {cancel_error}")
                logger.error(f"   错误类型: {type(cancel_error).__name__}")
                import traceback
                logger.error(f"   错误堆栈: {traceback.format_exc()}")
                raise
            
            # 取消成功后返回结果
            result = {
                "code": 200,
                "message": "文档解析已取消",
                "data": {
                    "dataset_id": dataset_id,
                    "document_ids": document_ids,
                    "cancel_count": len(document_ids)
                }
            }
            logger.info(f"RAGFlow SDK: 取消解析成功，返回结果: {result}")
            return result
            
        except Exception as e:
            logger.error(f"RAGFlow SDK cancel parse error: {str(e)}")
            logger.error(f"RAGFlow SDK error type: {type(e).__name__}")
            import traceback
            logger.error(f"RAGFlow SDK traceback: {traceback.format_exc()}")
            
            # 根据错误类型提供更具体的错误信息
            if "not found" in str(e).lower():
                raise Exception(f"数据集或文档未找到: {str(e)}")
            elif "permission" in str(e).lower() or "unauthorized" in str(e).lower():
                raise Exception(f"权限错误: {str(e)}")
            elif "invalid" in str(e).lower():
                raise Exception(f"参数错误: {str(e)}")
            else:
                raise Exception(f"取消文档解析失败: {str(e)}")
    
    def download_document(self, dataset_id: str, document_id: str) -> bytes:
        """
        下载文档
        
        Args:
            dataset_id: 数据集ID
            document_id: 文档ID
            
        Returns:
            文档的二进制内容
        """
        try:
            client = self._get_client()
            
            # 获取数据集
            datasets = client.list_datasets(id=dataset_id)
            if not datasets:
                raise ValueError(f"数据集 {dataset_id} 未找到")
            
            dataset = datasets[0]
            
            # 获取文档列表并找到指定文档
            documents = dataset.list_documents(id=document_id)
            if not documents:
                raise ValueError(f"文档 {document_id} 未找到")
            
            document = documents[0]
            
            # 下载文档
            content = document.download()
            return content
            
        except Exception as e:
            logger.error(f"RAGFlow SDK download error: {str(e)}")
            raise Exception(f"文档下载失败: {str(e)}")
    
    def list_documents(self, dataset_id: str) -> Dict[str, Any]:
        """
        列出数据集中的所有文档
        
        Args:
            dataset_id: 数据集ID
            
        Returns:
            包含文档列表的字典
        """
        logger.info(f"RAGFlow SDK: 列出数据集 {dataset_id} 中的文档")
        
        try:
            client = self._get_client()
            
            # 获取数据集
            datasets = client.list_datasets(id=dataset_id)
            if not datasets:
                raise ValueError(f"数据集 {dataset_id} 未找到")
            
            dataset = datasets[0]
            
            # 获取文档列表
            documents = dataset.list_documents()
            
            # 转换为字典格式
            docs_list = []
            for doc in documents:
                doc_dict = {
                    'id': getattr(doc, 'id', ''),
                    'name': getattr(doc, 'name', ''),
                    'size': getattr(doc, 'size', 0),
                    'type': getattr(doc, 'type', ''),
                    'run': getattr(doc, 'run', ''),
                    'status': getattr(doc, 'status', ''),
                    'progress': getattr(doc, 'progress', 0),
                    'progress_msg': getattr(doc, 'progress_msg', ''),
                    'chunk_num': getattr(doc, 'chunk_num', 0),
                    'create_time': getattr(doc, 'create_time', ''),
                    'update_time': getattr(doc, 'update_time', ''),
                }
                docs_list.append(doc_dict)
            
            logger.info(f"RAGFlow SDK: 成功获取 {len(docs_list)} 个文档")
            
            return {
                'success': True,
                'docs': docs_list,
                'total': len(docs_list)
            }
            
        except Exception as e:
            logger.error(f"RAGFlow SDK: 获取文档列表失败: {str(e)}")
            import traceback
            logger.error(f"完整错误堆栈: {traceback.format_exc()}")
            raise

# 全局SDK服务实例
_sdk_service: Optional[RAGFlowSDKService] = None

def get_ragflow_sdk_service() -> RAGFlowSDKService:
    """获取RAGFlow SDK服务实例"""
    global _sdk_service
    if _sdk_service is None:
        # 从配置文件获取设置
        from ..config import settings
        
        api_key = settings.RAGFLOW_API_KEY
        base_url = settings.RAGFLOW_BASE_URL
        
        if not api_key:
            raise ValueError("配置中缺少 RAGFLOW_API_KEY")
            
        _sdk_service = RAGFlowSDKService(api_key, base_url)
    
    return _sdk_service 