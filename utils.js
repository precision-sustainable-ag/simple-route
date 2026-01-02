import { networkInterfaces } from 'os';

import { routes } from './app.js';

const GLOBAL_ERROR = [];
const ipAddress = () => Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address || '127.0.0.1';
const dberr = `Could not connect to database from ${ipAddress()}`;

const pgTypeToJson = (oid, data) => {
  switch (oid) {
    case 16:   return { type: 'boolean' };                            // bool
    case 20:                                                          // int8
    case 21:                                                          // int2
    case 23:   return { type: 'integer' };                            // int4
    case 700:                                                         // float4
    case 701:                                                         // float8
    case 1700: return { type: 'number' };                             // numeric
    case 19:                                                          // name
    case 25:                                                          // text
    case 1042:                                                        // char
    case 1043: return { type: 'string' };                             // varchar
    case 1082: return { type: 'string', format: 'date' };             // date
    case 1114:                                                        // timestamp
    case 1184: return { type: 'string', format: 'date-time' };        // timestamptz
    case 114:                                                         // json
    case 3802:                                                        // jsonb
      return Array.isArray(data)
        ? { type: 'array', example: [] }
        : { type: 'object', additionalProperties: true }
    case 1007: return { type: 'array', items: { type: 'integer' } };  // _int4
    case 1009:                                                        // _text
    case 1015: return { type: 'array', items: { type: 'string' } };   // _varchar
    case 869:  return { type: 'string', format: 'ipv4' };             // inet
    default: console.log('unknown oid', oid); return { type: 'string' };   // fallback
  }
};

