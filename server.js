const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

// 固定20个跨代任务（用于活动提交校验）
const INTERGENERATIONAL_TASKS = [
    'Get to know an interesting, real story of an adult who is at least 40 years older than you.',
    'Learn to cook one dish from an older adult who is at least 30 years older than you.',
    'Take a walk in a park with a person who is at least 50 years older than you.',
    'Play a card or chess game with two to three older adults who are at least 35 years older than you.',
    'Ask a grandparent-like figure to talk about ONE old-time item (e.g., an old photo, an old watch, a retro walkman/music player, etc.) with you.',
    "Get to know a grandparent's childhood story.",
    'Sing a song with grandparents.',
    'Design a (festival) card and give it to your grandparent(s).',
    "Spend time with your or your friend's grandparents in a shopping mall or a coffee shop.",
    'Grow a pot of plants with your grandparent(s).',
    'Enjoy ice-cream with a grandparent or grandparent-like person.',
    'Serve a grandparent or grandparent-like person a cup of tea.',
    'Learn from a grandparent or grandparent-like person a kind of traditional craftsmanship.',
    "Consult a grandparent-like figure for their best advice for one's health.",
    "Consult a grandparent-like figure for their best advice for one's career.",
    'Share one of your secrets with a grandparent.',
    'When you feel sad, simply talk to your grandparent(s).',
    'Share a happy moment with your grandparent(s).',
    'Wear a funny dress with a person who is at least 40 years older than you, and take a photo together.',
    'Share a joke with a grandparent or a person who is at least 60 years older than you.'
];

// 中间件
app.use(cors());
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));

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

// 微信支付配置（请通过环境变量提供真实参数）
const WECHAT_PAY_CONFIG = {
    appid: process.env.WECHAT_APPID || '',
    mchid: process.env.WECHAT_MCHID || '',
    serialNo: process.env.WECHAT_SERIAL_NO || '',
    privateKeyPath: process.env.WECHAT_PRIVATE_KEY_PATH || '',
    apiV3Key: process.env.WECHAT_API_V3_KEY || '',
    notifyUrl: process.env.WECHAT_NOTIFY_URL || '',
    platformCertPath: process.env.WECHAT_PLATFORM_CERT_PATH || '',
    platformSerialNo: process.env.WECHAT_PLATFORM_SERIAL_NO || ''
};

const WECHAT_PAYMENT_AMOUNT_FEN = Number.parseInt(process.env.WECHAT_PAYMENT_AMOUNT_FEN || '9900', 10);
const WECHAT_PAYMENT_CURRENCY = process.env.WECHAT_PAYMENT_CURRENCY || 'CNY';
const WECHAT_PAYMENT_DESCRIPTION = process.env.WECHAT_PAYMENT_DESCRIPTION || 'IG Finisher Program 活动参加费';

let cachedWechatPrivateKey = null;
let cachedWechatPlatformPublicKey = null;

function resolveFilePath(filePath) {
    if (!filePath) return '';
    return path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
}

function readFileUtf8(filePath) {
    return fs.readFileSync(resolveFilePath(filePath), 'utf8');
}

function getWechatConfigErrors() {
    const missing = [];
    if (!WECHAT_PAY_CONFIG.appid) missing.push('WECHAT_APPID');
    if (!WECHAT_PAY_CONFIG.mchid) missing.push('WECHAT_MCHID');
    if (!WECHAT_PAY_CONFIG.serialNo) missing.push('WECHAT_SERIAL_NO');
    if (!WECHAT_PAY_CONFIG.privateKeyPath) missing.push('WECHAT_PRIVATE_KEY_PATH');
    if (!WECHAT_PAY_CONFIG.apiV3Key) missing.push('WECHAT_API_V3_KEY');
    if (!WECHAT_PAY_CONFIG.notifyUrl) missing.push('WECHAT_NOTIFY_URL');
    if (!WECHAT_PAY_CONFIG.platformCertPath) missing.push('WECHAT_PLATFORM_CERT_PATH');
    if (!Number.isInteger(WECHAT_PAYMENT_AMOUNT_FEN) || WECHAT_PAYMENT_AMOUNT_FEN <= 0) {
        missing.push('WECHAT_PAYMENT_AMOUNT_FEN(正整数)');
    }
    if (Buffer.byteLength(WECHAT_PAY_CONFIG.apiV3Key, 'utf8') !== 32) {
        missing.push('WECHAT_API_V3_KEY(必须32字节)');
    }
    return missing;
}

function getWechatPrivateKey() {
    if (!cachedWechatPrivateKey) {
        cachedWechatPrivateKey = readFileUtf8(WECHAT_PAY_CONFIG.privateKeyPath);
    }
    return cachedWechatPrivateKey;
}

