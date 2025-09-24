from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import sys
from .routers import auth, chat, ragflow, verification
from .utils.init_app import init_app
from .database import init_indexes, close_db_connection

# 初始化应用
init_app()

app = FastAPI()

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 确保音频目录存在
os.makedirs(os.path.join("temp", "audio"), exist_ok=True)

# 挂载音频文件目录
app.mount("/audio", StaticFiles(directory=os.path.join("temp", "audio")), name="audio")

# 注册路由
app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(ragflow.router, prefix="/api", tags=["ragflow"])
from .routers import kb as kb_router
app.include_router(kb_router.router, prefix="/api", tags=["kb"])
app.include_router(verification.router, tags=["verification"])

@app.get("/")
async def root():
    return {"message": "Welcome to Fish Chat API"}

@app.on_event("startup")
async def startup_event():
    """应用启动时的初始化操作"""
    import time
    start_time = time.time()
    
    # 数据库索引初始化
    await init_indexes()
    
    init_time = time.time() - start_time
    print(f"🚀 应用初始化完成，耗时: {init_time:.2f}秒")
    
    # 静默模式下，仅输出一条"后端启动成功"到真实stdout
    _silence = (
        os.getenv("SILENCE_BACKEND_LOGS", "").strip() in {"1", "true", "True"}
        or os.getenv("ENV", "").lower() == "production"
    )
    if _silence:
        try:
            sys.__stdout__.write("后端服务器启动成功【后续所有日志已经被屏蔽】\n")
            sys.__stdout__.flush()
        except Exception:
            pass 