const html = (out, opts, graph) => {
  if (!out.length) {
    return 'No data found';
  } else {
    return (`
      <meta charset="UTF-8">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/cash/8.1.3/cash.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

      <style>
        table {
          font: 13px arial;
          border: 1px solid black;
          border-spacing: 0; 
          empty-cells: show;
        }

        tr {
          vertical-align: top;
        }

        td, th {
          padding: 0.2em 0.5em;
          border-right: 1px solid #ddd;
          border-bottom: 1px solid #bbb;
          white-space: nowrap;
        }

        th {
          background: #eee;
          position: sticky;
          top: 0;
          z-index: 2;
          border-bottom: 1px solid #777;
          cursor: pointer;
        }

        tr.even {
          background: #efc;
        }

        td:nth-child(1)[rowspan] {
          position: relative;
        }

        tr.even td:nth-child(1)::before {
          content: '';
          position: absolute;
          height: 100%;
          top: 0;
          left: 0;
          width: 100vw;
          outline: 1px solid #666;
          z-index: 999;
        }

        a {
          /* position: absolute; */
          z-index: 1000;
        }
        
        #close-chart {
          position: absolute;
          right: 10vw;
          top: 5vh;
          padding: 6px 12px;
          font-size: 14px;
          cursor: pointer;
        }

        #chart-canvas {
          width: 100%;
          height: 100%;
        }

        #chart-modal {
          display:none;
          position:fixed;
          inset:0;
          background:rgba(0,0,0,.4);
          padding:40px;
          z-index:10000;
        }

        #chart-modal > div {
          background:white;
          margin:auto;
          padding:20px;
          max-width:80vw;
          max-height:80vh;
          border-radius:8px;
        }
      </style>

      <table id="Data">
        <thead>
          ${graph
        ? `
          <tr>
            <th>${Object.keys(out[0]).map((col) => `<span class="graph-icon" style="cursor:pointer; margin-left:6px;">📈</span>`).join('<th>')}
          </tr>
        `
        : ''
      }
          <tr class="header-row">
            <th>${Object.keys(out[0]).join('<th>')}
          </tr>
        </thead>
        <tbody>
          ${out.map((r) => `<tr><td>${Object.keys(r).map((v) => r[v]).join('<td>')}`).join('\n')}
        </tbody>
      </table>

      <div id="chart-modal">
        <div>
          <canvas id="chart-canvas"></canvas>
          <button id="close-chart">Close</button>
        </div>
      </div>

      <script>
        let chart;

        const showChartModal = (label, dates, values) => {
          $('#chart-modal').show();

          if (chart) chart.destroy();

          const ctx = document.getElementById('chart-canvas').getContext('2d');
          chart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: dates,
              datasets: [{
                label,
                data: values,
                borderWidth: 2,
                fill: false,
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
            }
          });
        }; // showChartModal

        $('#close-chart').on('click', () => $('#chart-modal').hide());

        $(document).on('keydown', (e) => {
          if (e.key === 'Escape') {
            $('#chart-modal').hide();
          }
        });

        const drawColumnChart = (colIndex) => {
          const rows = $('#Data tbody tr').get();

          const dates = [];
          const values = [];

          rows.forEach(r => {
            const d = r.cells[0].innerText.trim();
            const v = r.cells[colIndex].innerText.trim();
            dates.push(d);
            values.push(parseFloat(v) || null);
          });

          showChartModal($('#Data .header-row th').eq(colIndex).text(), dates, values);
        }; // drawColumnChart

        $(document).on('click', '.graph-icon', function (e) {
          const th = $(this).closest('th')[0];
          const colIndex = th.cellIndex;
          drawColumnChart(colIndex);
        });

        $(document).on('click', '.header-row th', function () {
          const th = $(this);
          const cellIndex = this.cellIndex;
          const tbody = $('#Data tbody');
          const rows = tbody.children('tr').get();

          const wasAsc = th.hasClass('sorted-asc');
          const newDir = wasAsc ? 'desc' : 'asc';

          $('.header-row th').each(function () {
            this.textContent = this.textContent.replace(/[▲▼]/g, '').trim();
            this.classList.remove('sorted-asc', 'sorted-desc');
          });

          if (newDir === 'asc') {
            th.addClass('sorted-asc');
            th.text(th.text().trim() + ' ▲');
          } else {
            th.addClass('sorted-desc');
            th.text(th.text().trim() + ' ▼');
          }

          rows.sort((a, b) => {
            const valA = a.cells[cellIndex].innerText;
            const valB = b.cells[cellIndex].innerText;
            
            const cmp = /^date/.test(th.text()) ? valA.localeCompare(valB, undefined, { numeric: true }) : valA - valB;
            return newDir === 'asc' ? cmp : -cmp;
          });

          tbody.append(rows);
        });      
      </script>

      ${opts.rowspan ? `
        <script>
          const data = document.querySelector('#Data tbody');
          let cname = 'odd';
          [...data.rows].forEach((r1, i) => {
            for (let n = 0; n < data.rows[0].cells.length; n++) {
              if (n === 0 && r1.cells[0].style.display) continue;

              if (n === 0 && !r1.className) r1.classList.add(cname);

              for (let j = i + 1; j < data.rows.length; j++) {
                if ((n > 0) && (j - i + 1 > (r1.cells[0].rowSpan || 1))) {
                  break;
                }
                const r2 = data.rows[j];
                if (r1?.cells[n]?.innerText === r2?.cells[n]?.innerText) {
                  if (n === 0) r2.classList.add(cname);
                  r1.cells[n].rowSpan = j - i + 1;
                  r2.cells[n].style.display = 'none';
                } else {
                  break;
                }
              }
              
              if ((n === 0) && !r1.cells[0].style.display) {
                cname = cname === 'odd' ? 'even' : 'odd';
              }
            }
          });
        </script>` : ''}
    `);
  }
}; // html

const desc = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

const props = async (db, query, parms) => {
  try {
    let results;
    if (/\$[1-9]/.test(query) && Object.keys(parms).length === 0) {
      query = query.replace(/\$[1-9]/g, `''`);
    }

    if (parms) {
      const p = Object.keys(parms).map((parm) => {
        if (parms[parm].type === 'array') {
          return [];
        } else if (parms[parm].format === 'date') {
          return '2000-01-01';
        } else if (parms[parm].type === 'number') {
          return parms[parm].examples?.[0] ?? 0;
        } else if (parms[parm].type === 'boolean') {
          return true;
        } else {
          return '';
        }
      });

      results = await db.query(
        `SELECT * FROM (${query}) alias LIMIT 0`,
        p,
      );

      if (results.fields.find((field) => field.dataTypeID === 3802)) { // jsonb
        results = await db.query(
          `SELECT * FROM (${query}) alias LIMIT 1`,
          p,
        );
      }
    } else {
      results = await db.query(`${query.trim().replace(/LIMIT\s+\d+/, '')} LIMIT 0`);
  
      if (results.fields.find((field) => field.dataTypeID === 3802)) { // jsonb
        results = await db.query(`${query.trim().replace(/LIMIT\s+\d+/, '')} LIMIT 1`);
      }
    }

    const out = {};
    for (const f of results.fields) {
      out[f.name] = pgTypeToJson(f.dataTypeID, results.rows[0]?.[f.name]);
    }
    return out;
  } catch(err) {
    GLOBAL_ERROR.push(err);
  }
}; // props

