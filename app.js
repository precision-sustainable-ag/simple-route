import { networkInterfaces } from 'os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import staticPlugin from '@fastify/static';

import { pool } from './db.js';

let app;

const setup = async ({
  title = 'Swagger API',
  version = '1.0.0',
  trusted = [],
  plugins = {},
}) => {
  app = Fastify({
    logger: false,
    routerOptions: {
      ignoreTrailingSlash: true,
    },
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  const ipAddress = () => Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address || '127.0.0.1';

  const dberr = `Could not connect to database from ${ipAddress()}`;

  await app.register(cors, {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-api-key', 'authorization'],
    credentials: true,
  });

  let ico;
  try {
    // ico = fs.readFileSync(path.join(__dirname, '../public', 'favicon.ico'));
    ico = fs.readFileSync(path.join(process.cwd(), 'public', 'favicon.ico'));
  } catch (err) {
    console.log(err.message);
  }

  app.decorate('allowTrustedOriginOrApiKey', async (req, reply) => {
    const origin = req.headers.origin?.split(':').slice(0, 2).join(':') || '';
    if (trusted.includes(origin)) return;

    const key = req.headers['x-api-key'];
    if (!key || key !== process.env.AUTH0_SECRET_KEY) {
      return reply.code(401).send({ error: 'missing or invalid API key' });
    }
  });

  await app.register(swagger, {
    mode: 'dynamic',
    openapi: {
      info: { title, version },
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        },
      },    
    },
    exposeRoute: true,
  });

  app.setErrorHandler((err, _req, reply) => {
    if (/password/.test(err.message) || /ECONNREFUSED/.test(err.code)) {
      reply.code(503).send({ error: dberr });
    } else {
      reply.code(err.statusCode || 500).send({ error: 'Internal', message: err.message });
    }
  });

  let url;
  let key;
  await app.register(swaggerUI, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      tryItOutEnabled: true,
      persistAuthorization: true,
      requestInterceptor: (req) => {
        url = new URL(req.url, window.location.href).href;
        key = req.headers?.['x-api-key'] ?? req.headers?.['X-API-Key'];
        return req;
      },
      onComplete: () => {
        const click = async (e) => {
          if (e?.target.classList.contains('execute')) {
            const current =  e?.target.closest('.opblock');
            if (current.querySelector('.opblock-summary-method').textContent !== 'GET') {
              return;
            }

            let iframe = document.querySelector('iframe[data-runner="1"]');
            if (!iframe) {
              iframe = document.createElement('iframe');
              iframe.setAttribute('data-runner', '1');
              iframe.sandbox = 'allow-scripts allow-same-origin';
              document.body.appendChild(iframe);
            }

            iframe.addEventListener('load', () => {
              const doc = iframe.contentDocument;
              doc.querySelector('#Close').addEventListener('click', () => iframe.remove());

              doc.addEventListener('keydown', (evt) => {
                if (evt.key === 'Escape') {
                  iframe.remove();
                }
              });

              iframe.focus();
            });  

            const res = await fetch(url, { headers: { 'x-api-key': key } });

            const style = `
              <style>
                #Close {
                  position: fixed;
                  top: 0;
                  right: 0;
                  background: #cde;
                }
              </style>
            `;

            if (/output=(html|csv)/.test(url)) {
              const text = await res.text();
              iframe.srcdoc = `
                ${style}
                <button id="Close" accesskey="l">C<u>l</u>ose</button>
                <pre>Status: ${res.status}\n\n${text}</pre>
              `;
            } else {
              const text = await res.json();
              iframe.srcdoc = `
                ${style}
                <button id="Close" accesskey="l">C<u>l</u>ose</button>
                <pre>Status: ${res.status}\n\n${JSON.stringify(text, null, 2)}</pre>
              `;
            }
          } else {
            setTimeout(() => {
              const current =  e?.srcElement.closest('.opblock-summary');
              if (current) current.closest('.opblock').scrollIntoView();
            }, 100);
          }
        };

        document.addEventListener('click', click);

        click();
      },
    },
    theme: {
      title,
      favicon: [{
        filename: 'favicon.ico',
        rel: 'icon',
        sizes: 'any',
        type: 'image/x-icon',
        content: ico,
      }],
      css: [{
        content: `
          .swagger-ui .topbar,
          .url,
          button.cancel,
          span:last-of-type .opblock-tag-section:last-of-type {
            display: none !important;
          }

          iframe {
            position: fixed;
            background: #eee;
            width: 90vw;
            height: 90vh;
            left: 5vw;
            top: 5vh;
            box-shadow: 0 0 0 5vw rgba(0, 0, 0, 0.6);
          }

          .opblock-summary-description {
            float: right !important;
          }

          .opblock-description {
            line-height: 1.5rem;
            font-size: 14px;

            code {
              color: rgb(229, 57, 53) !important;
              border: 1px solid rgba(38, 50, 56, 0.1);
              padding: 0px 5px !important;
              font-size: 13px !important;
            }
          }
        `,
      }],
    },
  });

  for (const [name, plugin] of Object.entries(plugins)) {
    await app.register(plugin, { prefix: `/${name}` });
  }

  app.get('/redoc', async (req, reply) => {
    // Use a relative spec-url so this works behind proxies and on any host
    const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8"/>
      <title>API Docs Redoc</title>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <style>
        body { margin:0; padding:0; }
        .topbar {
          position: fixed; z-index: 10; top: 0; left: 0; right: 0;
          height: 44px; display: flex; align-items: center; gap: 12px;
          padding: 0 12px; border-bottom: 1px solid #eee; background: #fff;
          font: 500 14px system-ui, -apple-system, Segoe UI, Roboto, Arial;
        }
        .content { margin-top: 44px; }
        .btn { padding: 6px 10px; border: 1px solid #ddd; border-radius: 8px; text-decoration: none; color: #111; }
        ul[role="menu"] > li:last-of-type { display: none; }  /* hide redoc route in left pane */
        div[data-section-id]:last-of-type { display: none; }  /* hide redoc route in middle pane */
      </style>
    </head>
    <body>
      <div class="topbar">
        <span>Redoc</span>
        <a class="btn" href="/docs">Try it (Swagger UI)</a>
        <a class="btn" href="/docs/json">OpenAPI JSON</a>
      </div>
      <div class="content">
        <redoc
          spec-url="/docs/json"
          suppress-warnings
          hide-download-button
          expand-responses=""
          path-in-middle-panel
        >
        </redoc>
      </div>
      <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
    </body>
  </html>`;
    reply.type('text/html').send(html);
  });

  await app.register(staticPlugin, {
    // root: path.join(__dirname, '../public'),
    root: path.join(process.cwd(), 'public'),
    prefix: '/',
    index: ['index.html'],
    list: false,
    cacheControl: true,
    maxAge: '1h',
    etag: true,
    lastModified: true,
  });

  const close = async () => { try { await app.close(); } finally { await pool.end(); process.exit(0); } };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  await app.ready();

  const port = Number(process.env.APP_PORT) || 80;
  await app.listen({ port, host: '0.0.0.0' });

  console.log(`Swagger Docs: http://localhost:${port}/docs`);
  console.log(`Redoc Docs: http://localhost:${port}/redoc`);
}; // setup

export { app, setup };
