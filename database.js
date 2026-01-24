const Database = require('better-sqlite3');
const path = require('path');

// 创建或打开数据库文件
const db = new Database(path.join(__dirname, 'users.db'), { verbose: console.log });

// 启用 WAL 模式以支持并发访问，避免数据库锁定
db.pragma('journal_mode = WAL');

// 创建用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 创建验证码表（可选，用于持久化验证码）
db.exec(`
  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expiry DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 创建活动记录表（IG Finisher Program）
db.exec(`
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    file_paths TEXT NOT NULL,
    file_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES users(email)
  )
`);

// 创建用户支付状态表
db.exec(`
  CREATE TABLE IF NOT EXISTS user_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT UNIQUE NOT NULL,
    payment_status TEXT DEFAULT 'pending',
    payment_proof_path TEXT,
    submitted_at DATETIME,
    approved_at DATETIME,
    approved_by TEXT,
    is_free_user INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES users(email)
  )
`);

// 创建索引以提高查询性能
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);
  CREATE INDEX IF NOT EXISTS idx_activities_user_email ON activities(user_email);
  CREATE INDEX IF NOT EXISTS idx_user_payments_email ON user_payments(user_email);
  CREATE INDEX IF NOT EXISTS idx_user_payments_status ON user_payments(payment_status);
`);

console.log('数据库初始化完成！');

module.exports = db;
