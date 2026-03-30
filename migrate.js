const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./database');

const SALT_ROUNDS = 10;
const JSON_FILE = path.join(__dirname, 'users.json');

console.log('开始迁移用户数据...\n');

// 检查 JSON 文件是否存在
if (!fs.existsSync(JSON_FILE)) {
    console.log('未找到 users.json 文件，无需迁移。');
    process.exit(0);
}

// 读取 JSON 数据
const data = fs.readFileSync(JSON_FILE, 'utf8');
const users = JSON.parse(data);

console.log(`找到 ${users.length} 个用户需要迁移\n`);

// 准备插入语句
const insertStmt = db.prepare(`
    INSERT INTO users (first_name, last_name, student_id, email, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
`);

let successCount = 0;
let skipCount = 0;

// 迁移每个用户
for (const user of users) {
    try {
        // 检查用户是否已存在（通过邮箱）
        const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email);
        
        if (existingUser) {
            console.log(`⏭️  跳过: ${user.email} (已存在)`);
            skipCount++;
            continue;
        }

        // 加密明文密码
        const passwordHash = bcrypt.hashSync(user.password, SALT_ROUNDS);

        // 插入数据库
        insertStmt.run(
            user.firstName,
            user.lastName,
            user.studentId || null,
            user.email,
            passwordHash,
            user.createdAt
        );

        console.log(`✅ 迁移成功: ${user.email}`);
        successCount++;

    } catch (error) {
        console.error(`❌ 迁移失败: ${user.email}`, error.message);
    }
}

console.log('\n=================================');
console.log(`迁移完成！`);
console.log(`成功: ${successCount} 个用户`);
console.log(`跳过: ${skipCount} 个用户`);
console.log(`总计: ${users.length} 个用户`);
console.log('=================================\n');

// 备份原始 JSON 文件
const backupFile = path.join(__dirname, 'users.json.backup');
fs.copyFileSync(JSON_FILE, backupFile);
console.log(`✅ 原始数据已备份到: ${backupFile}`);
console.log('   如需恢复，请手动重命名该文件\n');