const schema200 = async (pool, query) => ({
  200: {
    items: {
      properties: await props(pool, query),
    },
  },
});

const makeSimpleRoute = (app, db, pluginOpts = {}) => {
  const simpleQuery = async (query, parms, opts = {}) => {
    const { fields, rows } = await db.query(query, parms);
    if (opts.array) {
      return rows.map((row) => row[fields[0].name]);
    } else if (opts.object) {
      return rows[0];
    } else {
      return rows;
    }
  }; // simpleQuery

  const route = (tag, summary, description, props, handler, parameters = {}, opts = {}) => {
    const isEmpty = props && Object.keys(props).length === 0;

    let required = [];
    parameters = Object.fromEntries(
      Object.entries(parameters).map(([k, v]) => [
        k.toLowerCase(),
        typeof v === 'string'
          ? { type: 'string', description: desc(k) }
          : { type: 'string', description: desc(k), ...v },
      ]),
    );

    required = Object.entries(parameters)
      .filter(([, v]) => v && v.required === true)
      .map(([k]) => k);

    for (const k of required) delete parameters[k].required;

    if (!opts.object && !opts.array && !opts.html) {
      parameters.output = { type: 'string', examples: ['json', 'csv', 'html'] };
    }

    const useBody = opts?.method?.toLowerCase() === 'post';
    const bodyProps  = parameters;           // e.g., points
    const queryProps = opts?.query || {};    // e.g., output (optional)

    const schemaBlock = useBody
      ? {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { ...bodyProps },
          ...(required.length ? { required } : {}),
        },
      }
      : {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { ...bodyProps },
          ...(required.length ? { required } : {}),
        },
      };

    const properties = isEmpty
      ? undefined
      : (
        Object.fromEntries(
          Object.entries(props).map(([k, v]) => [
            k,
            typeof v === 'string'
              ? { type: 'string', enum: [v] }
              : { type: 'string', ...v },
          ]),
        )
      );

    if (opts[200] && !opts.response) {
      opts.response = {};
      if (opts[200].items) {
        opts.response[200] = opts[200];
      } else {
        opts.response[200] = {
          type: 'array',
          items: {
            additionalProperties: true,
            properties: { ...opts[200] },
          },
        };
      }
    }

    if (opts.array && !opts[200] && !opts.response) {
      opts.response = {
        200: {
          type: 'array',
          items: { type: 'string' },
        },
      };
    }

    const entries = [
      ['strings', { type: 'string' }],
      ['arrays',  { type: 'array' }],
      ['numbers', { type: 'number' }],
      ['dates',   { type: 'string', format: 'date' }],
    ];

    const hasAny = entries.some(([k]) => opts?.[k]);

    const items = hasAny
      ? {
        properties: entries.reduce((props, [k, schema]) => {
          for (const name of opts?.[k] ?? []) {
            props[name] = schema;
          }
          return props;
        }, {}),
      }
      : { additionalProperties: true };

    if (opts.other) {
      items.properties = {
        ...items.properties,
        ...opts.other,
      }
    }

    if (opts.object && !opts[200] && !opts.response) {
      opts.response = {
        200: {
          type: 'object',
          additionalProperties: isEmpty,
          properties: { ...properties },
        },
      };
      
      if (hasAny || opts.other) {
        opts.response[200].properties = { ...items.properties };
        opts.response[200].additionalProperties = false;
      }
    }

    const successSchema = opts.response ?? (
      opts.array
        ? { type: 'array' }
        : hasAny
          ? { type: 'array', items }
          : isEmpty
            ? { type: 'array', items: { type: 'object', additionalProperties: true } }
            : {
              type: 'array',
              items: {
                additionalProperties: false, // !!!
                properties: {
                  ...properties,
                },
              },
            }
    );

    const response = opts.response ?? {
      200: successSchema,
      503: {
        type: 'object',
        required: ['error'],
        additionalProperties: false,
        properties: { error: { type: 'string', enum: [dberr] }},
      },
    };

    return {
      schema: {
        tags: [tag],
        summary,
        description,
        response,
        security: [{ ApiKeyAuth: [] }],
        ...schemaBlock,
        ...(useBody && Object.keys(queryProps).length
          ? {
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: { ...queryProps },
            },
          }
          : {}
        ),
      },
      preHandler: [
        ...(pluginOpts?.public || opts?.public ? [] : [app.allowTrustedOriginOrApiKey]), 
      ],
      handler: async (req, reply) => {
        let out = await handler(req, reply);
        if (out === undefined) out = props;

        if (opts.html || opts?.respondAsHtmlWhen?.(req)) {
          reply.type('text/html');
          return out;
        } else if (req.query?.output === 'html' && Array.isArray(out)) {
          reply.type('text/html');
          return html(out, opts, req.query.options?.includes('graph'));
        } else if (req.query?.output === 'csv' && Array.isArray(out)) {
          reply.type('text/csv');
          if (!out.length) {
            return '';
          } else {
            const s = `${Object.keys(out[0]).toString()}\n${
              out.map((r) => Object.keys(r).map((v) => r[v]?.toString().includes(',') ? `"${r[v]}"`: r[v])).join('\n')}`;

            return s;
          }
        } else {
          return out;
        }
      },
    };
  }; // route

  return async function simpleRoute(routeName, tag, summary, query, parms, opts) {
    try {
      const useBody = opts?.method?.toLowerCase() === 'post';
      if (Array.isArray(parms)) {
        parms = Object.fromEntries(parms.map(k => [k, {}]));
      }

      if (typeof query === 'function') {
        const inputs = query.toString().split('(')[1].split(')')[0].split(/\s*,\s*/).filter((s) => s).map((s) => s.trim());
        const inputSchema = {};
        if (!routeName.includes(':')) {
          for (const f of inputs.filter((input) => input !== 'req' && input !== 'reply')) {
            inputSchema[f] = 'string';
          }
        }

        await app[opts?.method || 'get'](routeName,
          route(
            tag,
            summary,
            routes[routeName] ?? summary,
            {},
            (req, reply) => {
              // handle missing inputs, case-sensitivity, and parameterized routes
              const src = useBody ? (req.body ?? {}) : (req.query ?? {});
              const p = [];
              inputs.forEach((input) => {
                p.push(
                  input === 'req'
                    ? req
                    : input === 'reply'
                      ? reply
                      : src[input.toLowerCase()] ?? req.params[input] ?? '',
                );
              });
              return query(...p);
            },
            {
              ...inputSchema,
              ...(parms || {}),
            },
            opts,
          ),
        );
      } else {
        await app[opts?.method || 'get'](routeName,
          route(
            tag,
            summary,
            routes[routeName] ?? summary,
            await props(db, query, parms, opts?.db),
            (req) => {
              const src = useBody ? (req.body ?? {}) : (req.query ?? {});
              return simpleQuery(
                query,
                Object.keys(parms || req.params).map((parm) => {
                  if (src[parm.toLowerCase()] !== undefined) {
                    return src[parm.toLowerCase()];
                  } else if (req.params[parm]) {
                    return req.params[parm];
                  } else if (parms[parm].type === 'array') {
                    return [];
                  } else if (parms[parm].type === 'boolean') {
                    return false;
                  } else if (parms[parm].format === 'date') {
                    return null;
                  } else {
                    return '';
                  }
                }),
                opts,
              );
            },
            parms,
            opts,
          ),
        );
      }
    } catch (err) {
      GLOBAL_ERROR.push(err);
    }
  };
}; // makeSimpleRoute

export { makeSimpleRoute, props, schema200, GLOBAL_ERROR };