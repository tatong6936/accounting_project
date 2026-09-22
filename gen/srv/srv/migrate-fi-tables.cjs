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
            name: 'Drop wrongly-cased JournalEntryPostings table (if exists)',
            sql: `DROP TABLE IF EXISTS "com_hospital_accounting_JournalEntryPostings"`
        },
        {
            name: 'Drop wrongly-cased JournalEntryMessages table (if exists)',
            sql: `DROP TABLE IF EXISTS "com_hospital_accounting_JournalEntryMessages"`
        },
        {
            name: 'Create com_hospital_accounting_journalentrypostings',
            sql: `
                CREATE TABLE IF NOT EXISTS com_hospital_accounting_journalentrypostings (
                    ID                           UUID         NOT NULL PRIMARY KEY,
                    batch_ID                     UUID,
                    JournalEntryCompanyCode      VARCHAR(4),
                    JournalEntryDocumentNumber   VARCHAR(10),
                    JournalEntryYear             VARCHAR(4),
                    JournalEntryStatus           VARCHAR(10)
                )
            `
        },
        {
            name: 'Create com_hospital_accounting_journalentryMessages',
            sql: `
                CREATE TABLE IF NOT EXISTS com_hospital_accounting_journalentryMessages (
                    ID                       UUID          NOT NULL PRIMARY KEY,
                    journalEntryPosting_ID   UUID,
                    lineNumber               INTEGER       NOT NULL,
                    message                  VARCHAR(500)  NOT NULL,
                    msgType                  VARCHAR(1)
                )
            `
        },
        {
            name: 'Add fiPosting_ID column to com_hospital_accounting_items',
            sql: `
                ALTER TABLE com_hospital_accounting_items
                ADD COLUMN IF NOT EXISTS fiPosting_ID UUID
            `
        }
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
    console.log('[migrate] All FI tables migrated successfully!');
}

main().catch(err => {
    console.error('[migrate] ERROR:', err.message);
    process.exit(1);
});
