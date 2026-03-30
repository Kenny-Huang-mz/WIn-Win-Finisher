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
    student_id TEXT,
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
    task_id INTEGER,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    file_paths TEXT NOT NULL,
    file_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES users(email)
  )
`);

// 兼容升级：为 activities 增加 task_id 字段
const activityColumns = db.prepare("PRAGMA table_info(activities)").all();
const hasTaskIdColumn = activityColumns.some(col => col.name === 'task_id');
if (!hasTaskIdColumn) {
  db.exec('ALTER TABLE activities ADD COLUMN task_id INTEGER');
}

// 兼容升级：为 users 增加 10 任务里程碑邮件字段
const userColumns = db.prepare("PRAGMA table_info(users)").all();
const hasStudentIdColumn = userColumns.some(col => col.name === 'student_id');
const hasTenTaskNotified = userColumns.some(col => col.name === 'ten_task_notified');
const hasTenTaskNotifiedAt = userColumns.some(col => col.name === 'ten_task_notified_at');
if (!hasStudentIdColumn) {
  db.exec('ALTER TABLE users ADD COLUMN student_id TEXT');
}
if (!hasTenTaskNotified) {
  db.exec('ALTER TABLE users ADD COLUMN ten_task_notified INTEGER DEFAULT 0');
}
if (!hasTenTaskNotifiedAt) {
  db.exec('ALTER TABLE users ADD COLUMN ten_task_notified_at DATETIME');
}

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

// 创建微信支付订单表
db.exec(`
  CREATE TABLE IF NOT EXISTS payment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    out_trade_no TEXT UNIQUE NOT NULL,
    user_email TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_total INTEGER NOT NULL,
    currency TEXT DEFAULT 'CNY',
    status TEXT DEFAULT 'CREATED',
    code_url TEXT,
    transaction_id TEXT,
    raw_notify TEXT,
    paid_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES users(email)
  )
`);

// 创建每个任务的评分标准（AI 阅卷 prompt）
db.exec(`
  CREATE TABLE IF NOT EXISTS task_scoring_prompts (
    task_id INTEGER PRIMARY KEY,
    prompt TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 创建活动评分结果表
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_grades (
    activity_id INTEGER PRIMARY KEY,
    score REAL,
    feedback TEXT,
    raw_response TEXT,
    graded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )
`);

// 创建索引以提高查询性能
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id_unique ON users(student_id) WHERE student_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);
  CREATE INDEX IF NOT EXISTS idx_activities_user_email ON activities(user_email);
  CREATE INDEX IF NOT EXISTS idx_activities_task_id ON activities(task_id);
  CREATE INDEX IF NOT EXISTS idx_user_payments_email ON user_payments(user_email);
  CREATE INDEX IF NOT EXISTS idx_user_payments_status ON user_payments(payment_status);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_user_email ON payment_orders(user_email);
  CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
  CREATE INDEX IF NOT EXISTS idx_activity_grades_graded_at ON activity_grades(graded_at);
`);

// 初始化 20 个任务的默认评分标准（若不存在则补齐）
const defaultPromptTemplate = (taskId) => `你是 IG Finisher Program 的阅卷员。请只根据学员提交的活动描述进行评分。

任务编号：Task ${taskId}

评分要求：
1. 按 1-10 分评分（10 分最高）。
2. 重点关注：任务完成度、互动真实性、反思与收获。
3. 反馈应具体、简短、可执行，使用中文。
4. 只输出 JSON，不要输出其他内容。

输出格式：
{"score": 1-10 之间的数字, "feedback": "简短中文评语"}`;

const seedPromptStmt = db.prepare(`
  INSERT OR IGNORE INTO task_scoring_prompts (task_id, prompt, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
`);

const seedPromptsTx = db.transaction(() => {
  for (let taskId = 1; taskId <= 20; taskId++) {
    seedPromptStmt.run(taskId, defaultPromptTemplate(taskId));
  }
});
seedPromptsTx();

// 回填历史数据里的 task_id（标题格式：Task N: ...）
const legacyActivities = db.prepare(`
  SELECT id, title
  FROM activities
  WHERE task_id IS NULL AND title LIKE 'Task %:%'
`).all();

if (legacyActivities.length > 0) {
  const updateTaskStmt = db.prepare('UPDATE activities SET task_id = ? WHERE id = ?');
  const updateInTx = db.transaction((rows) => {
    for (const row of rows) {
      const match = /^Task\s+(\d+)\s*:/i.exec(row.title || '');
      if (!match) continue;
      const taskId = Number.parseInt(match[1], 10);
      if (Number.isInteger(taskId) && taskId >= 1 && taskId <= 20) {
        updateTaskStmt.run(taskId, row.id);
      }
    }
  });
  updateInTx(legacyActivities);
}

console.log('数据库初始化完成！');

module.exports = db;
