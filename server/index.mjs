/**
 * MyShip Personal CMS Full-Stack Backend (server/index.mjs)
 *
 * 核心特性：
 *   1. 完备鉴权防线：基于 crypto.timingSafeEqual + HMAC-SHA256 无状态签名会话 (Cookie + Bearer 双通道)，生产环境 Fail-Closed
 *   2. 完整生命周期：支持文章 CRUD、草稿/已发布/归档状态流转、精选置顶 (featured)、阅读时长与阅读量统计
 *   3. 永久有効的正文图片路由：提供 `/api/cms/media/raw?key=media/...` 302 预签名重定向，确保 Markdown 正文内嵌图片永不过期
 *   4. 三套美学主题持久化：支持在 `context.storage` 中持久化默认主题 (`paper` | `craft` | `magazine`) 与个人专栏名片
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BANNER_TEXT = readFileSync(new URL('./templates/banner.txt', import.meta.url), 'utf8').trim();

const DEFAULT_SITE_SETTINGS = {
  siteTitle: '栖迟手札',
  siteSubtitle: '关于产品构建、器物审美与漫长时光的个人写作专栏',
  announcement: '',
  authorName: '林深',
  authorRole: '独立开发者 · 写作者',
  authorBio:
    '在这里记录长期主义的软件工程思考、阅读札记与生活秩序。远离算法信息流的喧嚣，只留存值得反复重读的文字。',
  defaultTheme: 'paper', // 'paper' (纸墨人文) | 'craft' (极简笔记) | 'magazine' (日系杂志)
};

function xmlEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeEditorialCoverSvgDataUri({ tag, title, subtitle, palette }) {
  const palettes = {
    warm: { bg: '#F4EFE6', card: '#FAF7F2', ink: '#1C1917', muted: '#78716C', accent: '#B45309', line: '#E5DEC9' },
    sage: { bg: '#EEF2F0', card: '#F7FAF8', ink: '#16241E', muted: '#5B6E65', accent: '#0F766E', line: '#D5E0DA' },
    terra: { bg: '#F5ECE6', card: '#FCF8F5', ink: '#231815', muted: '#7C665E', accent: '#C83E2B', line: '#E8D6CC' },
  };
  const p = palettes[palette] || palettes.warm;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">
    <rect width="1200" height="675" fill="${p.bg}"/>
    <rect x="48" y="48" width="1104" height="579" rx="12" fill="${p.card}" stroke="${p.line}" stroke-width="2"/>
    <line x1="48" y1="132" x2="1152" y2="132" stroke="${p.line}" stroke-width="1.5"/>
    <line x1="880" y1="132" x2="880" y2="627" stroke="${p.line}" stroke-width="1.5"/>
    <circle cx="1016" cy="380" r="96" fill="none" stroke="${p.accent}" stroke-width="1.5" stroke-dasharray="6 6" opacity="0.55"/>
    <circle cx="1016" cy="380" r="42" fill="${p.accent}" opacity="0.14"/>
    <text x="96" y="98" fill="${p.accent}" font-family="Georgia, serif" font-size="18" font-weight="700" letter-spacing="3">${xmlEsc(tag)}</text>
    <text x="1104" y="98" fill="${p.muted}" font-family="Georgia, serif" font-size="16" text-anchor="end">ESSAY COLLECTION</text>
    <text x="96" y="290" fill="${p.ink}" font-family="Songti SC, Noto Serif SC, Georgia, serif" font-size="48" font-weight="700">${xmlEsc(title)}</text>
    <text x="96" y="365" fill="${p.muted}" font-family="PingFang SC, system-ui, sans-serif" font-size="24">${xmlEsc(subtitle)}</text>
    <line x1="96" y1="430" x2="220" y2="430" stroke="${p.accent}" stroke-width="3"/>
    <text x="96" y="560" fill="${p.muted}" font-family="Georgia, serif" font-size="18">Crafted for calm reading &amp; long-term thinking</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const SEED_POSTS = [
  {
    slug: 'on-calm-software-and-digital-gardens',
    title: '论安静的软件：为什么我们需要一座属于自己的数字花园',
    summary:
      '当社交媒体与算法信息流不断切碎我们的注意力时，拥有一处由自己掌控排版、结构与节奏的个人写作空间，是一种温和而坚定的数字主权。',
    category: 'essay',
    tags: JSON.stringify(['数字花园', '长期主义', '写作思考']),
    cover_key: makeEditorialCoverSvgDataUri({
      tag: 'EDITORIAL ESSAY',
      title: '论安静的软件与数字花园',
      subtitle: '在喧嚣的算法时代，重建属于自己的文字秩序',
      palette: 'warm',
    }),
    status: 'published',
    featured: 1,
    views: 342,
    content: [
      '## 为什么我们越来越怀念「耐读」的页面？',
      '',
      '过去十年里，互联网上绝大多数工具都在变得越来越重、越来越吵。弹窗、悬浮组件、高饱和度的霓虹暗色界面，试图在第一秒钟抓住用户的眼球，却很少有人再去关心：**当一个人安静地坐下来阅读三千字、或者专注地写下一篇长文时，他的眼睛是否舒适？**',
      '',
      '> 好的阅读器应当像一张温润的纸，在阅读发生时悄然退后，只把思考留给文字本身。',
      '',
      '这也是我们构建这座个人内容系统的初衷——剥离一切与阅读和写作无关的工程噪音，把重心还给排版、呼吸感与内容资产的长期留存。',
      '',
      '## 一座理想个人 CMS 的三条准则',
      '',
      '在打磨这套系统时，我们确立了三条近乎克制的原则：',
      '',
      '- **纸墨般的阅读质感**：提供「纸墨人文」、「极简笔记」与「日系杂志」三套日间美学主题，配合恰到好处的字距、行高与衬线标题，让长文阅读不再视觉疲劳。',
      '- **无感顺滑的创作流**：在工作台中支持直接 `Cmd + V` 粘贴截图或拖拽图片直传对象存储，自动生成永久有效的正文图片链接，不打断写作心流。',
      '- **掌控在自己手中的云端资产**：所有文章结构化存储于边缘 SQLite (Turso)，所有图片归档于你自己的对象存储桶 (COS)，随时可迁移、可备份、可回滚。',
      '',
      '## 三套日间人文主题的设计对照',
      '',
      '| 主题名称 | 视觉底色 | 标题与正文字体 | 适用写作体裁 |',
      '| :--- | :--- | :--- | :--- |',
      '| **纸墨人文 (Paper)** | `#FAF6EE` 暖白宣纸 | 宋刻衬线 + 人文无衬线 | 深度长文、读书手札、社论随笔 |',
      '| **极简笔记 (Craft)** | `#F3F6F9` 北欧冷白 | 现代几何无衬线 (`Inter`) | 架构推导、技术笔记、知识手册 |',
      '| **日系杂志 (Magazine)** | `#EFEAE0` 米杏画报 | 高对比标题 + 墨线分栏 | 器物测评、日常摄影、生活周刊 |',
      '',
      '## 写作即思考的容器',
      '',
      '当你不再为了配置繁琐的插件而分心，每一次打开编辑器，都只是一次与自己的对话：',
      '',
      '```javascript',
      '// 保持简单，让内容自然生长 (Astro 7.4 + Marked 18 + Highlight.js 11)',
      'export async function publishEssay(article, context) {',
      '  const saved = await context.db.execute(',
      '    "INSERT INTO cms_posts (slug, title, status) VALUES (?, ?, ?)",',
      '    [article.slug, article.title, "published"]',
      '  );',
      '  return { ok: true, ownership: "100% Yours", saved };',
      '}',
      '```',
      '',
      '愿你在这里写下的每一篇手札，都能经得起时间的重读。',
    ].join('\n'),
  },
  {
    slug: 'typography-and-three-visual-languages',
    title: '器物与排版：在纸墨、极简与杂志三种秩序之间切换',
    summary:
      '不同的文字体裁适合不同的视觉容器。深度长文需要衬线体的沉稳，技术笔记偏爱几何无衬线的利落，而生活随笔则适合杂志画报般的留白。',
    category: 'design',
    tags: JSON.stringify(['排版美学', '设计系统', '阅读体验']),
    cover_key: makeEditorialCoverSvgDataUri({
      tag: 'DESIGN & TYPOGRAPHY',
      title: '器物与排版的三重秩序',
      subtitle: '纸墨人文 · 极简笔记 · 日系杂志画报',
      palette: 'sage',
    }),
    status: 'published',
    featured: 0,
    views: 186,
    content: [
      '## 为什么单一主题无法满足所有表达？',
      '',
      '我们在写作时往往拥有多重身份：有时是严谨的工程师，需要记录清晰的架构推导与代码片段；有时则是观察生活的写作者，想要用舒缓的节奏记下一段旅途或读书心得。',
      '',
      '为此，这套个人 CMS 内置了三套经过精心校对的视觉语言，你可以随时在导航栏体验切换，也可以在后台将其设定为全站默认风格：',
      '',
      '- **纸墨人文 (Paper Editorial)**：以 `#FAF7F2` 暖白宣纸为底，搭配宋刻/衬线标题与琥珀赤茶色点缀，致敬《Kinfolk》与 Substack 的经典社论质感。',
      '- **极简笔记 (Nordic Craft)**：以冷白浅灰 `#F7F8FA` 搭配现代无衬线字体与松石绿强调色，如同 Bear 与 Craft 般干净克制，极其适合技术专栏与知识库。',
      '- **日系杂志 (Magazine Air)**：采用温暖米杏色底与鲜明的画报分栏线条，辅以朱砂印章色点缀，赋予日常随笔与摄影图文独特的编排趣味。',
      '',
      '## 细节处的阅读照顾',
      '',
      '在文章详情页右侧，系统会自动提取二级与三级标题生成**跟随式目录大纲 (TOC)**，并在顶部提供柔和的阅读进度指示，让长文检索与沉浸阅读兼得。',
    ].join('\n'),
  },
  {
    slug: 'astro-and-edge-fullstack-architecture-notes',
    title: '全栈构建手记：当 Astro 静态外壳遇见边缘无服务器后端',
    summary:
      '如何在保持静态站点零 JS 负担与秒级首屏的同时，拥有完整的在线发稿、图片直传与权限保护能力？这是我的一份架构实践备忘。',
    category: 'craft',
    tags: JSON.stringify(['Astro', '架构手记', '独立开发']),
    cover_key: makeEditorialCoverSvgDataUri({
      tag: 'CRAFT & ARCHITECTURE',
      title: 'Astro 与边缘全栈架构手记',
      subtitle: '兼顾静态页面的轻盈与动态后台的自由',
      palette: 'terra',
    }),
    status: 'published',
    featured: 0,
    views: 145,
    content: [
      '## 静态生成与动态发布的平衡点',
      '',
      '传统静态博客（如 Hugo、Hexo）最大的痛点在于：**每次修改一个错别字，都必须打开电脑重新构建整站并推送部署**。而传统重型动态 CMS（如 WordPress）又往往需要维护常驻服务器，且首屏加载笨重。',
      '',
      '采用 **Astro 5 + 轻量无服务器后端** 的混合范式，恰好消解了这一矛盾：',
      '',
      '- **页面骨架纯静态编译**：门户首页、文章阅读页、归档页与工作台外壳由 Astro 编译为纯粹、极速的静态 HTML/CSS，全球边缘节点缓存分发。',
      '- **内容数据实时读取与写入**：在线工作台 (`/admin/`) 通过受保护的 API 直接读写云端数据库与对象存储，保存即刻上线，无需触发任何重编译流程。',
      '',
      '## 永久有效的私有桶图片方案',
      '',
      '在编辑器中粘贴图片时，浏览器通过预签名 `PUT` 链接将图片直接上传至私有对象存储，并在正文中插入 `/api/cms/media/raw?key=media/...` 格式的永久引用地址。读者阅读时由后端动态签发短期重定向，既保护了存储桶私有安全，又杜绝了签名过期导致的裂图问题。',
    ].join('\n'),
  },
  {
    slug: 'unpublished-reading-notes-draft',
    title: '【草稿】春夜读书与器物整理备忘（仅管理员可见）',
    summary:
      '这是一篇保存在草稿箱中的未公开笔记，只有通过管理员口令解锁工作台后才能在后台列表中看到并继续编辑。',
    category: 'notes',
    tags: JSON.stringify(['读书笔记', '草稿']),
    cover_key: '',
    status: 'draft',
    featured: 0,
    views: 0,
    content: [
      '## 待整理的书单与摘录',
      '',
      '这篇笔记目前处于 `draft`（草稿）状态，不会出现在前台读者门户或归档页中。',
      '',
      '- [ ] 整理关于《柳宗悦：民艺四十年》的读后感',
      '- [ ] 补充桌面工作流与键盘配图',
      '- [ ] 校对完毕后点击右上角「发布上线」即可公开显示',
    ].join('\n'),
  },
];

let schemaInitializedForProvider = null;

function isPgProvider(provider) {
  return provider === 'pg' || provider === 'postgres' || provider === 'neon';
}

function sqlParams(sql, isPg) {
  if (!isPg) return sql;
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

function slugifyTitle(input) {
  const base = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || `post-${Date.now().toString(36)}`;
}

function estimateReadingMinutes(text) {
  const clean = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~-]/g, '');
  const cjkCount = (clean.match(/[\u4e00-\u9fa5]/g) || []).length;
  const wordCount = clean
    .replace(/[\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  const totalUnits = cjkCount + wordCount;
  return {
    wordCount: totalUnits,
    readingMinutes: Math.max(1, Math.ceil(totalUnits / 320)),
  };
}

// ==================== 安全鉴权模块 (Timing-Safe + Stateless HMAC Session) ====================

function getExpectedAdminToken() {
  const configured = String(process.env.CMS_ADMIN_TOKEN || '').trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') {
    return 'myship-dev-admin';
  }
  return '';
}

function safeCompareSecret(input, expected) {
  if (!input || !expected) return false;
  const bufA = Buffer.from(String(input), 'utf8');
  const bufB = Buffer.from(String(expected), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function createSignedSessionToken(secret, ttlSeconds = 7 * 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `cms_admin.${exp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySignedSessionToken(token, secret) {
  if (!token || !secret) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'cms_admin') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const payload = `cms_admin.${parts[1]}`;
  const expectedSig = createHmac('sha256', secret).update(payload).digest('hex');
  return safeCompareSecret(parts[2], expectedSig);
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const pair of String(cookieHeader).split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function checkAdminAuth(request) {
  const expected = getExpectedAdminToken();
  if (!expected) {
    return {
      ok: false,
      status: 403,
      error:
        '生产环境未配置 CMS_ADMIN_TOKEN 环境变量，已拒绝后台管理操作。请先运行 `myship env set CMS_ADMIN_TOKEN=<你的强密码>`。',
    };
  }

  const authHeader = String(request.headers.get('authorization') || '').trim();
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const headerToken = String(request.headers.get('x-cms-admin-token') || '').trim();
  const cookies = parseCookies(request.headers.get('cookie') || '');
  const cookieToken = cookies.cms_session || '';

  const candidates = [bearer, headerToken, cookieToken].filter(Boolean);
  for (const candidate of candidates) {
    if (
      safeCompareSecret(candidate, expected) ||
      verifySignedSessionToken(candidate, expected)
    ) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    status: 401,
    error: '未登录或管理员会话已过期，请先输入管理员口令登录工作台。',
  };
}

// ==================== 数据库建表与平滑演进 ====================

async function ensureCmsSchemaAndSeed(db) {
  if (!db || db.provider === 'unconfigured') {
    const err = new Error('当前未配置云端数据库，请先运行 `myship use db --provider turso`');
    err.code = 'DB_UNCONFIGURED';
    throw err;
  }

  const provider = String(db.provider || 'sqlite').toLowerCase();
  const isPg = isPgProvider(provider);

  if (schemaInitializedForProvider !== provider) {
    if (isPg) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS cms_posts (
          id SERIAL PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'essay',
          tags TEXT NOT NULL DEFAULT '[]',
          cover_key TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          featured INTEGER NOT NULL DEFAULT 0,
          views INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          published_at TEXT
        )
      `);
    } else if (provider === 'mysql') {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS cms_posts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          slug VARCHAR(191) NOT NULL UNIQUE,
          title VARCHAR(255) NOT NULL,
          summary TEXT NOT NULL,
          content LONGTEXT NOT NULL,
          category VARCHAR(64) NOT NULL DEFAULT 'essay',
          tags TEXT NOT NULL,
          cover_key LONGTEXT NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'draft',
          featured INT NOT NULL DEFAULT 0,
          views INT NOT NULL DEFAULT 0,
          created_at VARCHAR(64) NOT NULL,
          updated_at VARCHAR(64) NOT NULL,
          published_at VARCHAR(64)
        )
      `);
    } else {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS cms_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'essay',
          tags TEXT NOT NULL DEFAULT '[]',
          cover_key TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          featured INTEGER NOT NULL DEFAULT 0,
          views INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          published_at TEXT
        )
      `);
    }

    // 平滑演进：如果旧表缺少 featured 列则自动补齐
    try {
      await db.execute('ALTER TABLE cms_posts ADD COLUMN featured INTEGER NOT NULL DEFAULT 0');
    } catch {
      // 列已存在，安全忽略
    }

    const { rows } = await db.query('SELECT COUNT(*) AS cnt FROM cms_posts');
    const count = Number(rows?.[0]?.cnt ?? rows?.[0]?.['COUNT(*)'] ?? 0);
    if (count === 0) {
      const baseTime = Date.now();
      const insertSql = sqlParams(
        `INSERT INTO cms_posts (slug, title, summary, content, category, tags, cover_key, status, featured, views, created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        isPg
      );
      for (let i = 0; i < SEED_POSTS.length; i++) {
        const seed = SEED_POSTS[i];
        const ts = new Date(baseTime - i * 3600_000 * 12).toISOString();
        const pubAt = seed.status === 'published' ? ts : null;
        await db.execute(insertSql, [
          seed.slug,
          seed.title,
          seed.summary,
          seed.content,
          seed.category,
          seed.tags,
          seed.cover_key,
          seed.status,
          seed.featured || 0,
          seed.views,
          ts,
          ts,
          pubAt,
        ]);
      }
    }

    schemaInitializedForProvider = provider;
  }

  return { provider, isPg };
}

async function decoratePostRow(row, filesClient) {
  if (!row) return null;
  let parsedTags = [];
  try {
    parsedTags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [];
  } catch {
    parsedTags = [];
  }
  const coverKey = String(row.cover_key || '').trim();
  let coverUrl = '';
  if (coverKey) {
    if (
      coverKey.startsWith('http://') ||
      coverKey.startsWith('https://') ||
      coverKey.startsWith('/') ||
      coverKey.startsWith('data:')
    ) {
      coverUrl = coverKey;
    } else if (filesClient) {
      try {
        coverUrl = await filesClient.presignUrl(coverKey, { method: 'GET', expiresIn: 3600 });
      } catch {
        coverUrl = `/api/cms/media/raw?key=${encodeURIComponent(coverKey)}`;
      }
    }
  }
  const { wordCount, readingMinutes } = estimateReadingMinutes(row.content || '');
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    summary: row.summary || '',
    content: row.content || '',
    category: row.category || 'essay',
    tags: Array.isArray(parsedTags) ? parsedTags : [],
    cover_key: coverKey,
    coverUrl,
    status: row.status || 'draft',
    featured: Number(row.featured || 0) === 1,
    views: Number(row.views || 0),
    wordCount,
    readingMinutes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    published_at: row.published_at || null,
  };
}

export async function fetch(request, context) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // 0. 管理员登录 / 会话校验 / 退出登录
  if (path === '/api/cms/auth/login' && method === 'POST') {
    const expected = getExpectedAdminToken();
    if (!expected) {
      return Response.json(
        {
          ok: false,
          error:
            '生产环境未配置 CMS_ADMIN_TOKEN 环境变量，已拒绝登录。请运行 `myship env set CMS_ADMIN_TOKEN=<你的强密码>`。',
        },
        { status: 403 }
      );
    }
    const body = await request.json().catch(() => ({}));
    const password = String(body.password || body.token || '').trim();
    if (!safeCompareSecret(password, expected)) {
      return Response.json(
        { ok: false, error: '管理员密码错误，请核对后重试。' },
        { status: 401 }
      );
    }
    const sessionToken = createSignedSessionToken(expected);
    const isSecure = url.protocol === 'https:';
    const cookieStr = `cms_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${
      isSecure ? '; Secure' : ''
    }`;
    return new Response(
      JSON.stringify({
        ok: true,
        sessionToken,
        mode: process.env.CMS_ADMIN_TOKEN ? 'production-token' : 'local-dev-default',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': cookieStr,
        },
      }
    );
  }

  if (path === '/api/cms/auth/logout' && method === 'POST') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'cms_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      },
    });
  }

  if (path === '/api/cms/auth/verify' && (method === 'POST' || method === 'GET')) {
    const res = checkAdminAuth(request);
    if (!res.ok) {
      return Response.json({ ok: false, error: res.error }, { status: res.status });
    }
    return Response.json({
      ok: true,
      mode: process.env.CMS_ADMIN_TOKEN ? 'custom-token' : 'local-dev-default',
    });
  }

  // 1. GET /api/health
  if (path === '/api/health' && method === 'GET') {
    const dbReady = Boolean(context.db && context.db.provider !== 'unconfigured');
    return Response.json({
      ok: true,
      banner: BANNER_TEXT,
      project: context.project,
      subdomain: context.subdomain,
      deploymentId: context.deploymentId,
      nodeVersion: process.version,
      dbProvider: context.db?.provider || 'unconfigured',
      capabilities: {
        storage: Boolean(context.storage),
        files: Boolean(context.files),
        db: dbReady,
      },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // 2. GET / PUT /api/cms/settings (基于 context.storage 的站点全局配置 + 默认视觉主题)
    if (path === '/api/cms/settings') {
      if (method === 'GET') {
        const saved = (await context.storage.get('site_settings')) || {};
        return Response.json({
          ok: true,
          settings: { ...DEFAULT_SITE_SETTINGS, ...saved },
        });
      }
      if (method === 'PUT' || method === 'POST') {
        const auth = checkAdminAuth(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        }
        const body = await request.json().catch(() => ({}));
        const prev = (await context.storage.get('site_settings')) || {};
        const validThemes = ['paper', 'craft', 'magazine'];
        const next = {
          ...DEFAULT_SITE_SETTINGS,
          ...prev,
          ...(body.siteTitle !== undefined ? { siteTitle: String(body.siteTitle).trim() } : {}),
          ...(body.siteSubtitle !== undefined
            ? { siteSubtitle: String(body.siteSubtitle).trim() }
            : {}),
          ...(body.announcement !== undefined
            ? { announcement: String(body.announcement).trim() }
            : {}),
          ...(body.authorName !== undefined ? { authorName: String(body.authorName).trim() } : {}),
          ...(body.authorRole !== undefined ? { authorRole: String(body.authorRole).trim() } : {}),
          ...(body.authorBio !== undefined ? { authorBio: String(body.authorBio).trim() } : {}),
          ...(validThemes.includes(body.defaultTheme)
            ? { defaultTheme: body.defaultTheme }
            : {}),
          updatedAt: new Date().toISOString(),
        };
        await context.storage.set('site_settings', next);
        return Response.json({ ok: true, settings: next });
      }
    }

    // 3. GET /api/cms/overview (聚合站点设置 + 文章状态统计)
    if (path === '/api/cms/overview' && method === 'GET') {
      const { provider } = await ensureCmsSchemaAndSeed(context.db);
      const savedSettings = (await context.storage.get('site_settings')) || {};
      const { rows } = await context.db.query(
        'SELECT status, COUNT(*) AS cnt, COALESCE(SUM(views), 0) AS sum_views FROM cms_posts GROUP BY status'
      );
      const stats = { total: 0, published: 0, draft: 0, archived: 0, totalViews: 0 };
      for (const r of rows || []) {
        const c = Number(r.cnt || 0);
        const v = Number(r.sum_views || 0);
        stats.total += c;
        stats.totalViews += v;
        if (r.status === 'published') stats.published += c;
        else if (r.status === 'draft') stats.draft += c;
        else if (r.status === 'archived') stats.archived += c;
      }
      const mediaKeys = context.files ? await context.files.list('media/') : [];
      return Response.json({
        ok: true,
        settings: { ...DEFAULT_SITE_SETTINGS, ...savedSettings },
        stats: { ...stats, mediaCount: mediaKeys.length },
        runtime: {
          project: context.project,
          deploymentId: context.deploymentId || 'dev',
          dbProvider: provider,
          nodeVersion: process.version,
        },
      });
    }

    // 4. GET / POST / DELETE /api/cms/posts (文章列表查询、新建/编辑、删除)
    if (path === '/api/cms/posts') {
      const { provider, isPg } = await ensureCmsSchemaAndSeed(context.db);

      if (method === 'GET') {
        const statusFilter = (url.searchParams.get('status') || 'published').toLowerCase();
        if (statusFilter !== 'published') {
          const auth = checkAdminAuth(request);
          if (!auth.ok) {
            return Response.json({ ok: false, error: auth.error }, { status: auth.status });
          }
        }
        const categoryFilter = (url.searchParams.get('category') || '').toLowerCase();
        const tagFilter = (url.searchParams.get('tag') || '').trim();
        const searchQ = (url.searchParams.get('q') || '').trim();

        const clauses = [];
        const params = [];
        if (statusFilter && statusFilter !== 'all') {
          clauses.push('status = ?');
          params.push(statusFilter);
        }
        if (categoryFilter && categoryFilter !== 'all') {
          clauses.push('category = ?');
          params.push(categoryFilter);
        }
        if (tagFilter) {
          clauses.push('tags LIKE ?');
          params.push(`%${tagFilter}%`);
        }
        if (searchQ) {
          clauses.push('(title LIKE ? OR summary LIKE ? OR content LIKE ?)');
          const likePat = `%${searchQ}%`;
          params.push(likePat, likePat, likePat);
        }

        const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const querySql = sqlParams(
          `SELECT * FROM cms_posts ${whereSql} ORDER BY featured DESC, COALESCE(published_at, created_at) DESC, id DESC LIMIT 100`,
          isPg
        );
        const { rows } = await context.db.query(querySql, params);
        const posts = await Promise.all(
          (rows || []).map((r) => decoratePostRow(r, context.files))
        );
        return Response.json({ ok: true, provider, posts });
      }

      if (method === 'POST' || method === 'PUT') {
        const auth = checkAdminAuth(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        }
        const body = await request.json().catch(() => ({}));
        const id = body.id ? Number(body.id) : null;
        const title = String(body.title || '').trim();
        if (!title) {
          return Response.json({ ok: false, error: '文章标题不能为空' }, { status: 400 });
        }
        const summary = String(body.summary || '').trim();
        const content = String(body.content || '').trim();
        const category = String(body.category || 'essay').trim();
        const status = ['draft', 'published', 'archived'].includes(body.status)
          ? body.status
          : 'draft';
        const featured = body.featured ? 1 : 0;
        const coverKey = String(body.cover_key ?? body.coverKey ?? '').trim();
        const rawTags = Array.isArray(body.tags)
          ? body.tags
          : String(body.tags || '')
              .split(/[,，]/)
              .map((t) => t.trim())
              .filter(Boolean);
        const tagsJson = JSON.stringify(rawTags);
        const now = new Date().toISOString();

        if (id) {
          const existingRes = await context.db.query(
            sqlParams('SELECT * FROM cms_posts WHERE id = ?', isPg),
            [id]
          );
          const existing = existingRes.rows?.[0];
          if (!existing) {
            return Response.json({ ok: false, error: `未找到文章 ID=${id}` }, { status: 404 });
          }
          const nextSlug = body.slug
            ? slugifyTitle(body.slug)
            : existing.slug || slugifyTitle(title);
          const publishedAt =
            status === 'published'
              ? existing.published_at || now
              : existing.published_at || null;

          await context.db.execute(
            sqlParams(
              `UPDATE cms_posts
               SET slug = ?, title = ?, summary = ?, content = ?, category = ?, tags = ?, cover_key = ?, status = ?, featured = ?, updated_at = ?, published_at = ?
               WHERE id = ?`,
              isPg
            ),
            [
              nextSlug,
              title,
              summary,
              content,
              category,
              tagsJson,
              coverKey,
              status,
              featured,
              now,
              publishedAt,
              id,
            ]
          );
          const updatedRes = await context.db.query(
            sqlParams('SELECT * FROM cms_posts WHERE id = ?', isPg),
            [id]
          );
          const post = await decoratePostRow(updatedRes.rows?.[0], context.files);
          return Response.json({ ok: true, action: 'updated', post });
        }

        let slug = body.slug ? slugifyTitle(body.slug) : slugifyTitle(title);
        const dupRes = await context.db.query(
          sqlParams('SELECT id FROM cms_posts WHERE slug = ?', isPg),
          [slug]
        );
        if (dupRes.rows?.length > 0) {
          slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
        }
        const publishedAt = status === 'published' ? now : null;
        await context.db.execute(
          sqlParams(
            `INSERT INTO cms_posts (slug, title, summary, content, category, tags, cover_key, status, featured, views, created_at, updated_at, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            isPg
          ),
          [
            slug,
            title,
            summary,
            content,
            category,
            tagsJson,
            coverKey,
            status,
            featured,
            now,
            now,
            publishedAt,
          ]
        );
        const createdRes = await context.db.query(
          sqlParams('SELECT * FROM cms_posts WHERE slug = ?', isPg),
          [slug]
        );
        const post = await decoratePostRow(createdRes.rows?.[0], context.files);
        return Response.json({ ok: true, action: 'created', post });
      }

      if (method === 'DELETE') {
        const auth = checkAdminAuth(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        }
        const id = Number(url.searchParams.get('id') || 0);
        if (!id) {
          return Response.json({ ok: false, error: '缺少文章 id 参数' }, { status: 400 });
        }
        await context.db.execute(
          sqlParams('DELETE FROM cms_posts WHERE id = ?', isPg),
          [id]
        );
        return Response.json({ ok: true, deletedId: id });
      }
    }

    // 5. PATCH / POST /api/cms/posts/status (状态流转 & 置顶切换)
    if (path === '/api/cms/posts/status' && (method === 'PATCH' || method === 'POST')) {
      const auth = checkAdminAuth(request);
      if (!auth.ok) {
        return Response.json({ ok: false, error: auth.error }, { status: auth.status });
      }
      const { isPg } = await ensureCmsSchemaAndSeed(context.db);
      const body = await request.json().catch(() => ({}));
      const id = Number(body.id || 0);
      if (!id) {
        return Response.json({ ok: false, error: '缺少文章 id' }, { status: 400 });
      }
      const now = new Date().toISOString();

      if (body.featured !== undefined) {
        const featVal = body.featured ? 1 : 0;
        await context.db.execute(
          sqlParams('UPDATE cms_posts SET featured = ?, updated_at = ? WHERE id = ?', isPg),
          [featVal, now, id]
        );
      }

      if (body.status !== undefined) {
        const nextStatus = String(body.status || '').toLowerCase();
        if (!['draft', 'published', 'archived'].includes(nextStatus)) {
          return Response.json(
            { ok: false, error: '需要提供有效的 status (draft | published | archived)' },
            { status: 400 }
          );
        }
        if (nextStatus === 'published') {
          await context.db.execute(
            sqlParams(
              'UPDATE cms_posts SET status = ?, updated_at = ?, published_at = COALESCE(published_at, ?) WHERE id = ?',
              isPg
            ),
            [nextStatus, now, now, id]
          );
        } else {
          await context.db.execute(
            sqlParams('UPDATE cms_posts SET status = ?, updated_at = ? WHERE id = ?', isPg),
            [nextStatus, now, id]
          );
        }
      }

      const updatedRes = await context.db.query(
        sqlParams('SELECT * FROM cms_posts WHERE id = ?', isPg),
        [id]
      );
      const post = await decoratePostRow(updatedRes.rows?.[0], context.files);
      return Response.json({ ok: true, post });
    }

    // 6. GET /api/cms/post?slug=... (单篇文章详情 + 阅读计数自增 + 上下篇导航)
    if (path === '/api/cms/post' && method === 'GET') {
      const { isPg } = await ensureCmsSchemaAndSeed(context.db);
      const slug = (url.searchParams.get('slug') || '').trim();
      const id = Number(url.searchParams.get('id') || 0);
      const incView = url.searchParams.get('incView') === '1';

      if (!slug && !id) {
        return Response.json({ ok: false, error: '请提供 slug 或 id 参数' }, { status: 400 });
      }

      const whereClause = slug ? 'slug = ?' : 'id = ?';
      const paramVal = slug || id;

      if (incView) {
        await context.db.execute(
          sqlParams(`UPDATE cms_posts SET views = views + 1 WHERE ${whereClause}`, isPg),
          [paramVal]
        );
      }

      const { rows } = await context.db.query(
        sqlParams(`SELECT * FROM cms_posts WHERE ${whereClause} LIMIT 1`, isPg),
        [paramVal]
      );
      if (!rows || rows.length === 0) {
        return Response.json({ ok: false, error: '未找到该文章' }, { status: 404 });
      }
      const post = await decoratePostRow(rows[0], context.files);
      if (post.status !== 'published') {
        const auth = checkAdminAuth(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        }
      }

      // 查询相邻已发布文章用于底部上一篇/下一篇导航
      const navRes = await context.db.query(
        sqlParams(
          `SELECT id, slug, title, category, published_at FROM cms_posts WHERE status = ? ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 50`,
          isPg
        ),
        ['published']
      );
      const pubList = navRes.rows || [];
      const curIdx = pubList.findIndex((r) => Number(r.id) === post.id);
      const prevPost = curIdx > 0 ? pubList[curIdx - 1] : null;
      const nextPost = curIdx >= 0 && curIdx < pubList.length - 1 ? pubList[curIdx + 1] : null;

      return Response.json({ ok: true, post, prevPost, nextPost });
    }

    // 7. GET /api/cms/media/raw?key=media/... (永久有效的正文图片 302 预签名跳转)
    if (path === '/api/cms/media/raw' && method === 'GET') {
      const key = (url.searchParams.get('key') || '').trim();
      if (!key || !key.startsWith('media/') || key.includes('..')) {
        return new Response('400 Invalid media key', { status: 400 });
      }
      const signedGetUrl = await context.files.presignUrl(key, {
        method: 'GET',
        expiresIn: 3600,
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: signedGetUrl,
          'Cache-Control': 'public, max-age=1800',
        },
      });
    }

    // 8. GET / DELETE /api/cms/media & POST /api/cms/media/presign (COS 媒体资产库与预签名直传)
    if (path === '/api/cms/media' && method === 'GET') {
      const auth = checkAdminAuth(request);
      if (!auth.ok) {
        return Response.json({ ok: false, error: auth.error }, { status: auth.status });
      }
      const keys = await context.files.list('media/');
      const items = await Promise.all(
        keys.slice(0, 40).map(async (key) => {
          const url = await context.files.presignUrl(key, { method: 'GET', expiresIn: 3600 });
          return {
            key,
            name: key.replace(/^media\//, ''),
            url,
            permanentPath: `/api/cms/media/raw?key=${encodeURIComponent(key)}`,
          };
        })
      );
      return Response.json({ ok: true, media: items.reverse() });
    }

    if (path === '/api/cms/media' && method === 'DELETE') {
      const auth = checkAdminAuth(request);
      if (!auth.ok) {
        return Response.json({ ok: false, error: auth.error }, { status: auth.status });
      }
      const key = (url.searchParams.get('key') || '').trim();
      if (!key || !key.startsWith('media/')) {
        return Response.json({ ok: false, error: '无效的媒体文件 key' }, { status: 400 });
      }
      await context.files.delete(key);
      return Response.json({ ok: true, deletedKey: key });
    }

    if (path === '/api/cms/media/presign' && method === 'POST') {
      const auth = checkAdminAuth(request);
      if (!auth.ok) {
        return Response.json({ ok: false, error: auth.error }, { status: auth.status });
      }
      const body = await request.json().catch(() => ({}));
      const rawName = String(body.filename || 'image.png')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-|-$/g, '');
      const key = `media/${Date.now()}-${rawName || 'asset.png'}`;
      const uploadUrl = await context.files.presignUrl(key, {
        method: 'PUT',
        expiresIn: 600,
      });
      const previewUrl = await context.files.presignUrl(key, {
        method: 'GET',
        expiresIn: 3600,
      });
      return Response.json({
        ok: true,
        key,
        uploadUrl,
        previewUrl,
        permanentPath: `/api/cms/media/raw?key=${encodeURIComponent(key)}`,
      });
    }
  } catch (err) {
    if (err.code === 'DB_UNCONFIGURED' || /未配置云端数据库/.test(err.message || '')) {
      return Response.json(
        {
          ok: false,
          needsSetup: true,
          setupCommand: 'myship use db --provider turso',
          error: err.message,
        },
        { status: 503 }
      );
    }
    return Response.json(
      { ok: false, error: err.message || String(err) },
      { status: 500 }
    );
  }

  return Response.json(
    { ok: false, error: `Route not found: ${method} ${path}` },
    { status: 404 }
  );
}
