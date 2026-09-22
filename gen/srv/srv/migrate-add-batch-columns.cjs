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

    const steps = [
        {
            name: 'Add roundOffAmount to com_hospital_accounting_batches',
            sql: `ALTER TABLE com_hospital_accounting_batches
                  ADD COLUMN IF NOT EXISTS roundoffamount NUMERIC(15,2)`
        },
        {
            name: 'Add isCancel to com_hospital_accounting_batches',
            sql: `ALTER TABLE com_hospital_accounting_batches
                  ADD COLUMN IF NOT EXISTS iscancel BOOLEAN`
        },
        {
            name: 'Refresh AccountingService_Batches view',
            sql: `CREATE OR REPLACE VIEW "AccountingService_Batches"
                  AS SELECT * FROM com_hospital_accounting_batches`
        },
    ];

    const client = await pool.connect();
    try {
        for (const step of steps) {
            process.stdout.write(`[migrate] ${step.name}... `);
            await client.query(step.sql);
            console.log('OK');
        }
    } finally {
        client.release();
    }
    await pool.end();
    console.log('[migrate] All done!');
}

main().catch(err => {
    console.error('[migrate] ERROR:', err.message);
    process.exit(1);
});
