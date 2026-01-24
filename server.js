const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = 3000;
const SALT_ROUNDS = 10; // bcrypt 加密强度

// 配置文件上传目录
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 配置 multer 文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // 生成唯一文件名：时间戳-随机数-原文件名
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 限制50MB
    fileFilter: (req, file, cb) => {
        // 允许的文件类型
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('只支持图片和视频文件！'));
        }
    }
});

// 验证码存储 (内存中，key: email, value: {code, expiry})
const verificationCodes = new Map();

// 中间件
app.use(cors());
app.use(express.json());

// 生成5位数验证码
function generateVerificationCode() {
    return Math.floor(10000 + Math.random() * 90000).toString();
}

// 邮件配置 - 使用学校邮箱（腾讯企业邮箱）
// ⚠️ 重要：腾讯企业邮箱需要使用"授权码"，不是登录密码！
// 获取授权码步骤：
// 1. 登录 https://exmail.qq.com
// 2. 设置 → 客户端设置 → 生成授权码
const transporter = nodemailer.createTransport({
    host: 'smtp.exmail.qq.com',  // 学校的SMTP服务器
    port: 465,                    // SSL端口
    secure: true,                 // 使用SSL加密
    auth: {
        user: 's230026055@mail.bnbu.edu.cn',   // 你的学校邮箱
        pass: 'Huang5415'             // ⚠️ 这里应该填写"授权码"，不是登录密码！
    },
    debug: true,  // 开启调试模式
    logger: true  // 开启日志
});

// 数据库操作函数

// 通过邮箱查找用户
function findUserByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email);
}

