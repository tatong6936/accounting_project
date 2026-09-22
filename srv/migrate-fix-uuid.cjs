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
            name: 'Drop journalentrymessages',
            sql: `DROP TABLE IF EXISTS com_hospital_accounting_journalentrymessages`
        },
        {
            name: 'Drop journalentrypostings',
            sql: `DROP TABLE IF EXISTS com_hospital_accounting_journalentrypostings`
        },
        {
            name: 'Recreate journalentrypostings (VARCHAR ids — consistent with existing tables)',
            sql: `
                CREATE TABLE com_hospital_accounting_journalentrypostings (
                    id                           VARCHAR(36)  NOT NULL PRIMARY KEY,
                    batch_id                     VARCHAR(36),
                    journalentrycompanycode      VARCHAR(4),
                    journalentrydocumentnumber   VARCHAR(10),
                    journalentryyear             VARCHAR(4),
                    journalentrystatus           VARCHAR(10)
                )
            `
        },
        {
            name: 'Recreate journalentrymessages (VARCHAR ids — consistent with existing tables)',
            sql: `
                CREATE TABLE com_hospital_accounting_journalentrymessages (
                    id                       VARCHAR(36)   NOT NULL PRIMARY KEY,
                    journalentryposting_id   VARCHAR(36),
                    linenumber               INTEGER       NOT NULL,
                    message                  VARCHAR(500)  NOT NULL,
                    msgtype                  VARCHAR(1)
                )
            `
        },
        {
            name: 'Fix fiposting_id column type in items (UUID → VARCHAR)',
            sql: `
                ALTER TABLE com_hospital_accounting_items
                ALTER COLUMN fiposting_id TYPE VARCHAR(36)
            `
        }
    ];

    const client = await pool.connect();
    try {
        for (const step of steps) {
            process.stdout.write(`[migrate-fix] ${step.name}... `);
            await client.query(step.sql);
            console.log('OK');
        }
    } finally {
        client.release();
    }
    await pool.end();
    console.log('[migrate-fix] All done!');
}

main().catch(err => {
    console.error('[migrate-fix] ERROR:', err.message);
    process.exit(1);
});
