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
            name: 'Drop AccountingService_Items (to refresh with fiPosting_ID)',
            sql: `DROP VIEW IF EXISTS AccountingService_Items`
        },
        {
            name: 'Recreate AccountingService_Items (includes fiPosting_ID)',
            sql: `CREATE VIEW AccountingService_Items AS SELECT * FROM com_hospital_accounting_items`
        },
        {
            name: 'Create AccountingService_JournalEntryPostings',
            sql: `CREATE OR REPLACE VIEW AccountingService_JournalEntryPostings AS SELECT * FROM com_hospital_accounting_journalentrypostings`
        },
        {
            name: 'Create AccountingService_JournalEntryMessages',
            sql: `CREATE OR REPLACE VIEW AccountingService_JournalEntryMessages AS SELECT * FROM com_hospital_accounting_journalentrymessages`
        },
    ];

    const client = await pool.connect();
    try {
        for (const step of steps) {
            process.stdout.write(`[create-views] ${step.name}... `);
            await client.query(step.sql);
            console.log('OK');
        }
    } finally {
        client.release();
    }
    await pool.end();
    console.log('[create-views] All done!');
}

main().catch(err => {
    console.error('[create-views] ERROR:', err.message);
    process.exit(1);
});
