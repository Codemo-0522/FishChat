import re
from pymongo import MongoClient

def parse_chat_txt(file_path):
    """解析聊天记录TXT文件，动态识别会话名称并动态用于解析对话"""
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # 提取会话名称（模型名称）
    session_name_match = re.search(r'会话名称:\s*(.*?)\n', content)
    if not session_name_match:
        raise ValueError("未找到会话名称，请检查文件格式")
    
    model_name = session_name_match.group(1).strip()
    print(f"识别到会话名称（模型名称）: {model_name}")
    
    # 移除标题区域（从开头到第一个对话前的内容）
    header_end = re.search(r'\n\d+\.\s*我：', content)
    if not header_end:
        raise ValueError("未找到有效的对话内容")
    
    content = content[header_end.start():]
    
    # 分割所有对话块（以数字. 我：作为分隔符）
    conversation_blocks = re.split(r'\n\d+\.\s*我：', content)
    # 过滤空字符串
    conversation_blocks = [block.strip() for block in conversation_blocks if block.strip()]
    
    conversations = []
    
    for block in conversation_blocks:
        # 使用动态获取的模型名称作为分隔点
        # 构建正则表达式，允许模型名称前后有空白
        split_pattern = re.compile(r'\s*' + re.escape(model_name) + r'：\s*', re.IGNORECASE)
        parts = split_pattern.split(block, 1)  # 只分割一次
        
        if len(parts) == 2:
            user_input, model_output = parts
            
            # 清理内容，保留有意义的换行
            user_input = re.sub(r'\n{3,}', '\n\n', user_input.strip())
            model_output = re.sub(r'\n{3,}', '\n\n', model_output.strip())
            
            # 添加到对话列表
            conversations.append({
                "role": "user",
                "content": user_input,
                "images": []
            })
            conversations.append({
                "role": "assistant",
                "content": model_output,
                "images": []
            })
    
    return conversations

def import_to_mongodb(conversations, target_id):
    """将解析后的对话导入到MongoDB指定文档"""
    # 连接到MongoDB
    client = MongoClient('mongodb://localhost:27017/')  # 根据实际情况修改连接地址
    db = client['fish_chat']
    collection = db['chat_sessions']
    
    # 计算要添加的消息数量
    message_count = len(conversations)
    
    # 更新指定ID的文档
    result = collection.update_one(
        {"_id": target_id},
        {
            "$push": {
                "history": {
                    "$each": conversations  # 添加所有对话
                }
            },
            "$inc": {"message_count": message_count}  # 增加消息计数
        }
    )
    
    client.close()
    return result.modified_count > 0

if __name__ == "__main__":
    # 获取用户输入
    txt_file_path = input("请输入聊天记录TXT文件路径: ").strip()
    target_user_id = input("请输入要恢复对话的目标用户ID: ").strip()
    
    try:
        # 解析TXT文件
        print("正在解析TXT文件...")
        conversations = parse_chat_txt(txt_file_path)
        
        if not conversations:
            print("未从TXT文件中解析到任何对话内容")
        else:
            print(f"成功解析到 {len(conversations)//2} 组对话")
            
            # 导入到MongoDB
            print("正在导入到MongoDB...")
            success = import_to_mongodb(conversations, target_user_id)
            
            if success:
                print(f"成功将 {len(conversations)//2} 组对话恢复到ID为 {target_user_id} 的文档中")
            else:
                print(f"导入失败，请检查用户ID是否正确或MongoDB连接是否正常")
                
    except FileNotFoundError:
        print(f"错误：找不到文件 {txt_file_path}")
    except ValueError as ve:
        print(f"解析错误：{str(ve)}")
    except Exception as e:
        print(f"发生错误：{str(e)}")
    