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

    const client = await pool.connect();
    try {
        // Batches
        const batches = await client.query(
            `SELECT * FROM com_hospital_accounting_batches LIMIT 10`
        );
        console.log(`\n[Batches] count=${batches.rowCount}`);
        for (const r of batches.rows) console.log(' ', JSON.stringify(r));

        // JournalEntryPostings
        const postings = await client.query(
            `SELECT * FROM com_hospital_accounting_journalentrypostings LIMIT 10`
        );
        console.log(`\n[JournalEntryPostings] count=${postings.rowCount}`);
        for (const r of postings.rows) console.log(' ', JSON.stringify(r));

        // JournalEntryMessages
        const msgs = await client.query(
            `SELECT * FROM com_hospital_accounting_journalentryMessages LIMIT 20`
        );
        console.log(`\n[JournalEntryMessages] count=${msgs.rowCount}`);
        for (const r of msgs.rows) console.log(' ', JSON.stringify(r));

        // Items ที่มี fiPosting_ID แล้ว
        const items = await client.query(
            `SELECT * FROM com_hospital_accounting_items WHERE fiPosting_ID IS NOT NULL LIMIT 10`
        );
        console.log(`\n[Items with fiPosting_ID] count=${items.rowCount}`);
        for (const r of items.rows) console.log(' ', JSON.stringify(r));

        // Columns ทุกตาราง
        const cols = await client.query(`
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name LIKE 'com_hospital_accounting_%'
            ORDER BY table_name, ordinal_position
        `);
        console.log(`\n[Columns by table]`);
        let lastTable = '';
        for (const r of cols.rows) {
            if (r.table_name !== lastTable) {
                console.log(`\n  [${r.table_name}]`);
                lastTable = r.table_name;
            }
            console.log(`    ${r.column_name} (${r.data_type})`);
        }

    } finally {
        client.release();
    }
    await pool.end();
    console.log('\n[check-data] Done');
}

main().catch(err => {
    console.error('[check-data] ERROR:', err.message);
    process.exit(1);
});