function getWechatPlatformPublicKey() {
    if (!cachedWechatPlatformPublicKey) {
        const certPem = readFileUtf8(WECHAT_PAY_CONFIG.platformCertPath);
        cachedWechatPlatformPublicKey = crypto.createPublicKey(certPem);
    }
    return cachedWechatPlatformPublicKey;
}

function generateNonceStr() {
    return crypto.randomBytes(16).toString('hex');
}

function generateOutTradeNo() {
    const randomPart = crypto.randomBytes(4).toString('hex');
    return `GCP${Date.now()}${randomPart}`.slice(0, 32);
}

function buildWechatAuthorization(method, canonicalUrl, bodyText = '') {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const message = `${method}\n${canonicalUrl}\n${timestamp}\n${nonceStr}\n${bodyText}\n`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(message);
    signer.end();
    const signature = signer.sign(getWechatPrivateKey(), 'base64');

    return `WECHATPAY2-SHA256-RSA2048 mchid="${WECHAT_PAY_CONFIG.mchid}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${WECHAT_PAY_CONFIG.serialNo}",signature="${signature}"`;
}

async function requestWechatApi(method, canonicalUrl, body = null) {
    const bodyText = body ? JSON.stringify(body) : '';
    const headers = {
        Accept: 'application/json',
        Authorization: buildWechatAuthorization(method, canonicalUrl, bodyText),
        'User-Agent': 'generation-co-prosperity/1.0'
    };

    if (bodyText) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`https://api.mch.weixin.qq.com${canonicalUrl}`, {
        method,
        headers,
        body: bodyText || undefined
    });

    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            data = null;
        }
    }

    return { ok: response.ok, status: response.status, data, text };
}

function verifyWechatNotifySignature(rawBody, timestamp, nonce, signatureBase64) {
    const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(message);
    verifier.end();
    return verifier.verify(getWechatPlatformPublicKey(), signatureBase64, 'base64');
}

function decryptWechatNotifyResource(resource) {
    const cipherBuffer = Buffer.from(resource.ciphertext, 'base64');
    const authTag = cipherBuffer.subarray(cipherBuffer.length - 16);
    const encryptedData = cipherBuffer.subarray(0, cipherBuffer.length - 16);
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(WECHAT_PAY_CONFIG.apiV3Key, 'utf8'),
        Buffer.from(resource.nonce, 'utf8')
    );

    if (resource.associated_data) {
        decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    }
    decipher.setAuthTag(authTag);

    const plainText = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final()
    ]).toString('utf8');

    return JSON.parse(plainText);
}

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
            return;
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
    // 当前版本：活动免支付，登录用户可直接使用
    const userStmt = db.prepare('SELECT is_admin FROM users WHERE email = ?');
    const user = userStmt.get(email);

    if (!user) {
        return { hasPermission: false, needsLogin: true };
    }

    return {
        hasPermission: true,
        noPaymentRequired: true,
        isAdmin: user.is_admin === 1
    };
}

function upsertApprovedPaymentByWechat(userEmail, transactionId, note = null) {
    const stmt = db.prepare(`
        INSERT INTO user_payments (
            user_email, payment_status, submitted_at, approved_at, approved_by, is_free_user, notes
        )
        VALUES (?, 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'wechat_pay', 0, ?)
        ON CONFLICT(user_email) DO UPDATE SET
            payment_status = 'approved',
            submitted_at = CURRENT_TIMESTAMP,
            approved_at = CURRENT_TIMESTAMP,
            approved_by = 'wechat_pay',
            is_free_user = 0,
            notes = excluded.notes
    `);
    const notes = note || (transactionId ? `微信支付成功，交易号: ${transactionId}` : '微信支付成功');
    stmt.run(userEmail, notes);
}

// 获取用户支付状态
app.get('/api/payment-status/:email', (req, res) => {
    const { email } = req.params;

    try {
        const permission = checkUserPermission(email);
        if (!permission.hasPermission) {
            return res.status(404).json({ success: false, message: '用戶不存在，請先登入' });
        }

        res.json({
            success: true,
            hasPermission: true,
            needsPayment: false,
            noPaymentRequired: true,
            message: '目前活動免付費，登入後可直接參加'
        });
    } catch (error) {
        console.error('查询支付状态失败:', error);
        res.status(500).json({ success: false, message: '查詢失敗' });
    }
});

