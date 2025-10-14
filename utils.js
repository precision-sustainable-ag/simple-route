import { networkInterfaces } from 'os';

import { routes } from './app.js';

const ipAddress = () => Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address || '127.0.0.1';
const dberr = `Could not connect to database from ${ipAddress()}`;

const pgTypeToJson = (oid) => {
  switch (oid) {
    case 16:   return { type: 'boolean' };                            // bool
    case 20:                                                          // int8
    case 21:                                                          // int2
    case 23:   return { type: 'integer' };                            // int4
    case 700:                                                         // float4
    case 701:                                                         // float8
    case 1700: return { type: 'number' };                             // numeric
    case 25:                                                          // text
    case 1042:                                                        // char
    case 1043: return { type: 'string' };                             // varchar
    case 1082: return { type: 'string', format: 'date' };             // date
    case 1114:                                                        // timestamp
    case 1184: return { type: 'string', format: 'date-time' };        // timestamptz
    case 114:                                                         // json
    case 3802: return { type: 'object', additionalProperties: true }; // jsonb
    case 1007: return { type: 'array', items: { type: 'integer' } };  // _int4
    case 1009:                                                        // _text
    case 1015: return { type: 'array', items: { type: 'string' } };   // _varchar
    default: console.log('unknown oid', oid); return { type: 'string' };   // fallback
  }
};

const html = (out, opts) => {
  return (`
    <style>
      table {
        font: 13px arial;
        border: 1px solid black;
        border-spacing: 0; 
        empty-cells: show;
        overflow: hidden;
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
        border-bottom: 1px solid #aaa;
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
        position: absolute;
        z-index: 1000;
      }
    </style>

    <table id="Data">
      <thead>
        <tr><th>${Object.keys(out[0]).join('<th>')}</tr>
      </thead>
      <tbody>
        ${out.map((r) => `<tr><td>${Object.keys(r).map((v) => r[v]).join('<td>')}`).join('\n')}
      </tbody>
    </table>

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
}; // html

const desc = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

const makeSimpleRoute = (app, db, pluginOpts = {}) => {
  const props = async (query, parms) => {
    try {
      let results;
      if (/\$[1-9]/.test(query) && Object.keys(parms).length === 0) {
        query = query.replace(/\$[1-9]/g, `''`);
      }

      if (parms) {
        const p = Object.keys(parms).map((parm) => {
          if (parms[parm].type === 'array') return [];
          if (parms[parm].format === 'date') return '2000-01-01';
          return '';
        });

        results = await db.query(
          `${query} LIMIT 0`,
          p,
        );
      } else {
        results = await db.query(`${query} LIMIT 0`);
      }

      const out = {};
      for (const f of results.fields) {
        out[f.name] = pgTypeToJson(f.dataTypeID);
      }
      return out;
    } catch(err) {
      console.log('props:', err.message, err.stack);
    }
  }; // props

  const simpleQuery = async (query, parms) => {
    const { fields, rows } = await db.query(query, parms);
    if (fields.length === 1) {
      return rows.map((row) => row[fields[0].name]);
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

    parameters.output = { type: 'string', examples: ['json', 'csv', 'html'] };

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
            additionalProperties: false,
            properties: { ...opts[200] },
          },
        };
      }
    }

    const successSchema = opts.response ?? (
      Object.keys(props).length === 1 || opts.array
        ? { type: 'array' }
        : isEmpty
          ? { type: 'array', items: { type: 'object', additionalProperties: true } }
          : {
            type: 'array',
            additionalProperties: false,
            items: {
              properties,
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
    // console.log(JSON.stringify(response, null, 2));
    // console.log('_'.repeat(80));

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

        if (opts?.respondAsHtmlWhen?.(req)) {
          reply.type('text/html');
          return out;
        } else if (req.query?.output === 'html' && Array.isArray(out)) {
          reply.type('text/html');
          return html(out, opts);
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
    const useBody = opts?.method?.toLowerCase() === 'post';

    if (Array.isArray(parms)) {
      parms = Object.fromEntries(parms.map(k => [k, {}]));
    }

    if (typeof query === 'function') {
      const inputs = query.toString().split('(')[1].split(')')[0].split(/\s*,\s*/).filter((s) => s);
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
          inputSchema,
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
          await props(query, parms, opts?.db),
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
                } else if (parms[parm].format === 'date') {
                  return null;
                } else {
                  return '';
                }
              }),
            );
          },
          parms,
          opts,
        ),
      );
    }
  };
}; // makeSimpleRoute

export {
  makeSimpleRoute,
}