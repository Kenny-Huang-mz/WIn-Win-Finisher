// 创建管理员账户脚本
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const SALT_ROUNDS = 10;
const db = new Database(path.join(__dirname, 'users.db'));

// 管理员信息
const ADMIN_EMAIL = 'admin123';
const ADMIN_PASSWORD = '123123';
const ADMIN_FIRSTNAME = '管理员';
const ADMIN_LASTNAME = '系统';

try {
    // 检查管理员是否已存在
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(ADMIN_EMAIL);
    
    if (existing) {
        console.log('管理员账户已存在！');
        
        // 更新为管理员权限
        db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(ADMIN_EMAIL);
        console.log('已更新管理员权限');
    } else {
        // 创建新管理员账户
        const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, SALT_ROUNDS);
        
        const stmt = db.prepare(`
            INSERT INTO users (first_name, last_name, email, password_hash, is_admin)
            VALUES (?, ?, ?, ?, 1)
        `);
        
        const result = stmt.run(ADMIN_FIRSTNAME, ADMIN_LASTNAME, ADMIN_EMAIL, passwordHash);
        
        console.log('✅ 管理员账户创建成功！');
        console.log(`邮箱: ${ADMIN_EMAIL}`);
        console.log(`密码: ${ADMIN_PASSWORD}`);
        console.log(`ID: ${result.lastInsertRowid}`);
    }
    
    // 确保管理员有支付权限
    const paymentCheck = db.prepare('SELECT * FROM user_payments WHERE user_email = ?').get(ADMIN_EMAIL);
    
    if (!paymentCheck) {
        db.prepare(`
            INSERT INTO user_payments (user_email, payment_status, is_free_user)
            VALUES (?, 'approved', 1)
        `).run(ADMIN_EMAIL);
        console.log('✅ 管理员支付权限已设置');
    }
    
} catch (error) {
    console.error('创建管理员失败:', error);
} finally {
    db.close();
}