// 创建微信支付 Native 订单（扫码支付）
app.post('/api/wechat/create-order', async (req, res) => {
    const { userEmail } = req.body;
    if (!userEmail) {
        return res.status(400).json({ success: false, message: '請提供用戶郵箱' });
    }

    const configErrors = getWechatConfigErrors();
    if (configErrors.length > 0) {
        return res.status(500).json({
            success: false,
            message: `微信支付配置不完整: ${configErrors.join(', ')}`
        });
    }

    try {
        const user = findUserByEmail(userEmail);
        if (!user) {
            return res.status(404).json({ success: false, message: '用戶不存在，請先登入' });
        }

        if (userEmail.endsWith('@mail.bnbu.edu.cn')) {
            return res.json({
                success: true,
                hasPermission: true,
                isFreeUser: true,
                message: '學校用戶無需支付'
            });
        }

        const permission = checkUserPermission(userEmail);
        if (permission.hasPermission) {
            return res.json({
                success: true,
                hasPermission: true,
                alreadyPaid: true,
                message: '您已完成支付，可直接使用活動功能'
            });
        }

        const outTradeNo = generateOutTradeNo();
        const orderBody = {
            appid: WECHAT_PAY_CONFIG.appid,
            mchid: WECHAT_PAY_CONFIG.mchid,
            description: WECHAT_PAYMENT_DESCRIPTION,
            out_trade_no: outTradeNo,
            notify_url: WECHAT_PAY_CONFIG.notifyUrl,
            attach: userEmail,
            amount: {
                total: WECHAT_PAYMENT_AMOUNT_FEN,
                currency: WECHAT_PAYMENT_CURRENCY
            }
        };

        const wechatResult = await requestWechatApi('POST', '/v3/pay/transactions/native', orderBody);
        if (!wechatResult.ok || !wechatResult.data || !wechatResult.data.code_url) {
            console.error('创建微信订单失败:', wechatResult.status, wechatResult.text);
            return res.status(502).json({
                success: false,
                message: '微信下单失败，请稍后重试',
                detail: wechatResult.data || wechatResult.text
            });
        }

        const insertStmt = db.prepare(`
            INSERT INTO payment_orders (
                out_trade_no, user_email, description, amount_total, currency, status, code_url
            )
            VALUES (?, ?, ?, ?, ?, 'CREATED', ?)
        `);
        insertStmt.run(
            outTradeNo,
            userEmail,
            WECHAT_PAYMENT_DESCRIPTION,
            WECHAT_PAYMENT_AMOUNT_FEN,
            WECHAT_PAYMENT_CURRENCY,
            wechatResult.data.code_url
        );

        res.json({
            success: true,
            outTradeNo: outTradeNo,
            codeUrl: wechatResult.data.code_url,
            amount: WECHAT_PAYMENT_AMOUNT_FEN,
            currency: WECHAT_PAYMENT_CURRENCY,
            message: '請使用微信掃碼完成支付'
        });
    } catch (error) {
        console.error('创建微信支付订单异常:', error);
        res.status(500).json({ success: false, message: '建立支付訂單失敗' });
    }
});

