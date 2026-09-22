'use strict';
const { Pool } = require('pg');

async function main() {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
    const pgSvc = Object.values(vcap).flat()
        .find(s => s.credentials && (s.credentials.hostname || s.credentials.host));

    if (!pgSvc) throw new Error('PostgreSQL service not found in VCAP_SERVICES');

    const c = pgSvc.credentials;
    const pool = new Pool({
        host:     c.hostname || c.host,
        port:     parseInt(c.port) || 5432,
        user:     c.username || c.user,
        password: c.password,
        database: c.dbname || c.database,
        ssl:      { rejectUnauthorized: false }
    });

    const res = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
    `);

    console.log('[check-tables] Tables in public schema:');
    for (const row of res.rows) {
        console.log(' -', row.table_name);
    }

    await pool.end();
}

main().catch(err => {
    console.error('[check-tables] ERROR:', err.message);
    process.exit(1);
});
