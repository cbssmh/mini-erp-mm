from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2
import redis
import jwt
import datetime
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.hash import bcrypt
import os

# -------------------------
# 환경 변수
# -------------------------
def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value

DB_HOST = os.getenv("DB_HOST", "db")
DB_USER = required_env("DB_USER")
DB_PASSWORD = required_env("DB_PASSWORD")
DB_NAME = required_env("DB_NAME")
JWT_SECRET = required_env("JWT_SECRET")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

# -------------------------
# DB 연결
# -------------------------
def get_db():
    conn = psycopg2.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        dbname=DB_NAME
    )
    return conn

# -------------------------
# Redis 연결
# -------------------------
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

# -------------------------
# FastAPI 기본 설정
# -------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "auth-service"}

security = HTTPBearer()

# -------------------------
# 요청 모델
# -------------------------
class RegisterRequest(BaseModel):
    username: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str


# -------------------------
# JWT 생성
# -------------------------
def create_token(username: str):
    payload = {
        "username": username,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=6)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    return token


# -------------------------
# 회원가입
# -------------------------
@app.post("/register")
def register(data: RegisterRequest):
    conn = get_db()
    cur = conn.cursor()

    hashed_pw = bcrypt.hash(data.password)

    cur.execute("INSERT INTO users (username, password_hash) VALUES (%s, %s)", 
                (data.username, hashed_pw))
    conn.commit()

    cur.close()
    conn.close()

    return {"message": "Registered successfully."}


# -------------------------
# 로그인
# -------------------------
@app.post("/login")
def login(data: LoginRequest):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT user_id, password_hash FROM users WHERE username=%s", 
                (data.username,))
    user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=400, detail="Invalid username or password")

    user_id, pw_hash = user
    if not bcrypt.verify(data.password, pw_hash):
        raise HTTPException(status_code=400, detail="Invalid username or password")

    token = create_token(data.username)

    # Redis 세션 저장
    r.set(f"session:{data.username}", token, ex=21600)

    return {"token": token}


# -------------------------
# 회원 정보 조회
# -------------------------
@app.get("/me")
def me(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials

    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        username = decoded["username"]

        # Redis에서 세션 확인
        saved_token = r.get(f"session:{username}")
        if saved_token != token:
            raise HTTPException(status_code=403, detail="Session expired")

        return {"username": username}

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=403, detail="Token expired")

    except Exception:
        raise HTTPException(status_code=403, detail="Invalid token")