// 微信支付回调通知
app.post('/api/wechat/notify', (req, res) => {
    const configErrors = getWechatConfigErrors();
    if (configErrors.length > 0) {
        return res.status(500).json({ code: 'FAIL', message: '微信支付配置不完整' });
    }

    try {
        const signature = req.headers['wechatpay-signature'];
        const timestamp = req.headers['wechatpay-timestamp'];
        const nonce = req.headers['wechatpay-nonce'];
        const serial = req.headers['wechatpay-serial'];
        const rawBody = req.rawBody || '';

        if (!signature || !timestamp || !nonce || !serial) {
            return res.status(400).json({ code: 'FAIL', message: '缺少微信签名头' });
        }

        if (WECHAT_PAY_CONFIG.platformSerialNo && serial !== WECHAT_PAY_CONFIG.platformSerialNo) {
            return res.status(401).json({ code: 'FAIL', message: '平台证书序列号不匹配' });
        }

        const isSignatureValid = verifyWechatNotifySignature(rawBody, timestamp, nonce, signature);
        if (!isSignatureValid) {
            return res.status(401).json({ code: 'FAIL', message: '微信回调签名验证失败' });
        }

        const notifyBody = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(rawBody);
        if (!notifyBody.resource) {
            return res.status(400).json({ code: 'FAIL', message: '回调数据缺少 resource' });
        }

        const paymentData = decryptWechatNotifyResource(notifyBody.resource);
        const outTradeNo = paymentData.out_trade_no;
        const transactionId = paymentData.transaction_id || null;
        const tradeState = paymentData.trade_state || 'UNKNOWN';
        const notifyJson = JSON.stringify(paymentData);
        const order = db.prepare('SELECT user_email FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo);
        const userEmail = order ? order.user_email : paymentData.attach;

        if (!outTradeNo || !userEmail) {
            return res.status(400).json({ code: 'FAIL', message: '回调缺少订单关键信息' });
        }

        const amountTotal = paymentData.amount && Number.isInteger(paymentData.amount.total)
            ? paymentData.amount.total
            : WECHAT_PAYMENT_AMOUNT_FEN;
        const paidAt = paymentData.success_time ? paymentData.success_time.replace('T', ' ').replace('Z', '') : null;

        const tx = db.transaction(() => {
            const existing = db.prepare('SELECT id FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo);

            if (existing) {
                const updateStmt = db.prepare(`
                    UPDATE payment_orders
                    SET status = ?,
                        transaction_id = ?,
                        raw_notify = ?,
                        paid_at = COALESCE(?, paid_at),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE out_trade_no = ?
                `);
                updateStmt.run(tradeState, transactionId, notifyJson, paidAt, outTradeNo);
            } else {
                const insertStmt = db.prepare(`
                    INSERT INTO payment_orders (
                        out_trade_no, user_email, description, amount_total, currency, status, transaction_id, raw_notify, paid_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                insertStmt.run(
                    outTradeNo,
                    userEmail,
                    WECHAT_PAYMENT_DESCRIPTION,
                    amountTotal,
                    WECHAT_PAYMENT_CURRENCY,
                    tradeState,
                    transactionId,
                    notifyJson,
                    paidAt
                );
            }

            if (tradeState === 'SUCCESS') {
                upsertApprovedPaymentByWechat(userEmail, transactionId);
            }
        });

        tx();

        return res.json({ code: 'SUCCESS', message: '成功' });
    } catch (error) {
        console.error('处理微信支付回调失败:', error);
        return res.status(500).json({ code: 'FAIL', message: '回調處理失敗' });
    }
});

// 旧版手工上传凭证接口已下线，统一改为微信支付回调开通
app.post('/api/submit-payment', (req, res) => {
    res.status(410).json({
        success: false,
        message: '支付憑證上傳已下線，請使用微信支付完成支付'
    });
});

// --- IG Finisher Program 活动API ---

// 上传活动记录（添加权限检查）
app.post('/api/activities', upload.array('files', 5), async (req, res) => {
    const { taskId, description, userEmail } = req.body;
    const parsedTaskId = Number.parseInt(taskId, 10);
    const taskTitle = Number.isInteger(parsedTaskId) && parsedTaskId >= 1 && parsedTaskId <= INTERGENERATIONAL_TASKS.length
        ? INTERGENERATIONAL_TASKS[parsedTaskId - 1]
        : null;
    const title = taskTitle ? `Task ${parsedTaskId}: ${taskTitle}` : null;

    if (!taskTitle) {
        return res.status(400).json({ success: false, message: '請選擇有效的任務' });
    }

    if (!userEmail || !description || !title) {
        return res.status(400).json({ success: false, message: '請提供完整的活動資訊' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: '請至少上傳一個檔案' });
    }

    // 权限检查
    const permission = checkUserPermission(userEmail);
    if (!permission.hasPermission) {
        return res.status(403).json({ 
            success: false, 
            message: permission.needsLogin ? '請先登入後再參加活動' : '暫時無法參加活動',
            needsLogin: Boolean(permission.needsLogin)
        });
    }

    // 同一用户同一任务仅允许提交一次
    const existingSubmission = db.prepare(`
        SELECT id FROM activities WHERE user_email = ? AND task_id = ?
    `).get(userEmail, parsedTaskId);

    if (existingSubmission) {
        return res.status(409).json({
            success: false,
            message: `您已提交過 Task ${parsedTaskId}，請選擇其他任務`
        });
    }

    try {
        // 保存文件路径（相对路径，方便后续访问）
        const filePaths = req.files.map(file => file.filename);
        const filePathsJson = JSON.stringify(filePaths);

        // 插入数据库
        const stmt = db.prepare(`
            INSERT INTO activities (user_email, task_id, title, description, file_paths, file_count)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(userEmail, parsedTaskId, title, description, filePathsJson, filePaths.length);

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
                                            <td style="padding: 8px 0; color: #666; font-weight: bold; width: 100px;">任務：</td>
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
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim().toLowerCase() : '';
    const rawTaskId = typeof req.query.taskId === 'string' ? req.query.taskId.trim() : '';
    const parsedTaskId = Number.parseInt(rawTaskId, 10);
    const hasTaskIdFilter = Number.isInteger(parsedTaskId) && parsedTaskId >= 1 && parsedTaskId <= INTERGENERATIONAL_TASKS.length;

    try {
        const conditions = [];
        const params = [];

        if (keyword) {
            const likeKeyword = `%${keyword}%`;
            conditions.push(`(
                LOWER(a.user_email) LIKE ?
                OR LOWER(COALESCE(u.first_name, '') || COALESCE(u.last_name, '')) LIKE ?
                OR LOWER(COALESCE(u.last_name, '') || COALESCE(u.first_name, '')) LIKE ?
            )`);
            params.push(likeKeyword, likeKeyword, likeKeyword);
        }

        if (hasTaskIdFilter) {
            conditions.push('a.task_id = ?');
            params.push(parsedTaskId);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const query = `
            SELECT 
                a.id,
                a.user_email,
                a.task_id,
                a.title,
                a.description,
                a.file_paths,
                a.file_count,
                a.created_at,
                u.first_name,
                u.last_name
            FROM activities a
            LEFT JOIN users u ON a.user_email = u.email
            ${whereClause}
            ORDER BY a.created_at DESC
        `;

        const stmt = db.prepare(query);
        const activities = stmt.all(...params);

        res.json({
            success: true,
            activities: activities.map(act => {
                let taskId = act.task_id;
                if (!taskId) {
                    const match = /^Task\s+(\d+)\s*:/i.exec(act.title || '');
                    if (match) {
                        const parsed = Number.parseInt(match[1], 10);
                        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= INTERGENERATIONAL_TASKS.length) {
                            taskId = parsed;
                        }
                    }
                }

                return {
                    ...act,
                    task_id: taskId || null,
                    file_paths: JSON.parse(act.file_paths)
                };
            })
        });
    } catch (error) {
        console.error('查询所有活动失败:', error);
        res.status(500).json({ success: false, message: '查詢失敗' });
    }
});

// 获取用户任务完成进度（管理员）
app.get('/api/admin/user-progress', (req, res) => {
    try {
        const usersStmt = db.prepare(`
            SELECT id, first_name, last_name, email
            FROM users
            WHERE is_admin = 0
            ORDER BY created_at DESC
        `);
        const users = usersStmt.all();

        const progressStmt = db.prepare(`
            SELECT 
                user_email,
                COUNT(DISTINCT task_id) AS completed_count,
                MAX(created_at) AS last_submitted_at,
                GROUP_CONCAT(DISTINCT task_id) AS completed_tasks
            FROM activities
            WHERE task_id IS NOT NULL
            GROUP BY user_email
        `);
        const progressRows = progressStmt.all();

        const progressMap = new Map();
        progressRows.forEach(row => {
            const completedTasks = row.completed_tasks
                ? row.completed_tasks.split(',').map(v => Number.parseInt(v, 10)).filter(v => Number.isInteger(v)).sort((a, b) => a - b)
                : [];
            progressMap.set(row.user_email, {
                completedCount: row.completed_count || 0,
                lastSubmittedAt: row.last_submitted_at || null,
                completedTasks
            });
        });

        const result = users.map(user => {
            const progress = progressMap.get(user.email) || { completedCount: 0, lastSubmittedAt: null, completedTasks: [] };
            return {
                userEmail: user.email,
                userName: `${user.last_name || ''}${user.first_name || ''}` || user.email,
                completedCount: progress.completedCount,
                completedTasks: progress.completedTasks,
                lastSubmittedAt: progress.lastSubmittedAt
            };
        });

        res.json({ success: true, users: result });
    } catch (error) {
        console.error('查询用户进度失败:', error);
        res.status(500).json({ success: false, message: '查詢失敗' });
    }
});

// 获取任务统计（管理员）
app.get('/api/admin/task-overview', (req, res) => {
    try {
        const statsStmt = db.prepare(`
            SELECT
                task_id,
                COUNT(*) AS submission_count,
                COUNT(DISTINCT user_email) AS user_count,
                MAX(created_at) AS last_submitted_at
            FROM activities
            WHERE task_id IS NOT NULL
            GROUP BY task_id
        `);
        const statsRows = statsStmt.all();
        const statsMap = new Map();
        statsRows.forEach(row => statsMap.set(row.task_id, row));

        const tasks = INTERGENERATIONAL_TASKS.map((taskTitle, index) => {
            const taskId = index + 1;
            const stats = statsMap.get(taskId);
            return {
                taskId,
                taskTitle,
                submissionCount: stats ? stats.submission_count : 0,
                userCount: stats ? stats.user_count : 0,
                lastSubmittedAt: stats ? stats.last_submitted_at : null
            };
        });

        res.json({ success: true, tasks });
    } catch (error) {
        console.error('查询任务统计失败:', error);
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