// 创建新用户
function createUser(firstName, lastName, email, passwordHash) {
    const stmt = db.prepare(`
        INSERT INTO users (first_name, last_name, email, password_hash)
        VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(firstName, lastName, email, passwordHash);
    return result.lastInsertRowid;
}

// 验证用户登录
function verifyUser(email, password) {
    const user = findUserByEmail(email);
    if (!user) return null;
    
    const isValid = bcrypt.compareSync(password, user.password_hash);
    return isValid ? user : null;
}

// 路由：发送验证码
app.post('/api/send-verification-code', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: '請提供電子郵件' });
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: '請輸入有效的電子郵件地址' });
    }

    // 生成验证码和过期时间 (2分钟)
    const code = generateVerificationCode();
    const expiry = Date.now() + 2 * 60 * 1000; // 2分钟后过期

    // 存储验证码
    verificationCodes.set(email, { code, expiry });

    // 打印到控制台（方便测试）
    console.log(`\n========== 验证码 ==========`);
    console.log(`邮箱: ${email}`);
    console.log(`验证码: ${code}`);
    console.log(`有效期至: ${new Date(expiry).toLocaleString('zh-CN')}`);
    console.log(`=============================\n`);

    // 同时保存到文件（方便查看）
    const logMessage = `\n[${new Date().toLocaleString('zh-CN')}]\n邮箱: ${email}\n验证码: ${code}\n有效期至: ${new Date(expiry).toLocaleString('zh-CN')}\n${'='.repeat(40)}\n`;
    fs.appendFileSync(path.join(__dirname, 'verification-codes.log'), logMessage);

    // 真实发送邮件
    const mailOptions = {
        from: transporter.options.auth.user,  // 使用配置的发件邮箱
        to: email,
        subject: '【代代共荣】註冊驗證碼',
        html: `
            <h2>歡迎註冊代代共荣</h2>
            <p>您的驗證碼是：<strong style="font-size: 24px; color: #F58A42;">${code}</strong></p>
            <p>驗證碼將在 2 分鐘內有效，請儘快完成註冊。</p>
        `
    };
    
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('邮件发送失败:', error);
            // 不返回500错误，继续执行测试模式
        }
        console.log('邮件发送成功:', info.messageId);
    });

    // 测试模式（已启用）
    res.json({ success: true, message: '驗證碼已發送（請查看控制台）' });
});

// 路由：注册
app.post('/api/register', (req, res) => {
    const { firstName, lastName, email, password, verificationCode } = req.body;

    if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ success: false, message: '所有欄位都是必填的' });
    }

    if (!verificationCode) {
        return res.status(400).json({ success: false, message: '請輸入驗證碼' });
    }

    // 验证验证码
    const storedData = verificationCodes.get(email);
    
    if (!storedData) {
        return res.status(400).json({ success: false, message: '請先獲取驗證碼' });
    }

    // 检查验证码是否过期
    if (Date.now() > storedData.expiry) {
        verificationCodes.delete(email);
        return res.status(400).json({ success: false, message: '驗證碼已過期，請重新獲取' });
    }

    // 检查验证码是否正确
    if (storedData.code !== verificationCode) {
        return res.status(400).json({ success: false, message: '驗證碼錯誤' });
    }

    // 验证码正确，删除已使用的验证码
    verificationCodes.delete(email);

    // 检查邮箱是否已存在
    const existingUser = findUserByEmail(email);
    if (existingUser) {
        return res.status(409).json({ success: false, message: '該電子郵件已被註冊' });
    }

    // 加密密码
    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

    // 创建新用户
    try {
        const userId = createUser(firstName, lastName, email, passwordHash);
        console.log(`新用户注册: ${email} (ID: ${userId})`);
        res.json({ success: true, message: '註冊成功', user: { firstName, lastName, email } });
    } catch (error) {
        console.error('注册失败:', error);
        res.status(500).json({ success: false, message: '註冊失敗，請稍後再試' });
    }
});

// 路由：登录
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: '請輸入電子郵件和密碼' });
    }

    // 验证用户
    const user = verifyUser(email, password);

    if (user) {
        console.log(`用户登录成功: ${email}${user.is_admin ? ' (管理员)' : ''}`);
        res.json({ 
            success: true, 
            message: '登入成功', 
            user: { 
                firstName: user.first_name,  // 注意：数据库字段是 snake_case
                lastName: user.last_name, 
                email: user.email,
                isAdmin: user.is_admin === 1  // 管理员标识
            } 
        });
    } else {
        res.status(401).json({ success: false, message: '電子郵件或密碼錯誤' });
    }
});

// --- IG Finisher Program 支付验证 API ---

// 辅助函数：检查用户是否有活动权限
function checkUserPermission(email) {
    // 1. 检查是否是管理员
    const userStmt = db.prepare('SELECT is_admin FROM users WHERE email = ?');
    const user = userStmt.get(email);
    
    if (user && user.is_admin === 1) {
        return { hasPermission: true, isAdmin: true };
    }

    // 2. 检查是否是免费用户（@mail.bnbu.edu.cn 后缀）
    if (email.endsWith('@mail.bnbu.edu.cn')) {
        return { hasPermission: true, isFreeUser: true };
    }

    // 3. 查询支付状态
    const stmt = db.prepare('SELECT payment_status FROM user_payments WHERE user_email = ?');
    const payment = stmt.get(email);

    if (!payment) {
        return { hasPermission: false, needsPayment: true };
    }

    return {
        hasPermission: payment.payment_status === 'approved',
        paymentStatus: payment.payment_status
    };
}

// 获取用户支付状态
app.get('/api/payment-status/:email', (req, res) => {
    const { email } = req.params;

    try {
        const permission = checkUserPermission(email);
        
        if (permission.isFreeUser) {
            // 免费用户，自动创建记录
            const checkStmt = db.prepare('SELECT * FROM user_payments WHERE user_email = ?');
            const existing = checkStmt.get(email);
            
            if (!existing) {
                const insertStmt = db.prepare(`
                    INSERT INTO user_payments (user_email, payment_status, is_free_user)
                    VALUES (?, 'approved', 1)
                `);
                insertStmt.run(email);
            }
            
            return res.json({
                success: true,
                hasPermission: true,
                isFreeUser: true,
                message: '您是学校用户，无需支付即可参加活动'
            });
        }

        // 查询支付记录
        const stmt = db.prepare('SELECT payment_status, submitted_at FROM user_payments WHERE user_email = ?');
        const payment = stmt.get(email);

        if (!payment) {
            return res.json({
                success: true,
                hasPermission: false,
                needsPayment: true,
                message: '需要上传支付凭证'
            });
        }

        res.json({
            success: true,
            hasPermission: payment.payment_status === 'approved',
            paymentStatus: payment.payment_status,
            submittedAt: payment.submitted_at,
            message: payment.payment_status === 'approved' ? '已審核通過' :
                     payment.payment_status === 'pending' ? '等待管理員審核' : 
                     '需要上传支付凭证'
        });
    } catch (error) {
        console.error('查询支付状态失败:', error);
        res.status(500).json({ success: false, message: '查詢失敗' });
    }
});

// 上传支付凭证
app.post('/api/submit-payment', upload.single('proof'), (req, res) => {
    const { userEmail } = req.body;

    if (!userEmail || !req.file) {
        return res.status(400).json({ success: false, message: '請提供完整資訊' });
    }

    try {
        // 检查是否已经有记录
        const checkStmt = db.prepare('SELECT * FROM user_payments WHERE user_email = ?');
        const existing = checkStmt.get(userEmail);

        if (existing) {
            // 更新记录
            const updateStmt = db.prepare(`
                UPDATE user_payments 
                SET payment_proof_path = ?, submitted_at = CURRENT_TIMESTAMP, payment_status = 'pending'
                WHERE user_email = ?
            `);
            updateStmt.run(req.file.filename, userEmail);
        } else {
            // 插入新记录
            const insertStmt = db.prepare(`
                INSERT INTO user_payments (user_email, payment_proof_path, submitted_at, payment_status)
                VALUES (?, ?, CURRENT_TIMESTAMP, 'pending')
            `);
            insertStmt.run(userEmail, req.file.filename);
        }

        console.log(`支付凭证已提交: ${userEmail}`);
        res.json({ success: true, message: '支付憑證已提交，請等待管理員審核' });
    } catch (error) {
        console.error('提交支付凭证失败:', error);
        res.status(500).json({ success: false, message: '提交失敗' });
    }
});

// --- IG Finisher Program 活动API ---

// 上传活动记录（添加权限检查）
app.post('/api/activities', upload.array('files', 5), async (req, res) => {
    const { title, description, userEmail } = req.body;

    if (!title || !description || !userEmail) {
        return res.status(400).json({ success: false, message: '請提供完整的活動資訊' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: '請至少上傳一個檔案' });
    }

    // 权限检查
    const permission = checkUserPermission(userEmail);
    if (!permission.hasPermission) {
        if (permission.needsPayment) {
            return res.status(403).json({ 
                success: false, 
                message: '您需要先上傳支付憑證才能參加活動',
                needsPayment: true
            });
        } else if (permission.paymentStatus === 'pending') {
            return res.status(403).json({ 
                success: false, 
                message: '您的支付憑證正在審核中，請耐心等待',
                pending: true
            });
        } else {
            return res.status(403).json({ 
                success: false, 
                message: '您暫時無權參加此活動' 
            });
        }
    }

    try {
        // 保存文件路径（相对路径，方便后续访问）
        const filePaths = req.files.map(file => file.filename);
        const filePathsJson = JSON.stringify(filePaths);

        // 插入数据库
        const stmt = db.prepare(`
            INSERT INTO activities (user_email, title, description, file_paths, file_count)
            VALUES (?, ?, ?, ?, ?)
        `);

        const result = stmt.run(userEmail, title, description, filePathsJson, filePaths.length);

        console.log(`新活动记录: ${title} (用户: ${userEmail}, ID: ${result.lastInsertRowid})`);

        // 发送邮件通知用户
        try {
            // 获取用户信息
            const userStmt = db.prepare('SELECT first_name, last_name, email FROM users WHERE email = ?');
            const user = userStmt.get(userEmail);
            
            if (user) {
                const userName = `${user.last_name}${user.first_name}`;
                const currentTime = new Date().toLocaleString('zh-TW', { 
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false 
                });
                
                const mailOptions = {
                    from: '"代代共榮 Generation Co-prosperity" <s230026055@mail.bnbu.edu.cn>',
                    to: userEmail,
                    subject: '✅ 活動記錄已成功提交 - IG Finisher Program',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                            <div style="background-color: #FF6B35; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                                <h1 style="color: white; margin: 0; font-size: 28px;">🎉 活動記錄已成功提交</h1>
                            </div>
                            
                            <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                                <p style="font-size: 16px; color: #333; line-height: 1.6;">
                                    親愛的 <strong style="color: #FF6B35;">${userName}</strong>，您好！
                                </p>
                                
                                <p style="font-size: 16px; color: #333; line-height: 1.6;">
                                    感謝您參與 <strong>IG Finisher Program</strong> 活動！您的活動記錄已成功提交並保存。
                                </p>
                                
                                <div style="background-color: #FFF8F0; padding: 20px; border-left: 4px solid #FF6B35; margin: 20px 0;">
                                    <h3 style="color: #FF6B35; margin-top: 0;">📋 活動詳情</h3>
                                    <table style="width: 100%; border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 8px 0; color: #666; font-weight: bold; width: 100px;">活動標題：</td>
                                            <td style="padding: 8px 0; color: #333;">${title}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #666; font-weight: bold;">活動描述：</td>
                                            <td style="padding: 8px 0; color: #333;">${description}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #666; font-weight: bold;">上傳檔案：</td>
                                            <td style="padding: 8px 0; color: #333;">${filePaths.length} 個檔案</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #666; font-weight: bold;">提交時間：</td>
                                            <td style="padding: 8px 0; color: #333;">${currentTime}</td>
                                        </tr>
                                    </table>
                                </div>
                                
                                <p style="font-size: 16px; color: #333; line-height: 1.6;">
                                    您可以隨時登入系統查看您的活動記錄和上傳的檔案。
                                </p>
                                
                                <div style="background-color: #FFF8F0; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
                                    <p style="font-size: 14px; color: #666; margin: 0;">
                                        💡 請返回您剛才提交活動的網頁<br>
                                        即可查看您的活動記錄
                                    </p>
                                </div>
                                
                                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                                
                                <p style="font-size: 14px; color: #999; text-align: center; margin: 0;">
                                    此郵件由系統自動發送，請勿回覆。<br>
                                    如有任何問題，請聯繫我們的客服團隊。
                                </p>
                                
                                <p style="font-size: 14px; color: #999; text-align: center; margin-top: 20px;">
                                    © 2024 代代共榮 Generation Co-prosperity. All rights reserved.
                                </p>
                            </div>
                        </div>
                    `
                };
                
                await transporter.sendMail(mailOptions);
                console.log(`✅ 活动提交确认邮件已发送至: ${userEmail}`);
            }
        } catch (emailError) {
            console.error('发送邮件失败:', emailError);
            // 邮件发送失败不影响活动记录的保存，只记录错误
        }

        res.json({
            success: true,
            message: '活動記錄已成功提交',
            activityId: result.lastInsertRowid
        });
    } catch (error) {
        console.error('保存活动失败:', error);
        res.status(500).json({ success: false, message: '保存失敗，請稍後再試' });
    }
});

// 查询用户的活动记录
app.get('/api/activities/:email', (req, res) => {
    const { email } = req.params;

    try {
        const stmt = db.prepare(`
            SELECT id, title, description, file_count, created_at
            FROM activities
            WHERE user_email = ?
            ORDER BY created_at DESC
        `);

        const activities = stmt.all(email);

        res.json({
            success: true,
            activities: activities
        });
    } catch (error) {
        console.error('查询活动失败:', error);
        res.status(500).json({ success: false, message: '查詢失敗' });
    }
});

// --- 管理员审核 API ---

// 获取待审核的支付凭证列表
app.get('/api/admin/pending-payments', (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT 
                p.id,
                p.user_email,
                p.payment_proof_path,
                p.submitted_at,
                u.first_name,
                u.last_name
            FROM user_payments p
            LEFT JOIN users u ON p.user_email = u.email
            WHERE p.payment_status = 'pending'
            ORDER BY p.submitted_at ASC
        `);

        const payments = stmt.all();

        res.json({
            success: true,
            payments: payments
        });
    } catch (error) {
        console.error('查询待审核支付失败:', error);
        res.status(500).json({ success: false, message: '查詢失敗' });
    }
});

// 审核支付凭证（批准或拒绝）
app.post('/api/admin/review-payment', (req, res) => {
    const { userEmail, action, notes, adminEmail } = req.body;

    if (!userEmail || !action || !adminEmail) {
        return res.status(400).json({ success: false, message: '請提供完整資訊' });
    }

    if (action !== 'approve' && action !== 'reject') {
        return res.status(400).json({ success: false, message: '無效的操作' });
    }

    try {
        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        
        const stmt = db.prepare(`
            UPDATE user_payments
            SET payment_status = ?,
                approved_at = CURRENT_TIMESTAMP,
                approved_by = ?,
                notes = ?
            WHERE user_email = ?
        `);

        stmt.run(newStatus, adminEmail, notes || null, userEmail);

        console.log(`支付审核: ${userEmail} - ${action} (by ${adminEmail})`);

        res.json({
            success: true,
            message: action === 'approve' ? '已批准' : '已拒絕'
        });
    } catch (error) {
        console.error('审核支付失败:', error);
        res.status(500).json({ success: false, message: '審核失敗' });
    }
});

// 获取所有活动记录（管理员）
app.get('/api/admin/all-activities', (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT 
                a.id,
                a.user_email,
                a.title,
                a.description,
                a.file_paths,
                a.file_count,
                a.created_at,
                u.first_name,
                u.last_name
            FROM activities a
            LEFT JOIN users u ON a.user_email = u.email
            ORDER BY a.created_at DESC
        `);

        const activities = stmt.all();

        res.json({
            success: true,
            activities: activities.map(act => ({
                ...act,
                file_paths: JSON.parse(act.file_paths)
            }))
        });
    } catch (error) {
        console.error('查询所有活动失败:', error);
        res.status(500).json({ success: false, message: '查詢失敗' });
    }
});

// 获取所有上传文件列表（管理员）
app.get('/api/admin/all-files', (req, res) => {
    const fs = require('fs');
    
    try {
        // 获取文件系统中的所有文件
        const files = fs.readdirSync(UPLOAD_DIR);
        
        // 查询数据库获取文件关联的用户信息
        const stmt = db.prepare(`
            SELECT 
                a.file_paths,
                a.user_email,
                u.first_name,
                u.last_name
            FROM activities a
            LEFT JOIN users u ON a.user_email = u.email
        `);
        const activities = stmt.all();
        
        // 创建文件名到用户的映射
        const fileUserMap = {};
        activities.forEach(act => {
            const filePaths = JSON.parse(act.file_paths);
            filePaths.forEach(filename => {
                fileUserMap[filename] = {
                    email: act.user_email,
                    firstName: act.first_name,
                    lastName: act.last_name
                };
            });
        });
        
        // 查询支付凭证文件
        const paymentStmt = db.prepare(`
            SELECT 
                p.payment_proof_path,
                p.user_email,
                u.first_name,
                u.last_name
            FROM user_payments p
            LEFT JOIN users u ON p.user_email = u.email
            WHERE p.payment_proof_path IS NOT NULL
        `);
        const payments = paymentStmt.all();
        payments.forEach(pay => {
            if (pay.payment_proof_path) {
                fileUserMap[pay.payment_proof_path] = {
                    email: pay.user_email,
                    firstName: pay.first_name,
                    lastName: pay.last_name,
                    isPaymentProof: true
                };
            }
        });
        
        // 组合文件信息和用户信息
        const fileDetails = files.map(filename => {
            const stats = fs.statSync(path.join(UPLOAD_DIR, filename));
            const userInfo = fileUserMap[filename] || {};
            
            return {
                filename: filename,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                userEmail: userInfo.email || '未知',
                userName: userInfo.firstName && userInfo.lastName 
                    ? `${userInfo.lastName}${userInfo.firstName}` 
                    : '未知',
                isPaymentProof: userInfo.isPaymentProof || false
            };
        });

        res.json({
            success: true,
            files: fileDetails
        });
    } catch (error) {
        console.error('获取文件列表失败:', error);
        res.status(500).json({ success: false, message: '獲取失敗' });
    }
});

// 提供静态文件访问（用于查看上传的图片/视频）
app.use('/uploads', express.static(UPLOAD_DIR));

// 启动服务器
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
